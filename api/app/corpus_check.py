"""Validate the corpus and the golden question set before anything is ingested.

    uv run python -m app.corpus_check

Uses the same loaders, validation and parser as ingestion (app.corpus,
app.parse), and additionally checks that every citation in eval/golden.yaml
points at an accepted document version, a section the parser actually finds,
and a client the asking persona may see. Exits non-zero on any error.
"""

import re
import sys
from collections import Counter

import yaml

from app.corpus import REPO_ROOT, Source, load_and_validate
from app.parse import parse

GOLDEN = REPO_ROOT / "eval" / "golden.yaml"
PERSONA_CLIENTS = {"qa-analyst-a": {"client-a"}, "qa-analyst-b": {"client-b"},
                   "qa-manager": {"client-a", "client-b"}}
CITATION = re.compile(r"^(?P<code>[A-Z0-9-]+)@(?P<version>.+?) §(?P<section>\d+(?:\.\d+)*)$")


def check_golden(accepted: list[Source], rejected: list[Source], errors: list[str]) -> int:
    index = {s.key: s for s in accepted}
    known_codes = {s.meta.get("code") for s in accepted + rejected}
    sections: dict[tuple[str, str], set[str]] = {}
    questions = yaml.safe_load(GOLDEN.read_text())

    for q in questions:
        qid, allowed = q["id"], PERSONA_CLIENTS.get(q["persona"])
        if allowed is None:
            errors.append(f"{qid}: unknown persona {q['persona']}")
            continue
        for cite in q.get("must_cite", []):
            m = CITATION.match(cite)
            if not m:
                errors.append(f"{qid}: malformed citation {cite!r}")
                continue
            doc = index.get((m["code"], m["version"]))
            if doc is None:
                errors.append(f"{qid}: cites a document that is not in the library: {m['code']} v{m['version']}")
                continue
            if doc.meta["status"] != "effective":
                errors.append(f"{qid}: cites non-effective {m['code']} v{m['version']}")
            if doc.meta["client"] and doc.meta["client"] not in allowed:
                errors.append(f"{qid}: {q['persona']} cannot see {m['code']} ({doc.meta['client']})")
            if doc.key not in sections:
                sections[doc.key] = {s.number for s in parse(doc) if s.number}
            if m["section"] not in sections[doc.key]:
                errors.append(f"{qid}: parser finds no section {m['section']} in {m['code']}")
        for ref in q.get("must_not_cite", []):
            if ref.split("@")[0] not in known_codes:
                errors.append(f"{qid}: must_not_cite names unknown document {ref}")
    return len(questions)


def main() -> None:
    accepted, rejected, errors = load_and_validate()
    n_questions = check_golden(accepted, rejected, errors)

    scopes = Counter(f"{s.meta['tenant']}/{s.meta['client'] or 'shared'}" for s in accepted)
    formats = Counter(s.format for s in accepted)
    print(f"{len(accepted)} documents: " + ", ".join(f"{k} {v}" for k, v in sorted(scopes.items())))
    print("formats: " + ", ".join(f"{k} {v}" for k, v in sorted(formats.items())))
    print(f"golden questions: {n_questions}")
    for s in rejected:
        print(f"rejected at ingestion (fail closed): {s.label}: {'; '.join(s.problems)}")

    if errors:
        print(f"\n{len(errors)} problem(s):")
        for e in errors:
            print(f"  ✗ {e}")
        sys.exit(1)
    print("\nall checks passed")


if __name__ == "__main__":
    main()
