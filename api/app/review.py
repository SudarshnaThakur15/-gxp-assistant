"""QA review and electronic signature of answers held for review (tier T2).

The audit log is the only record. A held answer is an "ask" entry whose decision is
held_for_review; a decision on it is a later "review" entry naming that entry's seq.
The review queue is a view of the log: held answers that have no review entry yet.

Electronic signature (21 CFR Part 11, EU GMP Annex 11):
  - only users who may sign, never on their own question, and only with access to
    every document the answer cites
  - the password is re-entered for every signature and stored only as a scrypt hash
  - the signature shows printed name, title, date and time (UTC) and its meaning, and
    stores the SHA-256 of the exact content signed, so it cannot be moved to other content
  - before approval every cited version is checked again: still in force, same fingerprint
  - every refused attempt is recorded; 3 wrong passwords within 15 minutes lock signing
  - approve or reject only: editing the text would bypass the validation checks
"""

import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime

import psycopg

from app.audit import append_event, canonical_json, entry_hash

MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES = 3, 15
MIN_PASSWORD_LENGTH = 10
SCRYPT = {"n": 2**14, "r": 8, "p": 1}
MEANINGS = {
    "approve": "Approved: reviewed against the cited sources and released for use",
    "reject": "Rejected: not released",
}
STATUS = {  # HTTP status for each refusal code
    "not_a_signer": 403, "no_signing_password": 403, "own_question": 403, "no_access": 403,
    "wrong_password": 401, "locked": 423, "not_held": 404, "already_decided": 409,
    "not_in_force": 409, "tampered": 409,
}

SIGNER_SQL = "SELECT id, name, title, can_sign, signing_password_hash FROM users WHERE id = %s"
VISIBLE_DOCS_SQL = """
SELECT d.code || '@' || d.version, d.status = 'effective', d.fingerprint
  FROM documents d JOIN users u ON u.id = %s
 WHERE d.tenant_id IN (u.tenant_id, 'public')
   AND (d.client_id IS NULL OR d.client_id = ANY (u.client_ids))
"""
HELD_SQL = """
SELECT a.seq, a.hash, a.prev_hash, a.record_canonical, a.payload, r.seq, r.hash, r.payload
  FROM audit_log a
  LEFT JOIN audit_log r ON r.event_type = 'review' AND (r.payload ->> 'ask_seq')::bigint = a.seq
 WHERE a.event_type = 'ask' AND a.payload ->> 'decision' = 'held_for_review'
"""
FAILED_ATTEMPTS_SQL = """
SELECT count(*) FROM audit_log
 WHERE actor = %(actor)s AND event_type = 'signature_refused' AND payload ->> 'code' = 'wrong_password'
   AND recorded_at > now() - make_interval(mins => %(minutes)s)
   AND seq > coalesce((SELECT max(seq) FROM audit_log WHERE actor = %(actor)s AND event_type = 'review'), 0)
"""


class SignatureRefused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.status = code, STATUS[code]


# --- passwords -------------------------------------------------------------------

def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **SCRYPT)
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    try:
        scheme, n, r, p, salt, digest = (stored or "").split("$")
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                                dklen=len(expected))
    except ValueError:
        return False
    return scheme == "scrypt" and hmac.compare_digest(actual, expected)


# --- what is signed ----------------------------------------------------------------

def signed_content(seq: int, hash_: str, payload: dict) -> dict:
    """Exactly what a reviewer sees and signs: the held text and its citations, bound to
    the audit entry. Citations are numbered as the pipeline numbers them."""
    passages = {p["id"]: p for p in payload["retrieval"]["passages"]}
    markers: dict[str, int] = {}
    citations = []
    for c in payload["claims"]:
        p = passages.get(c["source_id"])
        if p is None:
            continue
        if c["source_id"] not in markers:
            markers[c["source_id"]] = len(markers) + 1
            citations.append({"n": markers[c["source_id"]], "doc": p["doc"], "version": p["version"],
                              "section": p["section"], "page": p.get("page"),
                              "document_fingerprint": p["document_fingerprint"], "quotes": []})
        citations[markers[c["source_id"]] - 1]["quotes"].append(c["quote"])
    return {"ask": {"seq": seq, "hash": hash_}, "question": payload["question"],
            "requested_by": payload["persona"], "text": payload["withheld_draft"], "citations": citations}


def content_hash(content: dict) -> str:
    return hashlib.sha256(canonical_json(content).encode()).hexdigest()


def manifestation(review: dict) -> str:
    """The human-readable signature line (Part 11 §11.50)."""
    signed_at = datetime.fromisoformat(review["signed_at"]).strftime("%d %b %Y %H:%M UTC")
    s = review["signer"]
    return f"{s['name']}, {s['title']}. {review['meaning']}. Signed {signed_at}."


# --- database ------------------------------------------------------------------------

def _visible_docs(conn: psycopg.Connection, user_id: str) -> dict[str, tuple[bool, str | None]]:
    return {ref: (in_force, fp) for ref, in_force, fp in conn.execute(VISIBLE_DOCS_SQL, (user_id,)).fetchall()}


def _held(conn: psycopg.Connection, seq: int | None = None) -> list[tuple]:
    sql, params = HELD_SQL, ()
    if seq is not None:
        sql, params = sql + " AND a.seq = %s", (seq,)
    return conn.execute(sql + " ORDER BY a.seq", params).fetchall()


def _intact(seq: int, hash_: str, prev_hash: str, canonical: str, payload: dict) -> bool:
    """The held entry is exactly what was recorded (same check as audit verification)."""
    return entry_hash(prev_hash, seq, canonical) == hash_ and json.loads(canonical)["payload"] == payload


def _public(content: dict) -> list[dict]:
    return [{k: v for k, v in c.items() if k != "document_fingerprint"} for c in content["citations"]]


def queue(conn: psycopg.Connection, signer_id: str) -> list[dict]:
    """Held answers this signer may decide: not their own, every cited document visible to them."""
    signer = conn.execute(SIGNER_SQL, (signer_id,)).fetchone()
    if signer is None or not signer[3]:
        raise SignatureRefused("not_a_signer", "Only users who may sign can open the review queue.")
    visible = _visible_docs(conn, signer_id)
    items = []
    for seq, hash_, _, _, payload, review_seq, _, _ in _held(conn):
        content = signed_content(seq, hash_, payload)
        if review_seq is not None or payload["persona"] == signer_id:
            continue
        if any(f"{c['doc']}@{c['version']}" not in visible for c in content["citations"]):
            continue
        items.append({"ask_seq": seq, "requested_by": payload["persona"], "question": payload["question"],
                      "tier": payload["tier"], "reasons": payload["reasons"], "text": content["text"],
                      "citations": _public(content), "content_hash": content_hash(content)})
    return items


def decide(conn: psycopg.Connection, signer_id: str, ask_seq: int, decision: str, password: str,
           reason: str | None) -> dict:
    """Approve or reject a held answer with an electronic signature.

    Does not commit: the caller commits, also when SignatureRefused is raised, because
    every refused attempt is recorded in the audit trail."""
    if decision not in MEANINGS:
        raise ValueError("decision must be 'approve' or 'reject'")
    reason = (reason or "").strip() or None
    if decision == "reject" and not reason:
        raise ValueError("a rejection needs a reason")
    actor = f"user:{signer_id}"[:80]
    try:
        return _decide(conn, actor, signer_id, ask_seq, decision, password, reason)
    except SignatureRefused as e:
        append_event(conn, actor, "signature_refused",
                     {"ask_seq": ask_seq, "decision": decision, "code": e.code, "detail": str(e)})
        raise


def _decide(conn, actor, signer_id, ask_seq, decision, password, reason) -> dict:
    signer = conn.execute(SIGNER_SQL, (signer_id,)).fetchone()
    if signer is None or not signer[3]:
        raise SignatureRefused("not_a_signer", "This user may not sign.")
    _, name, title, _, password_hash = signer
    if password_hash is None:
        raise SignatureRefused("no_signing_password", "No signing password has been set for this user.")
    failed = conn.execute(FAILED_ATTEMPTS_SQL, {"actor": actor, "minutes": LOCKOUT_MINUTES}).fetchone()[0]
    if failed >= MAX_FAILED_ATTEMPTS:
        raise SignatureRefused("locked", f"Signing is locked after {failed} wrong passwords. "
                                         f"Try again in {LOCKOUT_MINUTES} minutes.")
    if not verify_password(password, password_hash):
        left = MAX_FAILED_ATTEMPTS - failed - 1
        raise SignatureRefused("wrong_password", f"Wrong password. {left} attempt(s) left before signing is locked."
                               if left else f"Wrong password. Signing is now locked for {LOCKOUT_MINUTES} minutes.")

    conn.execute("SELECT pg_advisory_xact_lock(hashtext('audit_log'))")  # same lock as audit_append
    rows = _held(conn, ask_seq)
    if not rows:
        raise SignatureRefused("not_held", f"Audit entry #{ask_seq} is not an answer held for review.")
    seq, hash_, prev_hash, canonical, payload, review_seq, _, _ = rows[0]
    if review_seq is not None:
        raise SignatureRefused("already_decided", f"Answer #{ask_seq} was already decided (audit #{review_seq}).")
    if not _intact(seq, hash_, prev_hash, canonical, payload):
        raise SignatureRefused("tampered", f"Audit entry #{ask_seq} was changed after it was recorded.")
    if payload["persona"] == signer_id:
        raise SignatureRefused("own_question", "Nobody may sign an answer to their own question.")
    content = signed_content(seq, hash_, payload)
    visible = _visible_docs(conn, signer_id)
    refs = [f"{c['doc']}@{c['version']}" for c in content["citations"]]
    if any(ref not in visible for ref in refs):
        raise SignatureRefused("no_access", "The answer cites documents this signer may not see.")
    if decision == "approve":
        stale = [ref for ref, c in zip(refs, content["citations"])
                 if not visible[ref][0] or visible[ref][1] != c["document_fingerprint"]]
        if stale:
            raise SignatureRefused("not_in_force", f"No longer in force or changed since the answer was drafted: "
                                                   f"{', '.join(stale)}. Ask the question again.")

    review = {"ask_seq": seq, "ask_hash": hash_, "outcome": "approved" if decision == "approve" else "rejected",
              "meaning": MEANINGS[decision], "reason": reason,
              "signer": {"id": signer_id, "name": name, "title": title},
              "signed_at": datetime.now(UTC).isoformat(), "method": "password re-entered (scrypt)",
              "content_hash": content_hash(content), "requested_by": payload["persona"]}
    recorded = append_event(conn, actor, "review", review)
    return {"ask_seq": seq, "outcome": review["outcome"], "signature": manifestation(review),
            "content_hash": review["content_hash"],
            "receipt": {"audit_seq": recorded["seq"], "audit_hash": recorded["hash"]}}


def answer_status(conn: psycopg.Connection, viewer_id: str, ask_seq: int) -> dict | None:
    """What the requester (or a signer who may see it) gets for a held answer. None = not visible."""
    rows = _held(conn, ask_seq)
    if not rows:
        return None
    seq, hash_, prev_hash, canonical, payload, review_seq, review_hash, review = rows[0]
    content = signed_content(seq, hash_, payload)
    if viewer_id != payload["persona"]:
        viewer = conn.execute(SIGNER_SQL, (viewer_id,)).fetchone()
        visible = _visible_docs(conn, viewer_id)
        if viewer is None or not viewer[3] or any(f"{c['doc']}@{c['version']}" not in visible
                                                  for c in content["citations"]):
            return None
    out = {"ask_seq": seq, "question": payload["question"]}
    if review is None:
        return out | {"status": "held_for_review", "decision_label": "Held for review",
                      "message": "Held for review. This answer must be reviewed and electronically signed "
                                 "by a QA Manager before it can be used."}
    receipt = {"audit_seq": review_seq, "audit_hash": review_hash, "content_hash": review["content_hash"]}
    if review["outcome"] == "rejected":
        return out | {"status": "rejected", "decision_label": "Rejected in QA review",
                      "message": f"Rejected in QA review. Reason: {review['reason']}",
                      "signature": manifestation(review), "receipt": receipt}
    # Released only if the content still matches what was signed (Part 11 §11.70).
    if not _intact(seq, hash_, prev_hash, canonical, payload) or content_hash(content) != review["content_hash"]:
        return out | {"status": "refused", "decision_label": "Refused",
                      "message": "Refused. The signed answer no longer matches its signature, so nothing was released.",
                      "receipt": receipt}
    return out | {"status": "released", "decision_label": "Released after QA review", "message": content["text"],
                  "citations": _public(content), "signature": manifestation(review), "receipt": receipt}
