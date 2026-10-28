"""Audit trail utilities for testing and the live tamper demo.

    uv run python -m app.audit_cli append --count 5   # write sample entries
    uv run python -m app.audit_cli verify
    uv run python -m app.audit_cli tamper 3            # edit entry 3 as a DB admin would
    uv run python -m app.audit_cli restore             # put entry 3 back

`tamper` plays an administrator who bypasses the append-only trigger and
rewrites an entry, keeping its fields consistent. Verification still catches
it because the stored hash no longer matches.
"""

import argparse
import json
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from app.audit import append_event, canonical_json, verify_chain
from app.db import connect

BACKUP_FILE = Path(__file__).resolve().parents[1] / ".tamper-backup.json"

SAMPLE_QUESTIONS = [
    "What is the reporting deadline for a critical deviation?",
    "Which SOP covers filter integrity testing?",
    "What are the cleaning validation acceptance limits?",
    "Who approves a change to a master batch record?",
    "How long are executed batch records retained?",
]


def cmd_append(count: int) -> None:
    with connect() as conn:
        for i in range(count):
            question = SAMPLE_QUESTIONS[i % len(SAMPLE_QUESTIONS)]
            entry = append_event(
                conn,
                actor="qa-analyst-a",
                event_type="demo.query",
                payload={"question": question, "outcome": "released", "tier": "T1"},
            )
            print(f"appended #{entry['seq']}  {entry['hash'][:16]}…  {question}")


def cmd_verify() -> None:
    with connect() as conn:
        result = verify_chain(conn)
    if result["ok"]:
        print(f"chain intact: {result['entries']} entries, head {result['head_hash'][:16]}…")
    else:
        print(f"CHAIN BROKEN at entry #{result['broken_at']}: {result['reason']}")


def _rewrite(conn: psycopg.Connection, seq: int, payload: dict, canonical: str) -> None:
    with conn.transaction():
        conn.execute("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete")
        conn.execute(
            "UPDATE audit_log SET payload = %s, record_canonical = %s WHERE seq = %s",
            (Jsonb(payload), canonical, seq),
        )
        conn.execute("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update_delete")


def cmd_tamper(seq: int) -> None:
    if BACKUP_FILE.exists():
        raise SystemExit(f"{BACKUP_FILE.name} exists; run `restore` first")
    with connect(pooled=False) as conn:
        row = conn.execute("SELECT payload, record_canonical FROM audit_log WHERE seq = %s", (seq,)).fetchone()
        if row is None:
            raise SystemExit(f"no entry #{seq}")
        payload, canonical = row
        BACKUP_FILE.write_text(json.dumps({"seq": seq, "payload": payload, "record_canonical": canonical}))

        record = json.loads(canonical)
        record["payload"] = {**payload, "outcome": "approved for release"}
        _rewrite(conn, seq, record["payload"], canonical_json(record))
    print(f"entry #{seq} rewritten: outcome -> 'approved for release' (backup in {BACKUP_FILE.name})")


def cmd_restore() -> None:
    if not BACKUP_FILE.exists():
        raise SystemExit("nothing to restore")
    backup = json.loads(BACKUP_FILE.read_text())
    with connect(pooled=False) as conn:
        _rewrite(conn, backup["seq"], backup["payload"], backup["record_canonical"])
    BACKUP_FILE.unlink()
    print(f"entry #{backup['seq']} restored")


def main() -> None:
    parser = argparse.ArgumentParser(prog="audit_cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("append").add_argument("--count", type=int, default=5)
    sub.add_parser("verify")
    sub.add_parser("tamper").add_argument("seq", type=int)
    sub.add_parser("restore")
    args = parser.parse_args()

    match args.command:
        case "append":
            cmd_append(args.count)
        case "verify":
            cmd_verify()
        case "tamper":
            cmd_tamper(args.seq)
        case "restore":
            cmd_restore()


if __name__ == "__main__":
    main()
