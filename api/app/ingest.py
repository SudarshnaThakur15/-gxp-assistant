"""Ingest the corpus into Postgres: validate, parse, chunk, embed, store, audit.

    uv run python -m app.ingest

Idempotent: a document is re-embedded only when its file, parser or embedding
model changed; a metadata-only change (e.g. superseded in the DMS) updates the
document row and the trigger syncs its chunks. Every run, every ingested
document and every rejected DMS record is written to the audit trail.
"""

import hashlib
import sys

import psycopg

from app.audit import append_event
from app.config import settings
from app.corpus import Source, load_and_validate
from app.embedding import EMBEDDING_MODEL, embed_passages, to_pgvector
from app.parse import PARSERS, Section, parse

ACTOR = "system:ingest"
MAX_WORDS = 260      # bge-small handles 512 tokens; leave room for the context line
OVERLAP_WORDS = 40
META_COLUMNS = ["title", "status", "doc_type", "effective_date", "review_date", "owner", "tenant_id",
                "client_id", "confidentiality", "regulatory_status", "required_qualifier", "record_state",
                "source_url"]


def chunk_section(section: Section) -> list[str]:
    """Whole section if short; otherwise line-aligned windows with a small overlap."""
    if len(section.text.split()) <= MAX_WORDS:
        return [section.text]
    chunks, current = [], []
    for line in section.text.splitlines():
        if current and len(" ".join(current + [line]).split()) > MAX_WORDS:
            chunks.append("\n".join(current))
            tail: list[str] = []
            for previous in reversed(current):
                if len(" ".join([previous] + tail).split()) > OVERLAP_WORDS:
                    break
                tail.insert(0, previous)
            current = tail
        current.append(line)
    if current:
        chunks.append("\n".join(current))
    return chunks


def document_row(source: Source, content_hash: str) -> dict:
    m = source.meta
    return {
        "code": m["code"], "version": str(m["version"]), "title": m["title"], "status": m["status"],
        "doc_type": m["doc_type"], "effective_date": m.get("effective_date"), "review_date": m.get("review_date"),
        "owner": m["owner"], "tenant_id": m["tenant"], "client_id": m.get("client"),
        "confidentiality": m["confidentiality"], "regulatory_status": m.get("regulatory_status"),
        "required_qualifier": m.get("required_qualifier"), "record_state": m.get("record_state"),
        "source_url": m.get("source_url"), "source_path": source.label, "content_hash": content_hash,
        "source_format": source.format, "parser": PARSERS[source.format],
    }


def existing_documents(conn: psycopg.Connection) -> dict[tuple[str, str], dict]:
    rows = conn.execute(
        f"""
        SELECT d.code, d.version, d.id, d.content_hash, d.parser, {", ".join("d." + c for c in META_COLUMNS)},
               (SELECT min(c.embedding_model) FROM chunks c WHERE c.document_id = d.id)
          FROM documents d
        """
    ).fetchall()
    columns = ["id", "content_hash", "parser", *META_COLUMNS, "embedding_model"]
    return {(r[0], r[1]): dict(zip(columns, r[2:])) for r in rows}


def store_document(conn: psycopg.Connection, row: dict, sections: list[Section]) -> int:
    chunks = [(section, text) for section in sections for text in chunk_section(section)]
    context = f"{row['code']} v{row['version']} | {row['title']}"
    vectors = embed_passages([f"[{context} | §{s.path}]\n{text}" for s, text in chunks])

    with conn.transaction():
        columns = list(row)
        doc_id = conn.execute(
            f"""
            INSERT INTO documents ({", ".join(columns)}) VALUES ({", ".join(["%s"] * len(columns))})
            ON CONFLICT (code, version) DO UPDATE SET
                {", ".join(f"{c} = EXCLUDED.{c}" for c in columns if c not in ("code", "version"))},
                ingested_at = now()
            RETURNING id
            """,
            list(row.values()),
        ).fetchone()[0]
        conn.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO chunks (document_id, ordinal, section_path, heading, page, text, embedding,
                                    embedding_model, tenant_id, client_id, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s::vector, %s, %s, %s, %s)
                """,
                [
                    (doc_id, i, s.path, s.heading, s.page, text, to_pgvector(v), EMBEDDING_MODEL,
                     row["tenant_id"], row["client_id"], row["status"])
                    for i, ((s, text), v) in enumerate(zip(chunks, vectors))
                ],
            )
        append_event(conn, ACTOR, "ingest.document", {
            "code": row["code"], "version": row["version"], "source": row["source_path"],
            "content_hash": row["content_hash"], "chunks": len(chunks), "parser": row["parser"],
            "embedding_model": EMBEDDING_MODEL,
        })
    return len(chunks)


def update_metadata(conn: psycopg.Connection, doc_id: int, row: dict, changed: list[str]) -> None:
    with conn.transaction():
        conn.execute(
            f"UPDATE documents SET {', '.join(f'{c} = %s' for c in changed)} WHERE id = %s",
            [row[c] for c in changed] + [doc_id],
        )  # documents_access_sync trigger carries status/tenant/client changes to the chunks
        append_event(conn, ACTOR, "ingest.metadata_changed",
                     {"code": row["code"], "version": row["version"], "changed": changed})


def main() -> None:
    accepted, rejected, errors = load_and_validate()
    if errors:
        print("corpus has errors; run `python -m app.corpus_check` and fix them first:")
        for e in errors:
            print(f"  ✗ {e}")
        sys.exit(1)

    summary = {"ingested": [], "metadata_updated": [], "unchanged": 0, "rejected": []}
    # autocommit: each `conn.transaction()` block commits on its own (one transaction per document)
    with psycopg.connect(settings.migration_url, autocommit=True) as conn:
        known = existing_documents(conn)
        for source in accepted:
            content_hash = hashlib.sha256(source.path.read_bytes()).hexdigest()
            row = document_row(source, content_hash)
            old = known.get(source.key)
            label = f"{row['code']} v{row['version']}"

            if (old is None or old["content_hash"] != content_hash or old["parser"] != row["parser"]
                    or old["embedding_model"] != EMBEDDING_MODEL):
                n = store_document(conn, row, parse(source))
                summary["ingested"].append(label)
                print(f"  ingested   {label:<28} {n:>3} chunks  ({source.format})")
                continue

            changed = [c for c in META_COLUMNS if old[c] != row[c]]
            if changed:
                update_metadata(conn, old["id"], row, changed)
                summary["metadata_updated"].append(label)
                print(f"  metadata   {label:<28} {', '.join(changed)}")
            else:
                summary["unchanged"] += 1

        for source in rejected:
            summary["rejected"].append({"source": source.label, "problems": source.problems})
            print(f"  REJECTED   {source.label}: {'; '.join(source.problems)}")

        with conn.transaction():
            append_event(conn, ACTOR, "ingest.run", summary)

    print(f"\n{len(summary['ingested'])} ingested, {len(summary['metadata_updated'])} metadata updates, "
          f"{summary['unchanged']} unchanged, {len(summary['rejected'])} rejected")


if __name__ == "__main__":
    main()
