"""Run the full 7-gate pipeline over eval/golden.yaml and score every expectation.

    uv run python -m app.answer_eval [--runs N] [--only G01,G08]

Per question: release decision (released / held_for_review / refused), answer type,
required citations (document + version + section), forbidden documents, required and
forbidden phrases. With --runs N, also reports questions whose result changes between
runs (model non-determinism). Holdout questions marked `contaminated` are reported
separately. Free-tier rate limits make a full run take several minutes; progress is
printed per question. Each run writes real audit entries (event_type "ask").
"""

import argparse
import re
import time
from collections import defaultdict

import psycopg
import yaml

from app.assurance import plain
from app.corpus import REPO_ROOT
from app.db import connect
from app.pipeline import ask

ANSWER_TYPE = {"answer": "answer", "not_found": "not_found", "out_of_scope": "refusal"}
EVAL_MAX_WAIT_S = 600.0


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", plain(text)).casefold()


def cites(citations: list[dict], ref: str) -> bool:
    code, _, rest = ref.partition("@")
    version, _, section = rest.partition(" §")
    return any(c["doc"] == code and (not version or c["version"] == version)
               and (not section or c["section"] == section or c["section"].startswith(section + " "))
               for c in citations)


def score(q: dict, out: dict) -> list[str]:
    """Return the list of failed expectations (empty = pass)."""
    failures = []
    draft = out["_draft"]
    all_citations = draft["citations"] + out["citations"]
    if out["decision"] != q["expect_decision"]:
        failures.append(f"decision {out['decision']} (expected {q['expect_decision']})")
    if out["answer_type"] != ANSWER_TYPE[q["expect"]]:
        failures.append(f"answer_type {out['answer_type']} (expected {ANSWER_TYPE[q['expect']]})")
    for ref in q.get("must_cite", []):
        if not cites(all_citations, ref):
            failures.append(f"missing citation {ref}")
    for ref in q.get("must_not_cite", []):
        if cites(all_citations, ref.split(" §")[0]):
            failures.append(f"forbidden citation {ref}")
    produced = norm(" ".join([draft["text"], out["message"], *draft["notices"]]))
    for phrase in q.get("must_include", []):
        if norm(phrase) not in produced:
            failures.append(f"missing phrase '{phrase}'")
    for phrase in q.get("must_not_include", []):
        if norm(phrase) in produced:
            failures.append(f"forbidden phrase '{phrase}'")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--only", help="comma-separated question ids")
    args = parser.parse_args()
    questions = yaml.safe_load((REPO_ROOT / "eval" / "golden.yaml").read_text())
    if args.only:
        questions = [q for q in questions if q["id"] in args.only.split(",")]

    results: dict[str, list[bool]] = defaultdict(list)
    conn = connect()
    try:
        for run in range(1, args.runs + 1):
            started = time.perf_counter()
            for q in questions:
                t = time.perf_counter()
                try:
                    out = ask(conn, q["persona"], q["question"], max_wait_s=EVAL_MAX_WAIT_S)
                except psycopg.Error as e:  # infrastructure, not an answer: reconnect and go on
                    results[q["id"]].append(False)
                    print(f"run {run} {q['id']} INFRA ERROR {time.perf_counter() - t:5.1f}s :: "
                          f"{type(e).__name__}: {str(e).splitlines()[0][:120]}", flush=True)
                    conn.close()
                    conn = connect()
                    continue
                failures = score(q, out)
                results[q["id"]].append(not failures)
                failed_checks = [c["id"] for c in out["_draft"]["checks"] if c["status"] == "fail"]
                print(f"run {run} {q['id']} {q['split']:<7} {out['decision']:<15} {out['tier']:<3} "
                      f"{'PASS' if not failures else 'FAIL'} {time.perf_counter() - t:5.1f}s"
                      f"{'  checks failed: ' + ','.join(failed_checks) if failed_checks else ''}"
                      f"{'  :: ' + '; '.join(failures) if failures else ''}", flush=True)
            print(f"-- run {run} done in {time.perf_counter() - started:.0f}s\n", flush=True)
    finally:
        conn.close()

    def rate(ids):
        runs = [ok for i in ids for ok in results[i]]
        return f"{sum(runs)}/{len(runs)}" if runs else "-"
    by_id = {q["id"]: q for q in questions}
    tune = [i for i, q in by_id.items() if q["split"] == "tune"]
    holdout = [i for i, q in by_id.items() if q["split"] == "holdout" and not q.get("contaminated")]
    contaminated = [i for i, q in by_id.items() if q.get("contaminated")]
    flaky = [i for i, r in results.items() if len(set(r)) > 1]
    print(f"overall {rate(list(by_id))} | tune {rate(tune)} | clean holdout {rate(holdout)} | "
          f"contaminated holdout {rate(contaminated)} | flaky across runs: {flaky or '-'}")


if __name__ == "__main__":
    main()
