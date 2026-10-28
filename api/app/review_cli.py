"""QA review and electronic signature from the command line.

    uv run python -m app.review_cli set-password qa-manager     # prompts; never pass a password as an argument
    uv run python -m app.review_cli queue qa-manager
    uv run python -m app.review_cli sign 131 --as qa-manager --approve
    uv run python -m app.review_cli sign 131 --as qa-manager --reject --reason "Cites the wrong section"
    uv run python -m app.review_cli status 131 --as qa-analyst-a

Passwords are read with a hidden prompt and stored only as a scrypt hash.
"""

import argparse
import getpass
import json
import sys

from app.audit import append_event
from app.db import connect
from app.review import (
    MIN_PASSWORD_LENGTH,
    SignatureRefused,
    answer_status,
    decide,
    hash_password,
    queue,
)


def cmd_set_password(user: str) -> None:
    password = getpass.getpass(f"New signing password for {user}: ")
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"Refused: use at least {MIN_PASSWORD_LENGTH} characters.")
    if getpass.getpass("Repeat it: ") != password:
        sys.exit("Refused: the two entries differ.")
    with connect() as conn:
        updated = conn.execute("UPDATE users SET signing_password_hash = %s WHERE id = %s AND can_sign",
                               (hash_password(password), user)).rowcount
        if not updated:
            sys.exit(f"Refused: {user} does not exist or may not sign.")
        append_event(conn, "admin:review_cli", "signing_password_set", {"user": user})  # who and when, never the hash
    print(f"Signing password set for {user}.")


def cmd_queue(signer: str) -> None:
    with connect() as conn:
        items = queue(conn, signer)
    if not items:
        print("Nothing waiting for review.")
    for item in items:
        print(f"#{item['ask_seq']}  asked by {item['requested_by']}: {item['question']}")
        print(f"   why held: {'; '.join(item['reasons'])}")
        print(f"   draft:    {item['text']}")
        for c in item["citations"]:
            print(f"   [{c['n']}] {c['doc']} v{c['version']} §{c['section']}: " + " | ".join(c["quotes"]))
        print()


def cmd_sign(ask_seq: int, signer: str, decision: str, reason: str | None) -> None:
    password = getpass.getpass(f"Signing password for {signer}: ")
    with connect() as conn:
        try:
            result = decide(conn, signer, ask_seq, decision, password, reason)
        except SignatureRefused as e:
            conn.commit()  # the refused attempt is recorded
            sys.exit(f"Refused ({e.code}): {e}")
        except ValueError as e:
            sys.exit(f"Refused: {e}")
        conn.commit()
    print(f"{result['outcome'].capitalize()}. {result['signature']}")
    print(f"Signed content {result['content_hash'][:16]}…, audit #{result['receipt']['audit_seq']}")


def cmd_status(ask_seq: int, viewer: str) -> None:
    with connect() as conn:
        status = answer_status(conn, viewer, ask_seq)
    print(json.dumps(status, indent=2, ensure_ascii=False) if status else "Not visible to this user.")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("set-password").add_argument("user")
    sub.add_parser("queue").add_argument("signer")
    sign = sub.add_parser("sign")
    sign.add_argument("ask_seq", type=int)
    sign.add_argument("--as", dest="signer", required=True)
    choice = sign.add_mutually_exclusive_group(required=True)
    choice.add_argument("--approve", action="store_const", const="approve", dest="decision")
    choice.add_argument("--reject", action="store_const", const="reject", dest="decision")
    sign.add_argument("--reason")
    status = sub.add_parser("status")
    status.add_argument("ask_seq", type=int)
    status.add_argument("--as", dest="viewer", required=True)
    args = parser.parse_args()

    if args.cmd == "set-password":
        cmd_set_password(args.user)
    elif args.cmd == "queue":
        cmd_queue(args.signer)
    elif args.cmd == "sign":
        cmd_sign(args.ask_seq, args.signer, args.decision, args.reason)
    else:
        cmd_status(args.ask_seq, args.viewer)


if __name__ == "__main__":
    main()
