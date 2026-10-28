import csv
import io
import json
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.assurance_info import catalogue, gate_stats, run_lab
from app.audit import verify_chain
from app.config import settings
from app.db import pool
from app.documents import get_document, list_documents
from app.governance import proof, sources, trust
from app.pipeline import ask, public_view
from app.retrieval import retrieve
from app.review import SignatureRefused, answer_status, decide, queue
from app.runs import audit_entries, list_runs, run_detail


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open(wait=True, timeout=30)
    yield
    pool.close()


app = FastAPI(title="GxP Knowledge Assistant API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/health/db")
def health_db() -> dict:
    """End-to-end database check: connect through the pooler, write and read
    inside a transaction, and exercise pgvector."""
    started = time.perf_counter()
    with pool.connection() as conn:
        server_version, database = conn.execute(
            "SELECT current_setting('server_version'), current_database()"
        ).fetchone()

        vector_ext = conn.execute(
            "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
        ).fetchone()
        vector_distance = None
        if vector_ext:
            vector_distance = conn.execute(
                "SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector"
            ).fetchone()[0]

        # Write + read round trip without leaving anything behind.
        with conn.transaction():
            conn.execute("CREATE TEMP TABLE probe (note text) ON COMMIT DROP")
            conn.execute("INSERT INTO probe VALUES ('round-trip')")
            roundtrip = conn.execute("SELECT note FROM probe").fetchone()[0]

    return {
        "status": "ok",
        "database": database,
        "server_version": server_version,
        "pooled": "-pooler" in (urlparse(settings.database_url).hostname or ""),
        "pgvector": vector_ext[0] if vector_ext else None,
        "vector_distance_check": vector_distance,
        "write_read_roundtrip": roundtrip == "round-trip",
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
    }


@app.get("/personas")
def personas() -> list[dict]:
    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.name, u.title, u.role, u.can_sign, t.name,
                   coalesce(array_agg(c.name ORDER BY c.name) FILTER (WHERE c.id IS NOT NULL), '{}')
              FROM users u
              JOIN tenants t ON t.id = u.tenant_id
              LEFT JOIN clients c ON c.id = ANY (u.client_ids)
             GROUP BY u.id, t.name
             ORDER BY u.role, u.id
            """
        ).fetchall()
    return [
        {"id": id_, "name": name, "title": title, "role": role, "can_sign": can_sign,
         "organisation": org, "clients": clients}
        for id_, name, title, role, can_sign, org, clients in rows
    ]


@app.get("/audit")
def audit_endpoint(persona: str, limit: int = 50, before: int | None = None) -> list[dict]:
    """Newest first. Payloads (questions, drafts) only for signers; the chain itself for everyone."""
    with pool.connection() as conn:
        return audit_entries(conn, persona, limit, before)


@app.get("/audit.csv")
def audit_csv(persona: str) -> Response:
    """The whole audit trail as CSV, with the same payload rule as /audit."""
    with pool.connection() as conn:
        rows = audit_entries(conn, persona, limit=100_000)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["seq", "recorded_at", "actor", "event_type", "payload", "prev_hash", "hash"])
    for r in reversed(rows):
        writer.writerow([r["seq"], r["recorded_at"].isoformat(), r["actor"], r["event_type"],
                         "" if r["payload"] is None else json.dumps(r["payload"], ensure_ascii=False),
                         r["prev_hash"], r["hash"]])
    return Response(out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="audit-trail.csv"'})


@app.get("/assurance")
def assurance_endpoint() -> dict:
    """The rules in plain English, the rule-set fingerprint and live counts per gate."""
    with pool.connection() as conn:
        return catalogue() | {"stats": gate_stats(conn)}


@app.get("/assurance/lab")
def lab_endpoint() -> dict:
    """Deliberately bad drafts and prohibited questions run live through the rules (no AI)."""
    return run_lab()


@app.get("/trust")
def trust_endpoint(persona: str) -> dict:
    """Trust centre: data boundary, safeguards (some re-checked live) and recent AI calls."""
    with pool.connection() as conn:
        return trust(conn, persona)


@app.get("/proof")
def proof_endpoint() -> dict:
    """The latest saved evaluation over the golden question set."""
    return proof()


@app.get("/sources")
def sources_endpoint() -> dict:
    """Where the knowledge base comes from and what the last import did."""
    with pool.connection() as conn:
        return sources(conn)


@app.get("/documents")
def documents_endpoint(persona: str) -> list[dict]:
    """Controlled documents this persona may see, one row per document with its versions."""
    with pool.connection() as conn:
        return list_documents(conn, persona)


@app.get("/documents/{code}")
def document_endpoint(code: str, persona: str, version: str | None = None) -> dict:
    """One document version with its sections (default: the version in force)."""
    with pool.connection() as conn:
        doc = get_document(conn, persona, code, version)
    if doc is None:
        raise HTTPException(status_code=404, detail="No such document, or not visible to you.")
    return doc


@app.get("/runs")
def runs_endpoint(persona: str, filter: str | None = None) -> dict:
    """Question runs visible to this persona, with counts per outcome."""
    with pool.connection() as conn:
        return list_runs(conn, persona, filter)


@app.get("/runs/{seq}")
def run_endpoint(seq: int, persona: str) -> dict:
    """One run: answer, checks, gate trace, review and audit history, as this persona may see it."""
    with pool.connection() as conn:
        run = run_detail(conn, persona, seq)
    if run is None:
        raise HTTPException(status_code=404, detail="No run with this number is visible to you.")
    return run


class RetrieveRequest(BaseModel):
    persona: str
    question: str


@app.post("/retrieve")
def retrieve_endpoint(req: RetrieveRequest) -> dict:
    with pool.connection() as conn:
        return asdict(retrieve(conn, req.persona, req.question))


class AskRequest(BaseModel):
    # Demo only: the persona comes from the request. Production must take the user from SSO.
    persona: str = Field(max_length=64)
    question: str = Field(min_length=3, max_length=1000)


@app.post("/ask")
def ask_endpoint(req: AskRequest) -> dict:
    """All 7 gates; the audit record is committed before this returns anything."""
    try:
        with pool.connection() as conn:
            return public_view(ask(conn, req.persona, req.question))
    except Exception as e:  # e.g. the audit trail could not be written: release nothing
        raise HTTPException(status_code=503, detail=f"Not released: {type(e).__name__}") from e


@app.get("/answers/{ask_seq}")
def answer_endpoint(ask_seq: int, persona: str) -> dict:
    """A held answer as its requester sees it: still held, released after QA signature, or rejected."""
    with pool.connection() as conn:
        status = answer_status(conn, persona, ask_seq)
    if status is None:
        raise HTTPException(status_code=404, detail="No held answer with this number is visible to you.")
    return status


@app.get("/reviews")
def review_queue(persona: str) -> list[dict]:
    """Held answers waiting for this signer's decision."""
    with pool.connection() as conn:
        try:
            return queue(conn, persona)
        except SignatureRefused as e:
            raise HTTPException(status_code=e.status, detail=str(e)) from e


class SignRequest(BaseModel):
    # Demo only: the signer comes from the request. Production must take the user from SSO.
    persona: str = Field(max_length=64)
    decision: str = Field(pattern="^(approve|reject)$")
    password: str = Field(min_length=1, max_length=200, repr=False)
    reason: str | None = Field(default=None, max_length=500)


@app.post("/reviews/{ask_seq}")
def sign_endpoint(ask_seq: int, req: SignRequest) -> dict:
    """Electronic signature: approve or reject a held answer. Refused attempts are recorded too."""
    with pool.connection() as conn:
        try:
            result = decide(conn, req.persona, ask_seq, req.decision, req.password, req.reason)
        except SignatureRefused as e:
            conn.commit()
            raise HTTPException(status_code=e.status, detail={"code": e.code, "message": str(e)}) from e
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        conn.commit()
    return result


@app.get("/audit/verify")
def audit_verify() -> dict:
    with pool.connection() as conn:
        return verify_chain(conn)
