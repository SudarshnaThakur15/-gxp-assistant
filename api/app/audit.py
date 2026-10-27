"""Tamper-evident audit trail: append entries and verify the hash chain.

The database computes each hash when an entry is appended (audit_append in
004_audit_log.sql); verification recomputes every hash here in Python, so the
check does not trust anything stored in the table.
"""

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from psycopg import Connection
from psycopg.types.json import Jsonb

GENESIS_HASH = "0" * 64


def canonical_json(value: Any) -> str:
    # Fixed key order and spacing: the same record always produces the same text.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def entry_hash(prev_hash: str, seq: int, record_canonical: str) -> str:
    return hashlib.sha256(f"{prev_hash}:{seq}:{record_canonical}".encode()).hexdigest()


def append_event(conn: Connection, actor: str, event_type: str, payload: dict) -> dict:
    recorded_at = datetime.now(UTC)
    record = {
        "recorded_at": recorded_at.isoformat(),
        "actor": actor,
        "event_type": event_type,
        "payload": payload,
    }
    seq, hash_ = conn.execute(
        "SELECT entry_seq, entry_hash FROM audit_append(%s, %s, %s, %s, %s)",
        (recorded_at, actor, event_type, Jsonb(payload), canonical_json(record)),
    ).fetchone()
    return {"seq": seq, "hash": hash_}


def verify_chain(conn: Connection) -> dict:
    rows = conn.execute(
        """
        SELECT seq, recorded_at, actor, event_type, payload, record_canonical, prev_hash, hash
          FROM audit_log
         ORDER BY seq
        """
    ).fetchall()

    def broken(seq: int, reason: str) -> dict:
        return {"ok": False, "entries": len(rows), "broken_at": seq, "reason": reason, "head_hash": None}

    expected_prev = GENESIS_HASH
    for expected_seq, (seq, recorded_at, actor, event_type, payload, canonical, prev_hash, hash_) in enumerate(rows, start=1):
        if seq != expected_seq:
            return broken(expected_seq, "an entry is missing")
        if prev_hash != expected_prev:
            return broken(seq, "link to the previous entry does not match")
        if entry_hash(prev_hash, seq, canonical) != hash_:
            return broken(seq, "content was changed after it was recorded")
        record = json.loads(canonical)
        if (
            record["actor"] != actor
            or record["event_type"] != event_type
            or record["payload"] != payload
            or datetime.fromisoformat(record["recorded_at"]) != recorded_at
        ):
            return broken(seq, "stored fields differ from the recorded entry")
        expected_prev = hash_

    return {"ok": True, "entries": len(rows), "broken_at": None, "reason": None, "head_hash": expected_prev}
