"""Ingest the corpus into Postgres: validate, parse, chunk, embed, store, audit.

    uv run python -m app.ingest

- Idempotent: a document is reprocessed only when its fingerprint changes
  (file + parser rules + parse-affecting metadata + embedding model). Within a
  reprocessed document, chunks whose embedded text is unchanged keep their vector.
- Fail closed: documents that left the source, or whose DMS record is now
  rejected, are marked withdrawn (never deleted, so past answers stay explainable).
- One bad file never stops the run; it is recorded as failed and the run exits non-zero.
- Only one ingestion runs at a time (advisory lock).
Every run, document, metadata change, withdrawal, rejection and failure is audited.
"""

import hashlib
import json
import sys

import psycopg

from app.audit import append_event
from app.corpus import Source, load_and_validate
from app.db import connect
from app.embedding import EMBEDDING_MODEL, embed_passages, to_pgvector
from app.parse import PARSERS, Section, parse

ACTOR = "system:ingest"
LOCK_ID = 7_314_002          # pg advisory lock key for ingestion
MAX_WORDS = 260              # bge-small handles 512 tokens; leave room for the context line
OVERLAP_WORDS = 40
EMBED_BATCH = 32             # bounded memory: never embed a whole large document at once
MIN_WORDS = 30               # less than this from a whole file = scanned image or empty export
META_COLUMNS = ["title", "status", "doc_type", "effective_date", "review_date", "owner", "tenant_id",
                "client_id", "confidentiality", "regulatory_status", "required_qualifier", "record_state",
                "source_url"]
PARSE_INPUTS = ["code", "version", "title", "line_numbers"]  # metadata that changes parsing or embedded text


class Rejected(Exception):
    """The document's content cannot be safely ingested (reason in the message)."""


def split_words(line: str) -> list[str]:
    """Split a single over-long line (e.g. a long Word paragraph) so nothing is silently truncated."""
    words = line.split()
    step = MAX_WORDS - OVERLAP_WORDS
    return [" ".join(words[i:i + MAX_WORDS]) for i in range(0, max(len(words) - OVERLAP_WORDS, 1), step)]


def chunk_section(section: Section) -> list[str]:
    """Whole section if short; otherwise line-aligned windows with a small overlap."""
    if len(section.text.split()) <= MAX_WORDS:
        return [section.text]
    lines = [part for line in section.text.splitlines()
             for part in (split_words(line) if len(line.split()) > MAX_WORDS else [line])]
    chunks, current = [], []
    for line in lines:
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


def fingerprint(source: Source, content_hash: str) -> str:
    inputs = {"file": content_hash, "parser": PARSERS[source.format], "model": EMBEDDING_MODEL,
              **{k: str(source.meta.get(k)) for k in PARSE_INPUTS}}
    return hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()


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
        "fingerprint": fingerprint(source, content_hash),
    }


def existing_documents(conn: psycopg.Connection) -> dict[tuple[str, str], dict]:
    rows = conn.execute(f"SELECT code, version, id, fingerprint, {', '.join(META_COLUMNS)} FROM documents").fetchall()
    return {(r[0], r[1]): dict(zip(["id", "fingerprint", *META_COLUMNS], r[2:])) for r in rows}


def embed_text(row: dict, section: Section, text: str) -> str:
    return f"[{row['code']} v{row['version']} | {row['title']} | §{section.path}]\n{text}"


def build_chunks(conn: psycopg.Connection, row: dict, sections: list[Section],
                 old_id: int | None) -> tuple[list[tuple], int]:
    """(section, text, vector) per chunk; unchanged chunks reuse their stored vector."""
    pieces = [(s, t, embed_text(row, s, t)) for s in sections for t in chunk_section(s)]
    known: dict[str, str] = {}
    if old_id is not None:  # one query for all of this document's existing chunks
        for section_path, text, vector in conn.execute(
            "SELECT section_path, text, embedding::text FROM chunks c JOIN documents d ON d.id = c.document_id "
            "WHERE c.document_id = %s AND c.embedding_model = %s", (old_id, EMBEDDING_MODEL)):
            known[f"{section_path}\x00{text}"] = vector
    todo = [p for p in pieces if f"{p[0].path}\x00{p[1]}" not in known]
    fresh: dict[str, str] = {}
    for i in range(0, len(todo), EMBED_BATCH):
        batch = todo[i:i + EMBED_BATCH]
        for (s, t, _), v in zip(batch, embed_passages([p[2] for p in batch])):
            fresh[f"{s.path}\x00{t}"] = to_pgvector(v)
    return [(s, t, known.get(f"{s.path}\x00{t}") or fresh[f"{s.path}\x00{t}"]) for s, t, _ in pieces], len(todo)


def store_document(conn: psycopg.Connection, row: dict, sections: list[Section], old_id: int | None) -> tuple[int, int]:
    words = sum(len(s.text.split()) for s in sections)
    if words < MIN_WORDS:
        raise Rejected(f"only {words} words of text extracted (scanned image or empty file? needs OCR)")
    chunks, embedded = build_chunks(conn, row, sections, old_id)

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
        # Separate DELETE: a data-modifying CTE shares the statement snapshot, so its
        # deleted rows would still collide with the inserts on (document_id, ordinal).
        conn.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))
        # All chunks in one round trip (arrays unnested server-side).
        conn.execute(
            """
            INSERT INTO chunks (document_id, ordinal, section_path, heading, page, text, embedding,
                                embedding_model, tenant_id, client_id, status)
            SELECT %(id)s, o - 1, p, h, pg, t, v::vector, %(model)s, %(tenant)s, %(client)s, %(status)s
              FROM unnest(%(paths)s::text[], %(heads)s::text[], %(pages)s::int[], %(texts)s::text[], %(vecs)s::text[])
                   WITH ORDINALITY AS u(p, h, pg, t, v, o)
            """,
            {"id": doc_id, "model": EMBEDDING_MODEL, "tenant": row["tenant_id"], "client": row["client_id"],
             "status": row["status"], "paths": [s.path for s, _, _ in chunks], "heads": [s.heading for s, _, _ in chunks],
             "pages": [s.page for s, _, _ in chunks], "texts": [t for _, t, _ in chunks], "vecs": [v for _, _, v in chunks]},
        )
        append_event(conn, ACTOR, "ingest.document", {
            "code": row["code"], "version": row["version"], "source": row["source_path"],
            "content_hash": row["content_hash"], "fingerprint": row["fingerprint"], "chunks": len(chunks),
            "embedded": embedded, "reused": len(chunks) - embedded, "parser": row["parser"],
            "embedding_model": EMBEDDING_MODEL,
        })
    return len(chunks), embedded


def update_metadata(conn: psycopg.Connection, doc_id: int, row: dict, changed: list[str]) -> None:
    with conn.transaction():
        conn.execute(
            f"UPDATE documents SET {', '.join(f'{c} = %s' for c in changed)} WHERE id = %s",
            [row[c] for c in changed] + [doc_id],
        )  # documents_access_sync trigger carries status/tenant/client changes to the chunks
        append_event(conn, ACTOR, "ingest.metadata_changed",
                     {"code": row["code"], "version": row["version"], "changed": changed})


def withdraw(conn: psycopg.Connection, doc_id: int, code: str, version: str, reason: str) -> None:
    with conn.transaction():
        conn.execute("UPDATE documents SET status = 'withdrawn' WHERE id = %s", (doc_id,))
        append_event(conn, ACTOR, "ingest.withdrawn", {"code": code, "version": version, "reason": reason})


def main() -> None:
    accepted, rejected, errors = load_and_validate()
    if errors:
        print("corpus has errors; run `python -m app.corpus_check` and fix them first:")
        for e in errors:
            print(f"  ✗ {e}")
        sys.exit(1)

    summary = {"ingested": [], "metadata_updated": [], "unchanged": 0, "withdrawn": [], "rejected": [], "failed": []}
    # autocommit: each `conn.transaction()` block commits on its own (one transaction per document)
    with connect(pooled=False, autocommit=True) as conn:
        if not conn.execute("SELECT pg_try_advisory_lock(%s)", (LOCK_ID,)).fetchone()[0]:
            sys.exit("another ingestion run is in progress; try again when it finishes")
        known = existing_documents(conn)

        # Fail closed: anything in the database that is no longer an accepted source is withdrawn.
        present = {s.key for s in accepted}
        rejected_keys = {s.key: "; ".join(s.problems) for s in rejected}
        for key, old in known.items():
            if key not in present and old["status"] != "withdrawn":
                reason = (f"DMS record rejected: {rejected_keys[key]}" if key in rejected_keys
                          else "no longer present in the source")
                withdraw(conn, old["id"], *key, reason)
                summary["withdrawn"].append(f"{key[0]} v{key[1]}")
                print(f"  WITHDRAWN  {key[0]} v{key[1]:<22} {reason}")

        # Demotions first, so the one-effective-version index never sees two effective rows.
        for source in sorted(accepted, key=lambda s: s.meta["status"] == "effective"):
            label = f"{source.meta['code']} v{source.meta['version']}"
            old = known.get(source.key)
            try:
                content_hash = hashlib.sha256(source.path.read_bytes()).hexdigest()
                row = document_row(source, content_hash)
                old = known.get(source.key)
                if old is None or old["fingerprint"] != row["fingerprint"]:
                    n, embedded = store_document(conn, row, parse(source), old and old["id"])
                    summary["ingested"].append(label)
                    print(f"  ingested   {label:<28} {n:>3} chunks, {embedded:>3} embedded  ({source.format})")
                    continue
                changed = [c for c in META_COLUMNS if old[c] != row[c]]
                if changed:
                    update_metadata(conn, old["id"], row, changed)
                    summary["metadata_updated"].append(label)
                    print(f"  metadata   {label:<28} {', '.join(changed)}")
                else:
                    summary["unchanged"] += 1
            except Rejected as e:
                summary["rejected"].append({"source": source.label, "problems": [str(e)]})
                print(f"  REJECTED   {source.label}: {e}")
                if old is not None and old["status"] != "withdrawn":
                    withdraw(conn, old["id"], *source.key, f"content rejected: {e}")
                    summary["withdrawn"].append(label)
            except Exception as e:  # one bad file must not stop the run
                summary["failed"].append({"source": source.label, "error": f"{type(e).__name__}: {e}"})
                print(f"  FAILED     {source.label}: {type(e).__name__}: {e}")

        for source in rejected:
            summary["rejected"].append({"source": source.label, "problems": source.problems})
            print(f"  REJECTED   {source.label}: {'; '.join(source.problems)}")

        with conn.transaction():
            append_event(conn, ACTOR, "ingest.run", summary)
        conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))

    print(f"\n{len(summary['ingested'])} ingested, {len(summary['metadata_updated'])} metadata updates, "
          f"{summary['unchanged']} unchanged, {len(summary['withdrawn'])} withdrawn, "
          f"{len(summary['rejected'])} rejected, {len(summary['failed'])} failed")
    if summary["failed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
