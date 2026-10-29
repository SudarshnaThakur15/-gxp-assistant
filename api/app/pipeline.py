"""The question pipeline: the 7 gates of the AiVACO assurance model, always in this order.

  1 SCREEN    deterministic rules first (app.assurance); the AI classifier only if no rule refused
  2 RETRIEVE  approved, in-force versions the user may see (app.retrieval)
  3 GENERATE  the AI drafts cited claims from retrieved sources only (app.answer)
  4 VALIDATE  deterministic checks on the draft (app.assurance)
  5 TIER      consequence tier from the task type and fixed rules (app.assurance)
  6 RECORD    hash-chained audit entry, committed BEFORE anything is released (invariant 4)
  7 RELEASE   released by rules / held for review / refused (app.assurance)

A follow-up in a chat is first rewritten into one self-contained question (app.followup);
the rules screen it as typed, as rewritten and with what the chat named earlier, and every
later gate works on the rewrite. Each message is its own run with its own record.

Every path (answer, not found, refusal, error) ends in TIER → RECORD → RELEASE.
ask() returns the internal outcome, including a withheld draft for reviewers and
evaluation; public_view() is the only thing a requester may see.
"""

import re
import secrets
import time
from dataclasses import asdict

import psycopg

from app import answer, assurance, followup, retrieval, screening
from app.audit import append_event
from app.corpus import DOC_REF
from app.retrieval import source_id
from app.runs import LEGACY_CHAT

NOT_FOUND = "Not found in the approved documentation available to you."
INJECTION_NOTICE = "A retrieved record contains text addressed to AI systems. It was treated as data and ignored."

PERSONA_SQL = """
SELECT u.id, d.code, d.doc_type, d.record_state
  FROM users u
  LEFT JOIN documents d
         ON d.code = ANY (%(codes)s) AND d.status = 'effective'
        AND d.tenant_id IN (u.tenant_id, 'public')
        AND (d.client_id IS NULL OR d.client_id = ANY (u.client_ids))
 WHERE u.id = %(persona)s
"""
IN_FORCE_SQL = "SELECT id, status = 'effective' FROM documents WHERE id = ANY (%s)"
SOURCE_SQL = """
SELECT d.code, d.version, d.title, c.section_path, c.page, c.text, d.fingerprint
  FROM chunks c JOIN documents d ON d.id = c.document_id
  JOIN users u ON u.id = %(persona)s
 WHERE d.code = %(code)s AND d.status = 'effective' AND d.client_id IS NULL
   AND d.tenant_id IN (u.tenant_id, 'public') AND c.section_path LIKE %(section)s
 ORDER BY c.ordinal
"""
# The open deviation an investigation pack is for: its text finds related records and procedures.
SUBJECT_SQL = """
SELECT d.title, string_agg(c.text, ' ' ORDER BY c.ordinal)
  FROM chunks c JOIN documents d ON d.id = c.document_id
 WHERE d.code = %s AND d.status = 'effective'
 GROUP BY d.title
"""
PACK_OTHERS = 5  # related records and procedures, besides the documents the subject names

# A chat's turns so far, with the QA decision on any that were held.
CHAT_TURNS_SQL = """
SELECT a.seq, a.payload, r.payload ->> 'outcome'
  FROM audit_log a
  LEFT JOIN audit_log r ON r.event_type = 'review' AND (r.payload ->> 'ask_seq')::bigint = a.seq
 WHERE a.event_type = 'ask'
   AND (a.payload -> 'chat' ->> 'id' = %(chat)s OR (a.seq = %(legacy)s AND a.payload -> 'chat' IS NULL))
 ORDER BY a.seq
"""


class ChatNotFound(Exception):
    """No such chat for this user: nothing is asked and nothing is recorded."""


def _ms(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)


def _end_read_transaction(conn: psycopg.Connection) -> None:
    """Never hold a database transaction open while waiting on an AI call: it pins a pooled
    server connection and the server kills sessions left idle in a transaction."""
    if not conn.autocommit:
        conn.commit()


def _render(resolved: list[dict]) -> tuple[str, list[dict]]:
    """The answer text is built only from verified claims, each followed by its citation marker."""
    markers: dict[str, int] = {}
    citations, sentences = [], []
    for c in resolved:
        h = c["hit"]
        sid = source_id(h)
        if sid not in markers:
            markers[sid] = len(markers) + 1
            citations.append({"n": markers[sid], "doc": h.code, "version": h.version, "section": h.section,
                              "page": h.page, "quotes": []})
        citations[markers[sid] - 1]["quotes"].append(c["quote"])
        sentences.append(f"{c['text'].rstrip()} [{markers[sid]}]")
    return " ".join(sentences), citations


def _rule_sources(conn: psycopg.Connection, persona: str, sources: list[dict]) -> list[dict]:
    """A refusal cites the in-force documents its rule rests on, and only where they say it word for word."""
    cited: dict[tuple, dict] = {}
    for s in sources:
        rows = conn.execute(SOURCE_SQL, {"persona": persona, "code": s["doc"], "section": s["section"] + " %"}).fetchall()
        row = next((x for x in rows if assurance.evidence_form(s["quote"]) in assurance.evidence_form(x[5])), None)
        if row is None:
            continue
        c = cited.setdefault((row[0], row[1], row[3]), {
            "n": len(cited) + 1, "doc": row[0], "version": row[1], "title": row[2], "section": row[3],
            "page": row[4], "document_fingerprint": row[6], "quotes": []})
        if s["quote"] not in c["quotes"]:
            c["quotes"].append(s["quote"])
    return list(cited.values())


def _shown(p: dict, review_outcome: str | None) -> str:
    """What the requester was shown for an earlier turn: never a withheld draft."""
    if p["decision"] == "released":
        return p.get("released_text") or NOT_FOUND
    if p["decision"] == "held_for_review":
        if review_outcome == "approved":
            return p.get("withheld_draft") or ""
        return "Rejected by QA, never released." if review_outcome == "rejected" else "Held for QA review, not shown yet."
    if p["answer_type"] == "refusal":
        rules = "; ".join(x["title"] for x in (p.get("screen") or {}).get("rules", [])) or "a decision reserved for people"
        quotes = " ".join(f'{c["doc"]} §{c["section"]} says: "{q}".' for c in p.get("refusal_sources") or []
                          for q in c["quotes"])
        return (f"Refused ({rules}): this assistant may not make that decision; it belongs to the investigator, "
                f"QA and the Qualified Person. {quotes}").strip()
    return "Refused: it could not be completed or verified, so nothing was released."


def _chat_turns(conn: psycopg.Connection, persona: str, chat_id: str) -> list[dict]:
    """A chat's turns so far, oldest first. Only the person who started it may continue it."""
    m = LEGACY_CHAT.match(chat_id)
    rows = conn.execute(CHAT_TURNS_SQL, {"chat": chat_id, "legacy": int(m.group(1)) if m else -1}).fetchall()
    if not rows or any(p["persona"] != persona for _, p, _ in rows):
        raise ChatNotFound(chat_id)
    return [{"seq": seq, "question": p["question"], "asked": p.get("standalone_question") or p["question"],
             "shown": _shown(p, review)} for seq, p, review in rows]


def ask(conn: psycopg.Connection, persona: str, question: str, *, chat_id: str | None = None,
        max_wait_s: float | None = None) -> dict:
    started = time.perf_counter()
    ms: dict[str, int] = {}
    answer_type = error = error_detail = draft = gen_meta = r = standalone = followup_meta = None
    hits, checks, resolved, notices = [], [], [], []

    # 1 SCREEN, a follow-up first: the AI rewrites it into one self-contained question (it only restates)
    earlier = _chat_turns(conn, persona, chat_id) if chat_id else []
    chat = {"id": chat_id or secrets.token_hex(8), "turn": len(earlier) + 1,
            "previous": earlier[-1]["seq"] if earlier else None}
    carried = assurance.carried_targets(question, [x for e in earlier for x in (e["question"], e["asked"])])
    pack_typed = bool(re.search(assurance.PACK_REQUEST, question, re.I)) and any(
        c.startswith("DEV-") for c in DOC_REF.findall(question.upper()))  # self-contained: nothing to rewrite
    if earlier and not pack_typed:
        t = time.perf_counter()
        _end_read_transaction(conn)
        try:
            rewritten, followup_meta = followup.rewrite(
                question, [{"question": e["asked"], "shown": e["shown"]} for e in earlier], max_wait_s)
            conversation = " ".join([*(f"{e['question']} {e['asked']} {e['shown']}" for e in earlier), question])
            if added := assurance.added_identifiers(rewritten, conversation):
                answer_type, error = "error", "follow-up failed: AddedIdentifiers"
                error_detail = f"the rewrite named {', '.join(added)}, which nobody wrote in the chat"
            elif assurance.evidence_form(rewritten) != assurance.evidence_form(question):
                standalone = rewritten
        except Exception as e:  # invariant 5: no fallback model; a failed AI step is a refusal
            answer_type, error, error_detail = "error", f"follow-up failed: {type(e).__name__}", str(e)[:400]
        ms["followup"] = _ms(t)
    asked = standalone or question  # what every later gate works on

    # Rules first, on every reading of the request; the AI only if no rule refused (it can add a refusal,
    # never remove one)
    t = time.perf_counter()
    texts = list(dict.fromkeys(x for x in (question, standalone, carried and f"{question} {carried}") if x))
    rows = conn.execute(PERSONA_SQL, {"persona": persona,
                                      "codes": DOC_REF.findall(" ".join(texts).upper())}).fetchall()
    screen = {"refused": False, "decided_by": "rules", "rules": [], "ai_intent": None}
    named = [{"code": c, "doc_type": dt, "record_state": rs} for _, c, dt, rs in rows if c]
    if not rows:
        screen.update(refused=True, rules=[{"rule": "S0", "title": "Unknown user"}])
    elif fired := assurance.screen_texts(texts, named):
        screen.update(refused=True, rules=fired)
    elif answer_type is None:
        _end_read_transaction(conn)
        try:
            result, meta = screening.classify(asked, max_wait_s)
            screen.update(decided_by="rules + AI", ai_intent=result["intent"], ai_reason=result["reason"],
                          refused=result["intent"] == "out_of_scope_decision", llm=meta)
        except Exception as e:  # invariant 5: no fallback model; a failed AI step is a refusal
            answer_type, error, error_detail = "error", f"screening failed: {type(e).__name__}", str(e)[:400]
    ms["screen"] = _ms(t)
    if screen["refused"]:  # a rule's refusal outranks a failed follow-up rewrite
        answer_type = "refusal"
    elif answer_type is None and screen["ai_intent"] == "off_topic":
        answer_type = "not_found"

    # An investigation pack for one named deviation: the AI prepares, the investigator decides
    subject = assurance.pack_subject(asked, named) if answer_type is None else None

    # 2 RETRIEVE
    if answer_type is None and subject:
        title, text = conn.execute(SUBJECT_SQL, (subject,)).fetchone()
        r = retrieval.retrieve(conn, persona, f"{subject} {title}. {text[:700]}", others=PACK_OTHERS)
    elif answer_type is None:
        r = retrieval.retrieve(conn, persona, asked)
    if r is not None:
        hits = r.hits
        ms["retrieve"] = sum(r.ms.values())
        if not r.found:
            answer_type = "not_found"
    injected = {source_id(h): off for h in hits if (off := assurance.injection_offset(h.text)) is not None}

    # 3 GENERATE
    if answer_type is None:
        _end_read_transaction(conn)
        t = time.perf_counter()
        try:
            draft, gen_meta = (answer.generate_pack(subject, hits, max_wait_s) if subject
                               else answer.generate(asked, hits, max_wait_s))
            answer_type = "answer" if draft["status"] == "answered" else "not_found"
        except Exception as e:
            answer_type, error, error_detail = "error", f"generation failed: {type(e).__name__}", str(e)[:400]
        ms["generate"] = _ms(t)

    # 4 VALIDATE (no AI): the draft is checked, not trusted
    if draft is not None:
        t = time.perf_counter()
        in_force = {}
        if draft["status"] == "answered":
            in_force = dict(conn.execute(IN_FORCE_SQL, (list({h.document_id for h in hits}),)).fetchall())
        checks, resolved, notices = assurance.validate(asked, draft, hits, in_force, injected)
        if subject and resolved:
            checks += assurance.validate_pack(subject, resolved)
        if injected:
            notices.append(INJECTION_NOTICE)
        ms["validate"] = _ms(t)

    # 5 TIER (no AI scores): from the task type and fixed rules
    cited = [c["hit"] for c in resolved if c["hit"] is not None]
    if answer_type == "error":
        tier, reasons = "n/a", [error]
    else:
        tier, reasons = assurance.tier(asked, screen, cited, checks)
    decision = assurance.release(tier, answer_type, checks)

    text, citations = _render([c for c in resolved if c["hit"] is not None])
    if decision == "refused":
        failed = [f"{c.id}: {c.title}" for c in checks if c.severity == "hard" and c.status == "fail"]
        if answer_type == "refusal" and screen["rules"][:1] == [{"rule": "S0", "title": "Unknown user"}]:
            message, citations = "Refused. Unknown user: sign in with an authorised account.", []
        elif answer_type == "refusal":
            titles = "; ".join(x["title"] for x in screen["rules"]) or "a decision reserved for people"
            message = (f"Refused. This request asks for something this assistant may never do ({titles}). "
                       "Batch release and disposition, deviation classification, root cause and CAPA selection "
                       "belong to the investigator, QA and the Qualified Person. "
                       "I can find the relevant records and procedures instead.")
            sources = [s for x in screen["rules"] for s in assurance.SCREEN_RULES[x["rule"]]["sources"]]
            citations = _rule_sources(conn, persona, sources or assurance.AI_SCREEN_SOURCES)
        elif answer_type == "error":
            message, citations = "Refused. The assistant could not complete this request safely, so nothing was released.", []
        else:
            message, citations = "Refused. The draft answer could not be verified against the approved documents.", []
            reasons = failed + reasons
    elif decision == "held_for_review":
        message = ("Waiting for QA sign-off. A QA Manager has to review and sign this answer "
                   "before it can be used.")
    elif answer_type == "not_found":
        message, citations = NOT_FOUND, []
    else:
        message = text

    gates = [
        {"n": 1, "gate": "Screen", "by": screen["decided_by"],
         "result": "refused" if screen["refused"] else ("error" if error and "screening" in error else "passed"),
         "detail": "; ".join(f"{x['rule']} {x['title']}" for x in screen["rules"]) or screen.get("ai_intent"),
         "followup": standalone},
        {"n": 2, "gate": "Retrieve", "by": "rules",
         "result": "skipped" if r is None else ("found" if r.found else "not found"),
         "detail": None if r is None else {"passages": [f"{h.code} v{h.version} §{h.section}" for h in hits],
                                           "excluded": r.excluded}},
        {"n": 3, "gate": "Generate", "by": "AI",
         "result": "skipped" if draft is None and not (error and "generation" in error)
         else ("error" if draft is None else draft["status"])},
        {"n": 4, "gate": "Validate", "by": "rules",
         "result": "skipped" if not checks else
         ("failed" if any(c.status == "fail" and c.severity == "hard" for c in checks) else "passed"),
         # check details quote the draft: shown only when the draft itself is released
         "detail": [asdict(c) if decision == "released" else asdict(c) | {"detail": None} for c in checks]},
        {"n": 5, "gate": "Tier", "by": "rules", "result": tier, "detail": reasons},
        {"n": 6, "gate": "Record", "by": "rules", "result": "pending"},
        {"n": 7, "gate": "Release", "by": "rules", "result": assurance.DECISION_LABELS[decision]},
    ]

    # 6 RECORD: committed to the hash-chained audit trail BEFORE anything is released
    payload = {
        "question": question, "persona": persona, "decision": decision, "answer_type": answer_type,
        "chat": chat, "standalone_question": standalone,
        "tier": tier, "reasons": reasons, "error": error, "error_detail": error_detail,
        "ruleset": {"version": assurance.RULESET_VERSION, "fingerprint": assurance.RULESET_FINGERPRINT},
        "followup": None if not earlier else {
            "prompt": {"version": followup.PROMPT_VERSION, "fingerprint": followup.PROMPT_FINGERPRINT},
            "llm": followup_meta, "carried_targets": carried or None},
        "screen": {k: v for k, v in screen.items() if k != "llm"} | {
            "prompt": {"version": screening.PROMPT_VERSION, "fingerprint": screening.PROMPT_FINGERPRINT},
            "llm": screen.get("llm")},
        "retrieval": None if r is None else {
            "params": {"top_k": retrieval.TOP_K, "max_per_doc": retrieval.MAX_PER_DOC,
                       "min_similarity": retrieval.MIN_SIMILARITY},
            "found": r.found, "best_similarity": r.best_similarity, "excluded": r.excluded,
            "passages": [{"id": source_id(h), "doc": h.code, "version": h.version, "section": h.section,
                          "page": h.page, "document_fingerprint": h.fingerprint, "score": round(h.score, 5),
                          "injection_flagged": source_id(h) in injected} for h in hits]},
        "generation": None if gen_meta is None else gen_meta | {
            "prompt": {"version": answer.PACK_PROMPT_VERSION, "fingerprint": answer.PACK_PROMPT_FINGERPRINT} if subject
            else {"version": answer.PROMPT_VERSION, "fingerprint": answer.PROMPT_FINGERPRINT}},
        "pack": {"subject": subject} if subject else None,
        "claims": [{"n": c["n"], "text": c["text"], "quote": c["quote"], "source_id": c["source_id"],
                    "section": c.get("section"),
                    "source": None if c["hit"] is None else f"{c['hit'].code} v{c['hit'].version} §{c['hit'].section}"}
                   for c in resolved],
        "checks": [asdict(c) for c in checks],
        "notices": notices,
        "released_text": message if decision == "released" else None,
        "withheld_draft": text if decision == "held_for_review" else None,
        "refusal_sources": citations if answer_type == "refusal" else None,
        "ms": ms,
    }
    seq_hash = append_event(conn, f"user:{persona}"[:80], "ask", payload)
    conn.commit()  # if this fails, the exception propagates and nothing is released
    gates[5]["result"], gates[5]["detail"] = "recorded", f"audit #{seq_hash['seq']}"
    ms["total"] = _ms(started)

    # 7 RELEASE
    return {
        "decision": decision, "decision_label": assurance.DECISION_LABELS[decision], "answer_type": answer_type,
        "chat": {"id": chat["id"], "turn": chat["turn"]}, "standalone_question": standalone,
        "tier": tier, "reasons": reasons, "message": message,
        "citations": [{k: v for k, v in c.items() if k != "document_fingerprint"} for c in citations]
                     if decision != "held_for_review" else [],
        "notices": notices if decision == "released" else [],
        "receipt": {"audit_seq": seq_hash["seq"], "audit_hash": seq_hash["hash"],
                    "ruleset_version": assurance.RULESET_VERSION},
        "gates": gates, "ms": ms,
        # internal only (reviewers, evaluation): never part of public_view
        "_draft": {"text": text, "claims": payload["claims"], "citations": _render(
            [c for c in resolved if c["hit"] is not None])[1], "notices": notices, "checks": payload["checks"]},
    }


def public_view(outcome: dict) -> dict:
    """What a requester may see: a held draft is never included."""
    return {k: v for k, v in outcome.items() if not k.startswith("_")}
