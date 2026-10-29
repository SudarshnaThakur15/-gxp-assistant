"""Document library read models: the controlled documents a persona may see, every version,
and each section's text so citations can link to the exact section they quote.

Sections are rebuilt from the stored chunks. Consecutive chunks of a section overlap by
a few lines (see ingest.OVERLAP_WORDS), so the overlap is removed when joining them.
"""

import psycopg
from psycopg.rows import dict_row

VISIBLE = """
  FROM documents d JOIN users u ON u.id = %(viewer)s
 WHERE d.tenant_id IN (u.tenant_id, 'public')
   AND (d.client_id IS NULL OR d.client_id = ANY (u.client_ids))
"""
LIST_SQL = """
SELECT d.code, d.title, d.version, d.status, d.doc_type, d.effective_date, d.owner, d.client_id,
       d.regulatory_status, d.record_state, d.source_format,
       d.tenant_id = 'public' AS public, (SELECT name FROM clients WHERE id = d.client_id) AS client_name,
       (SELECT count(DISTINCT c.section_path) FROM chunks c WHERE c.document_id = d.id) AS sections
""" + VISIBLE + " ORDER BY d.code, d.effective_date DESC NULLS LAST, d.version DESC"
VERSION_SQL = """
SELECT d.id, d.code, d.title, d.version, d.status, d.doc_type, d.effective_date, d.review_date, d.owner,
       d.client_id, d.regulatory_status, d.required_qualifier, d.record_state, d.source_format,
       d.source_url, d.fingerprint
""" + VISIBLE + " AND d.code = %(code)s ORDER BY d.effective_date DESC NULLS LAST, d.version DESC"
CHUNKS_SQL = "SELECT section_path, heading, page, text FROM chunks WHERE document_id = %s ORDER BY ordinal"


def join_overlapping(previous: str, following: str) -> str:
    """Join two consecutive chunks, dropping the text they share at the seam."""
    limit = min(len(previous), len(following), 4000)
    for size in range(limit, 20, -1):
        if previous.endswith(following[:size]):
            return previous + following[size:]
    return previous + "\n" + following


def list_documents(conn: psycopg.Connection, viewer: str) -> list[dict]:
    """One row per document code: the version in force (or the newest), plus its other versions."""
    by_code: dict[str, dict] = {}
    for row in conn.cursor(row_factory=dict_row).execute(LIST_SQL, {"viewer": viewer}).fetchall():
        entry = by_code.setdefault(row["code"], {"current": None, "versions": []})
        entry["versions"].append({"version": row["version"], "status": row["status"],
                                  "effective_date": row["effective_date"]})
        if entry["current"] is None or (row["status"] == "effective" and entry["current"]["status"] != "effective"):
            entry["current"] = row
    return [e["current"] | {"versions": e["versions"]} for e in by_code.values()]


def get_document(conn: psycopg.Connection, viewer: str, code: str, version: str | None = None) -> dict | None:
    """A document version with its sections. Default: the version in force. None = not visible."""
    versions = conn.cursor(row_factory=dict_row).execute(VERSION_SQL, {"viewer": viewer, "code": code}).fetchall()
    if not versions:
        return None
    if version is not None:
        doc = next((v for v in versions if v["version"] == version), None)
        if doc is None:
            return None
    else:
        doc = next((v for v in versions if v["status"] == "effective"), versions[0])
    sections: list[dict] = []
    for path, heading, page, text in conn.execute(CHUNKS_SQL, (doc["id"],)).fetchall():
        if sections and sections[-1]["path"] == path:
            sections[-1]["text"] = join_overlapping(sections[-1]["text"], text)
        else:
            sections.append({"path": path, "heading": heading, "page": page, "text": text})
    return {k: v for k, v in doc.items() if k != "id"} | {
        "sections": sections,
        "versions": [{"version": v["version"], "status": v["status"], "effective_date": v["effective_date"]}
                     for v in versions],
    }
