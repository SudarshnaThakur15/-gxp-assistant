"""Read models for the UI, built only from the audit log.

A "run" is one question through the 7 gates: an `ask` audit entry, plus a `review`
entry if a QA Manager decided it. What a viewer may see depends on who they are:
  - requesters see their own runs; a signer sees the runs of requesters whose clients
    they cover (a CDMO analyst never sees another client's questions)
  - a withheld draft, and check details that quote it, are shown only to signers and auditors
  - the raw audit payload (questions, drafts) is shown only to auditors; everyone can
    see the chain itself (sequence, actor, event, hashes) and verify it
  - runs by automated test accounts are shown to auditors only, labelled as tests
"""

import re

import psycopg

from app.review import manifestation, recorded_citations

NOT_FOUND = "Not found in the approved documentation available to you."
FAILURE = re.compile(r"((?:screening|generation) failed: \w+)")


def public_reason(text: str | None) -> str | None:
    """A failed AI step is shown by its error type only. Older runs recorded the provider's full
    message here (it contains account details); the full text stays in the audit entry."""
    m = FAILURE.match(text or "")
    return m.group(1) if m else text


def public_reasons(payload: dict) -> list[str]:
    return [public_reason(r) for r in payload.get("reasons") or []]


LABELS = {
    "released": "Released by rules", "not_found": "Released by rules: not found",
    "held": "Held for review", "approved": "Released after QA review",
    "rejected": "Rejected in QA review", "refused": "Refused",
}
FILTERS = {  # list filter → outcomes it includes
    "released": ("released", "not_found"), "held": ("held",),
    "decided": ("approved", "rejected"), "refused": ("refused",),
}

VIEWER_SQL = "SELECT id, name, can_sign, role FROM users WHERE id = %s"
TITLES_SQL = "SELECT code, version, title FROM documents WHERE code = ANY (%s)"
VISIBLE_RUNS = """
  FROM audit_log a
  JOIN users q ON q.id = a.payload ->> 'persona'
  JOIN viewer v ON v.id = q.id
              OR ((v.can_sign OR v.role = 'auditor')            -- reviewers and auditors: their clients' runs
                  AND v.tenant_id = q.tenant_id AND q.client_ids <@ v.client_ids
                  AND (NOT q.is_test OR v.role = 'auditor'))  -- test runs: auditors only, labelled
  LEFT JOIN audit_log r ON r.event_type = 'review' AND (r.payload ->> 'ask_seq')::bigint = a.seq
 WHERE a.event_type = 'ask'
"""
VIEWER_CTE = "WITH viewer AS (SELECT id, tenant_id, client_ids, can_sign, role FROM users WHERE id = %(viewer)s)\n"
RUNS_SQL = VIEWER_CTE + """
SELECT a.seq, a.recorded_at, a.hash, a.prev_hash, a.payload, q.id, q.name, r.seq, r.hash, r.payload, q.is_test
""" + VISIBLE_RUNS
# Lists show a title and a status: fetch only those fields, not every full audit record.
SUMMARY_SQL = VIEWER_CTE + """
SELECT a.seq, a.recorded_at, q.id, q.name, q.is_test, r.payload ->> 'outcome',
       jsonb_build_object(
           'question', a.payload -> 'question', 'decision', a.payload -> 'decision',
           'answer_type', a.payload -> 'answer_type', 'tier', a.payload -> 'tier',
           'reasons', jsonb_build_array(a.payload -> 'reasons' -> 0),
           'generation', jsonb_build_object('model', a.payload -> 'generation' -> 'model'),
           'screen', jsonb_build_object('llm', jsonb_build_object('model', a.payload -> 'screen' -> 'llm' -> 'model')),
           'ruleset', a.payload -> 'ruleset')
""" + VISIBLE_RUNS + " ORDER BY a.seq DESC"
HISTORY_SQL = """
SELECT seq, recorded_at, actor, event_type, payload, hash
  FROM audit_log
 WHERE seq = %(seq)s
    OR (event_type IN ('review', 'signature_refused') AND (payload ->> 'ask_seq')::bigint = %(seq)s)
 ORDER BY seq
"""


def outcome(payload: dict, review: dict | None) -> str:
    if review:
        return review["outcome"]
    if payload["decision"] == "held_for_review":
        return "held"
    if payload["decision"] == "refused":
        return "refused"
    return "not_found" if payload["answer_type"] == "not_found" else "released"


def _model(payload: dict) -> str | None:
    return ((payload.get("generation") or {}).get("model")
            or ((payload.get("screen") or {}).get("llm") or {}).get("model"))


def visible_rows(conn: psycopg.Connection, viewer: str, seq: int | None = None) -> list[tuple]:
    sql, params = RUNS_SQL, {"viewer": viewer}
    if seq is not None:
        sql, params = sql + " AND a.seq = %(seq)s", params | {"seq": seq}
    return conn.execute(sql + " ORDER BY a.seq DESC", params).fetchall()


def list_runs(conn: psycopg.Connection, viewer: str, filter_: str | None = None) -> dict:
    """Runs visible to the viewer, newest first, with counts per filter (summary fields only)."""
    runs = []
    for seq, recorded_at, req_id, req_name, is_test, review_outcome, p in conn.execute(
            SUMMARY_SQL, {"viewer": viewer}).fetchall():
        o = outcome(p, review_outcome and {"outcome": review_outcome})
        runs.append({"seq": seq, "recorded_at": recorded_at, "question": p["question"], "test": is_test,
                     "requested_by": {"id": req_id, "name": req_name}, "outcome": o, "label": LABELS[o],
                     "tier": p["tier"], "reason": (public_reasons(p) or [None])[0], "model": _model(p),
                     "ruleset_version": p["ruleset"]["version"]})
    counts = {"all": len(runs)} | {f: sum(r["outcome"] in outs for r in runs) for f, outs in FILTERS.items()}
    if filter_ in FILTERS:
        runs = [r for r in runs if r["outcome"] in FILTERS[filter_]]
    return {"counts": counts, "runs": runs}


def _trace(seq: int, hash_: str, p: dict, label: str) -> list[dict]:
    """The 7 gates as they ran, rebuilt from the recorded entry."""
    screen, retrieval, generation = p.get("screen") or {}, p.get("retrieval"), p.get("generation")
    checks = p.get("checks") or []
    failed = [c["id"] for c in checks if c["status"] == "fail"]
    error = p.get("error") or ""
    return [
        {"n": 1, "gate": "Screen", "by": screen.get("decided_by", "rules"),
         "result": "refused" if screen.get("refused") else ("error" if error.startswith("screening") else "passed"),
         "rules": screen.get("rules", []), "ai_intent": screen.get("ai_intent"), "ai_reason": screen.get("ai_reason"),
         "llm": screen.get("llm"), "prompt": screen.get("prompt")},
        {"n": 2, "gate": "Retrieve", "by": "rules",
         "result": "skipped" if retrieval is None else ("found" if retrieval["found"] else "not found"),
         "passages": [] if retrieval is None else [
             {"doc": x["doc"], "version": x["version"], "section": x["section"], "score": x["score"],
              "injection_flagged": x.get("injection_flagged", False)} for x in retrieval["passages"]],
         "excluded": [] if retrieval is None else retrieval.get("excluded", []),
         "best_similarity": None if retrieval is None else retrieval.get("best_similarity"),
         "params": None if retrieval is None else retrieval.get("params")},
        {"n": 3, "gate": "Generate", "by": "AI",
         "result": "error" if error.startswith("generation") else ("skipped" if generation is None else
                                                                   ("answered" if p.get("claims") else "not found")),
         "llm": generation and {k: v for k, v in generation.items() if k != "prompt"},
         "prompt": generation and generation.get("prompt"), "claims": len(p.get("claims") or [])},
        {"n": 4, "gate": "Validate", "by": "rules",
         "result": "skipped" if not checks else
         ("failed" if any(c["status"] == "fail" and c["severity"] == "hard" for c in checks) else "passed"),
         "summary": {"checks": len(checks), "failed": failed}},
        {"n": 5, "gate": "Tier", "by": "rules", "result": p["tier"], "reasons": public_reasons(p)},
        {"n": 6, "gate": "Record", "by": "rules", "result": "recorded", "audit_seq": seq, "audit_hash": hash_},
        {"n": 7, "gate": "Release", "by": "rules", "result": label},
    ]


def _event_text(event_type: str, payload: dict) -> str:
    if event_type == "ask":
        return f"Question asked by {payload['persona']}; {LABELS[outcome(payload, None)].lower()} (tier {payload['tier']})"
    if event_type == "review":
        return manifestation(payload) + (f" Reason: {payload['reason']}" if payload.get("reason") else "")
    return f"Signature attempt refused ({payload.get('code')}): {payload.get('detail')}"


def _with_titles(conn: psycopg.Connection, citations: list[dict]) -> list[dict]:
    """Citations as shown: the document's title beside its code, never the internal fingerprint."""
    titles = {}
    if codes := list({c["doc"] for c in citations}):
        titles = {(code, v): t for code, v, t in conn.execute(TITLES_SQL, (codes,)).fetchall()}
    return [{k: v for k, v in c.items() if k != "document_fingerprint"}
            | {"title": c.get("title") or titles.get((c["doc"], c["version"]))} for c in citations]


def run_detail(conn: psycopg.Connection, viewer: str, seq: int) -> dict | None:
    """One run as this viewer may see it. None = not visible to them."""
    rows = visible_rows(conn, viewer, seq)
    if not rows:
        return None
    seq, recorded_at, hash_, prev_hash, p, req_id, req_name, review_seq, review_hash, review, is_test = rows[0]
    v = conn.execute(VIEWER_SQL, (viewer,)).fetchone()
    is_signer = bool(v and v[2])
    sees_drafts = is_signer or bool(v and v[3] == "auditor")  # reviewers, and read-only auditors
    o = outcome(p, review)

    answer = None
    if o == "released":
        answer = {"text": p.get("released_text"), "withheld": False}
    elif o == "approved" or (o in ("held", "rejected") and sees_drafts):
        answer = {"text": p.get("withheld_draft"), "withheld": o != "approved"}
    elif o == "not_found":
        answer = {"text": NOT_FOUND, "withheld": False}
    if answer and o != "not_found":
        answer["citations"] = _with_titles(conn, recorded_citations(p))
        answer["notices"] = p.get("notices", []) if o == "released" else []
    show_details = answer is not None or sees_drafts  # check details quote the draft
    checks = [c if show_details else c | {"detail": None} for c in p.get("checks") or []]

    history = [{"seq": s, "recorded_at": t, "actor": actor, "event_type": et, "hash": h, "text": _event_text(et, pl)}
               for s, t, actor, et, pl, h in conn.execute(HISTORY_SQL, {"seq": seq}).fetchall()]
    return {
        "seq": seq, "recorded_at": recorded_at, "hash": hash_, "prev_hash": prev_hash,
        "question": p["question"], "requested_by": {"id": req_id, "name": req_name}, "test": is_test,
        "outcome": o, "label": LABELS[o], "decision": p["decision"], "answer_type": p["answer_type"],
        "tier": p["tier"], "reasons": public_reasons(p), "error": public_reason(p.get("error")),
        "answer": answer, "rule_sources": _with_titles(conn, p.get("refusal_sources") or []),
        "checks": checks, "trace": _trace(seq, hash_, p, LABELS[o]),
        "model": _model(p), "ruleset": p["ruleset"], "ms": p.get("ms", {}),
        "review": None if review is None else {
            "audit_seq": review_seq, "audit_hash": review_hash, "outcome": review["outcome"],
            "signature": manifestation(review), "reason": review.get("reason"),
            "content_hash": review["content_hash"]},
        "can_review": is_signer and o == "held" and viewer != req_id,
        "history": history,
    }


def audit_entries(conn: psycopg.Connection, viewer: str, limit: int = 50, before: int | None = None) -> list[dict]:
    """Audit entries, newest first. Entry contents (questions, drafts) only for auditors."""
    v = conn.execute(VIEWER_SQL, (viewer,)).fetchone()
    show_payload = bool(v and v[3] == "auditor")
    rows = conn.execute(
        """
        SELECT seq, recorded_at, actor, event_type, payload, prev_hash, hash
          FROM audit_log
         WHERE %(before)s::bigint IS NULL OR seq < %(before)s
         ORDER BY seq DESC
         LIMIT %(limit)s
        """,
        {"before": before, "limit": min(limit, 500)},
    ).fetchall()
    return [{"seq": seq, "recorded_at": t, "actor": actor, "event_type": et,
             "payload": payload if show_payload else None, "prev_hash": prev_hash, "hash": h}
            for seq, t, actor, et, payload, prev_hash, h in rows]
