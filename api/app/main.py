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

from app.alignment import controls, platform_risk, q9
from app.assurance_info import catalogue, gate_stats, run_lab
from app.audit import verify_chain
from app.config import settings
from app.db import pool, read_pool
from app.documents import get_document, list_documents
from app.governance import proof, sources, trust
from app.pipeline import ChatNotFound, ask, public_view
from app.retrieval import retrieve
from app.review import SignatureRefused, answer_status, decide, queue
from app.runs import audit_entries, chat_detail, list_runs, run_detail
from app.team import TEAMS, TeamInputRefused, answer_request, ask_team, requests, waiting_count


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open(wait=True, timeout=30)
    read_pool.open(wait=True, timeout=30)
    yield
    read_pool.close()
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
    with read_pool.connection() as conn:
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


_personas: tuple[float, list[dict]] | None = None
PERSONAS_TTL_S = 60  # users change only through migrations; every page needs the list


@app.get("/personas")
def personas() -> list[dict]:
    global _personas
    if _personas and time.monotonic() - _personas[0] < PERSONAS_TTL_S:
        return _personas[1]
    with read_pool.connection() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.name, u.title, u.role, u.can_sign, u.teams, t.name,
                   coalesce(array_agg(c.name ORDER BY c.name) FILTER (WHERE c.id IS NOT NULL), '{}')
              FROM users u
              JOIN tenants t ON t.id = u.tenant_id
              LEFT JOIN clients c ON c.id = ANY (u.client_ids)
             WHERE NOT u.is_test  -- test accounts are for the automated evaluation only
             GROUP BY u.id, t.name
             ORDER BY u.role, u.id
            """
        ).fetchall()
    result = [
        {"id": id_, "name": name, "title": title, "role": role, "can_sign": can_sign,
         "teams": [{"id": x, "name": TEAMS[x]} for x in teams], "organisation": org, "clients": clients}
        for id_, name, title, role, can_sign, teams, org, clients in rows
    ]
    _personas = (time.monotonic(), result)
    return result


def _require_auditor(conn, persona: str) -> None:
    row = conn.execute("SELECT role FROM users WHERE id = %s", (persona,)).fetchone()
    if row is None or row[0] != "auditor":
        raise HTTPException(status_code=403, detail="The audit trail is open to auditors; everyone can verify the chain.")


@app.get("/audit")
def audit_endpoint(persona: str, limit: int = 50, before: int | None = None) -> list[dict]:
    """Newest first, auditors only (it shows who asked what and when). /audit/verify is open to all."""
    with read_pool.connection() as conn:
        _require_auditor(conn, persona)
        return audit_entries(conn, persona, limit, before)


@app.get("/audit.csv")
def audit_csv(persona: str) -> Response:
    """The whole audit trail as CSV, with the same payload rule as /audit."""
    with read_pool.connection() as conn:
        _require_auditor(conn, persona)
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
    with read_pool.connection() as conn:
        return catalogue() | {"stats": gate_stats(conn)}


@app.get("/assurance/lab")
def lab_endpoint() -> dict:
    """Deliberately bad drafts and prohibited questions run live through the rules (no AI)."""
    return run_lab()


@app.get("/trust")
def trust_endpoint(persona: str) -> dict:
    """Trust centre: data boundary, safeguards (some re-checked live) and recent AI calls."""
    with read_pool.connection() as conn:
        return trust(conn, persona)


@app.get("/proof")
def proof_endpoint() -> dict:
    """The latest saved evaluation over the golden question set."""
    return proof()


@app.get("/sources")
def sources_endpoint() -> dict:
    """Where the knowledge base comes from and what the last import did."""
    with read_pool.connection() as conn:
        return sources(conn)


@app.get("/documents")
def documents_endpoint(persona: str) -> list[dict]:
    """Controlled documents this persona may see, one row per document with its versions."""
    with read_pool.connection() as conn:
        return list_documents(conn, persona)


@app.get("/documents/{code}")
def document_endpoint(code: str, persona: str, version: str | None = None) -> dict:
    """One document version with its sections (default: the version in force)."""
    with read_pool.connection() as conn:
        doc = get_document(conn, persona, code, version)
    if doc is None:
        raise HTTPException(status_code=404, detail="No such document, or not visible to you.")
    return doc


@app.get("/runs")
def runs_endpoint(persona: str, filter: str | None = None) -> dict:
    """Question runs visible to this persona, with counts per outcome."""
    with read_pool.connection() as conn:
        return list_runs(conn, persona, filter)


@app.get("/runs/{seq}")
def run_endpoint(seq: int, persona: str) -> dict:
    """One run: answer, checks, gate trace, review and audit history, as this persona may see it."""
    with read_pool.connection() as conn:
        run = run_detail(conn, persona, seq)
    if run is None:
        raise HTTPException(status_code=404, detail="No run with this number is visible to you.")
    return run


CHAT_ID = r"^(?:[0-9a-f]{16}|r\d{1,12})$"


@app.get("/chats/{chat_id}")
def chat_endpoint(chat_id: str, persona: str) -> dict:
    """A whole chat, oldest message first: each message is its own run, as this persona may see it."""
    with read_pool.connection() as conn:
        chat = chat_detail(conn, persona, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="No chat with this id is visible to you.")
    return chat


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
    chat_id: str | None = Field(default=None, pattern=CHAT_ID)  # a follow-up in this chat; none starts one


@app.post("/ask")
def ask_endpoint(req: AskRequest) -> dict:
    """All 7 gates; the audit record is committed before this returns anything."""
    try:
        with pool.connection() as conn:
            row = conn.execute("SELECT role FROM users WHERE id = %s", (req.persona,)).fetchone()
            if row is not None and row[0] == "auditor":  # segregation of duties: auditors are read-only
                raise HTTPException(status_code=403, detail="Auditors are read-only and cannot ask questions.")
            if row is not None and row[0] == "team_member":  # team members answer what they are asked
                raise HTTPException(status_code=403, detail="Team members answer team requests; they do not ask.")
            return public_view(ask(conn, req.persona, req.question, chat_id=req.chat_id))
    except HTTPException:
        raise
    except ChatNotFound as e:  # only the person who started a chat may continue it
        raise HTTPException(status_code=404, detail="No chat with this id that you can continue.") from e
    except Exception as e:  # e.g. the audit trail could not be written: release nothing
        raise HTTPException(status_code=503, detail=f"Not released: {type(e).__name__}") from e


@app.get("/answers/{ask_seq}")
def answer_endpoint(ask_seq: int, persona: str) -> dict:
    """A held answer as its requester sees it: still held, released after QA signature, or rejected."""
    with read_pool.connection() as conn:
        status = answer_status(conn, persona, ask_seq)
    if status is None:
        raise HTTPException(status_code=404, detail="No held answer with this number is visible to you.")
    return status


@app.get("/reviews/count")
def review_count(persona: str) -> dict:
    """How many held answers wait for this signer (the inbox badge), without loading the drafts."""
    with read_pool.connection() as conn:
        n = conn.execute(
            """
            SELECT count(*)
              FROM audit_log a
              JOIN users v ON v.id = %(signer)s AND v.can_sign
              JOIN users q ON q.id = a.payload ->> 'persona'
             WHERE a.event_type = 'ask' AND a.payload ->> 'decision' = 'held_for_review'
               AND NOT q.is_test AND q.id <> v.id
               AND q.tenant_id = v.tenant_id AND q.client_ids <@ v.client_ids
               AND NOT EXISTS (SELECT 1 FROM audit_log r WHERE r.event_type = 'review'
                                  AND (r.payload ->> 'ask_seq')::bigint = a.seq)
            """,
            {"signer": persona},
        ).fetchone()[0]
    return {"waiting": n}


@app.get("/reviews")
def review_queue(persona: str) -> list[dict]:
    """Held answers waiting for this signer's decision."""
    with read_pool.connection() as conn:
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


@app.get("/q9")
def q9_endpoint() -> dict:
    """ICH Q9(R1) alignment: principles with verified quotes, the tiers, and live routing counts."""
    with read_pool.connection() as conn:
        return q9(conn)


@app.get("/controls")
def controls_endpoint() -> dict:
    """Regulations against the company procedures and system controls that meet them, gaps included."""
    with read_pool.connection() as conn:
        return controls(conn)


@app.get("/platform-risk")
def platform_risk_endpoint() -> dict:
    """The assistant's own risk assessment (FMEA), with live counts of what each rule has caught."""
    with read_pool.connection() as conn:
        return platform_risk(conn)


@app.get("/team-requests")
def team_requests(persona: str) -> list[dict]:
    """Questions sent to a team, as this persona may see them: their own, their teams', or all (auditors)."""
    with read_pool.connection() as conn:
        try:
            return requests(conn, persona)
        except TeamInputRefused as e:
            raise HTTPException(status_code=e.status, detail=str(e)) from e


@app.get("/team-requests/count")
def team_request_count(persona: str) -> dict:
    """Open requests this persona can answer (the menu badge)."""
    with read_pool.connection() as conn:
        try:
            return {"waiting": waiting_count(conn, persona)}
        except TeamInputRefused:
            return {"waiting": 0}


class TeamRequest(BaseModel):
    persona: str = Field(max_length=64)
    ask_seq: int
    team: str = Field(max_length=40)
    question: str = Field(min_length=3, max_length=1000)


@app.post("/team-requests")
def team_request_create(req: TeamRequest) -> dict:
    """Send a question the documents could not answer to a team. Recorded in the audit trail."""
    with pool.connection() as conn:
        try:
            result = ask_team(conn, req.persona, req.ask_seq, req.team, req.question)
        except TeamInputRefused as e:
            raise HTTPException(status_code=e.status, detail=str(e)) from e
        conn.commit()
    return result


class TeamAnswer(BaseModel):
    persona: str = Field(max_length=64)
    answer: str = Field(min_length=3, max_length=1000)


@app.post("/team-requests/{request_seq}/answer")
def team_request_answer(request_seq: int, req: TeamAnswer) -> dict:
    """A team member answers an open request. Recorded in the audit trail."""
    with pool.connection() as conn:
        try:
            result = answer_request(conn, req.persona, request_seq, req.answer)
        except TeamInputRefused as e:
            raise HTTPException(status_code=e.status, detail=str(e)) from e
        conn.commit()
    return result


@app.get("/audit/verify")
def audit_verify() -> dict:
    with read_pool.connection() as conn:
        return verify_chain(conn)
