import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.audit import verify_chain
from app.config import settings
from app.db import pool
from app.pipeline import ask, public_view
from app.retrieval import retrieve


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
def audit_entries(limit: int = 20) -> list[dict]:
    with pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT seq, recorded_at, actor, event_type, payload, prev_hash, hash
              FROM audit_log
             ORDER BY seq DESC
             LIMIT %s
            """,
            (min(limit, 200),),
        ).fetchall()
    return [
        {"seq": seq, "recorded_at": recorded_at, "actor": actor, "event_type": event_type,
         "payload": payload, "prev_hash": prev_hash, "hash": hash_}
        for seq, recorded_at, actor, event_type, payload, prev_hash, hash_ in rows
    ]


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


@app.get("/audit/verify")
def audit_verify() -> dict:
    with pool.connection() as conn:
        return verify_chain(conn)
