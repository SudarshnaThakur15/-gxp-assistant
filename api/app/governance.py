"""Trust centre, proof and document sources: the evidence a reviewer asks for.

Every safeguard says how it is verified. "Checked live" ones are re-checked each time
the trust centre loads (inside a transaction that is always rolled back); the others
point to the automated tests that cover them.
"""

import json

import psycopg

from app import embedding, llm
from app.assurance import RULESET_VERSION
from app.assurance_info import run_lab
from app.audit import verify_chain
from app.corpus import REPO_ROOT
from app.runs import LABELS, outcome, public_reason, visible_rows

EVAL_RESULTS = REPO_ROOT / "eval" / "results" / "latest.json"


class _Rollback(Exception):
    pass


def _refused_by_database(conn: psycopg.Connection, sql: str) -> bool:
    """Try a forbidden statement inside a transaction that is always rolled back."""
    try:
        with conn.transaction():
            conn.execute(sql)
            raise _Rollback  # it ran: undo it and report that it was not blocked
    except _Rollback:
        return False
    except psycopg.Error as e:
        return "append-only" in str(e)


def trust(conn: psycopg.Connection, viewer: str) -> dict:
    chain = verify_chain(conn)
    last = "(SELECT max(seq) FROM audit_log)"
    update_blocked = _refused_by_database(conn, f"UPDATE audit_log SET actor = actor WHERE seq = {last}")
    delete_blocked = _refused_by_database(conn, f"DELETE FROM audit_log WHERE seq = {last}")
    lab = run_lab()

    calls, counts = [], {"ai_calls": 0, "tokens": 0, "refused": 0, "not_found": 0, "held": 0, "stopped": 0}
    for seq, recorded_at, _, _, p, _, req_name, _, _, review, _ in visible_rows(conn, viewer):
        screen_llm, generation = (p.get("screen") or {}).get("llm"), p.get("generation")
        used = [x for x in (screen_llm, generation) if x]
        counts["ai_calls"] += len(used)
        counts["tokens"] += sum((x.get("input_tokens") or 0) + (x.get("output_tokens") or 0) for x in used)
        o = outcome(p, review)
        counts["refused"] += o == "refused"
        counts["not_found"] += o == "not_found"
        counts["held"] += p["decision"] == "held_for_review"
        counts["stopped"] += any(c["status"] == "fail" and c["severity"] == "hard" for c in p.get("checks") or [])
        if len(calls) < 12:
            ai = []
            if screen_llm:
                ai.append(f"classified the request as {(p.get('screen') or {}).get('ai_intent')}")
            if generation:
                ai.append(f"drafted {len(p.get('claims') or [])} claim(s)")
            if p.get("error"):
                ai.append(f"call failed ({public_reason(p['error'])}), so nothing was released")
            calls.append({"seq": seq, "recorded_at": recorded_at, "question": p["question"], "asked_by": req_name,
                          "model": (generation or screen_llm or {}).get("model"),
                          "tokens": sum((x.get("input_tokens") or 0) + (x.get("output_tokens") or 0) for x in used),
                          "ai_did": "; ".join(ai) or "not called: decided by rules alone",
                          "rules_did": LABELS[outcome(p, None)],
                          "person_did": {"approved": "QA Manager approved and signed",
                                         "rejected": "QA Manager rejected and signed"}.get(review and review["outcome"],
                                         "waiting for a QA signature" if o == "held" else "nothing needed")})

    safeguards = [
        {"name": "The audit trail cannot be edited or deleted",
         "how": "Checked live: an UPDATE and a DELETE of the newest entry were attempted just now, inside a "
                "transaction that is always rolled back. The database refused both.",
         "ok": update_blocked and delete_blocked},
        {"name": "History cannot be rewritten unnoticed",
         "how": f"Checked live: every hash in the chain recomputed from scratch ({chain['entries']} entries).",
         "ok": chain["ok"]},
        {"name": "The AI cannot lower the bar",
         "how": f"Checked live: {lab['passed']} of {lab['total']} deliberately bad drafts and questions handled as "
                "expected by the rules. Also covered by automated tests.",
         "ok": lab["passed"] == lab["total"]},
        {"name": "Recorded before released",
         "how": "By design: the audit entry is committed before any answer is returned; if the write fails the API "
                "returns 503 and nothing is released. Verified in an end-to-end run with the audit write disabled.",
         "ok": None},
        {"name": "Another client's documents never reach the AI or the screen",
         "how": "Filtered before ranking; excluded passages are counted, never named, whatever their status. Covered "
                "by automated tests against the real database (tests/test_retrieval_db.py).",
         "ok": None},
        {"name": "A held draft never reaches the person who asked",
         "how": "Enforced by the API, not the page: drafts and check details are returned to signers only. Checked "
                "by loading a held run as its requester (draft text absent from the page).",
         "ok": None},
        {"name": "Electronic signatures meet Part 11 controls",
         "how": "Password re-entered per signature, signer and meaning recorded, content hash bound, lockout after "
                "3 wrong passwords. Covered by automated tests and a rolled-back end-to-end run.",
         "ok": None},
        {"name": "Refuses rather than guesses",
         "how": f"Live: {counts['refused']} refused and {counts['not_found']} answered “not found” instead of "
                "guessing, out of the runs visible to you.",
         "ok": None},
    ]
    return {
        "counts": counts | {"audit_entries": chain["entries"], "external_services": 1},
        "boundary": {
            "ai_model": llm.MODEL, "ai_provider": llm.PROVIDER,
            "ai_note": "External service: the question and the retrieved passages are sent to it for each AI step. "
                       "Nothing is sent for questions refused by a screening rule.",
            "embedding_model": embedding.EMBEDDING_MODEL,
            "embedding_note": "Runs locally: search never sends text outside this system.",
            "database": "Neon Postgres (EU, Frankfurt) with pgvector",
            "ruleset_version": RULESET_VERSION,
        },
        "audit": {"ok": chain["ok"], "entries": chain["entries"], "head_hash": chain["head_hash"]},
        "safeguards": safeguards,
        "recent_calls": calls,
    }


def proof() -> dict:
    """The latest saved evaluation (app.answer_eval --save), or available: false."""
    if not EVAL_RESULTS.exists():
        return {"available": False}
    data = json.loads(EVAL_RESULTS.read_text())
    decisions = ["released", "held_for_review", "refused"]
    matrix = {e: {a: 0 for a in decisions} for e in decisions}
    for r in data["results"]:
        if r["actual"] in decisions:
            matrix[r["expected"]][r["actual"]] += 1
    unsafe = [r for r in data["results"] if r["actual"] == "released" and r["expected"] != "released"]
    return data | {"available": True, "matrix": matrix, "unsafe_releases": len(unsafe)}


def sources(conn: psycopg.Connection) -> dict:
    """Where the knowledge base comes from, and what the last import did."""
    rows = conn.execute("""
        SELECT source_format, tenant_id, coalesce(client_id, '') AS client, status, count(*)
          FROM documents GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4
    """).fetchall()
    last = conn.execute("""
        SELECT seq, recorded_at, payload FROM audit_log WHERE event_type = 'ingest.run' ORDER BY seq DESC LIMIT 1
    """).fetchone()
    return {
        "documents": [{"format": f, "tenant": t, "client": c or None, "status": s, "count": n} for f, t, c, s, n in rows],
        "last_run": None if last is None else {"audit_seq": last[0], "recorded_at": last[1], **last[2]},
    }
