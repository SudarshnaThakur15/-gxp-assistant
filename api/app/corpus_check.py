"""Validate the corpus and the golden question set before anything is ingested.

    uv run python -m app.corpus_check

Checks metadata, document lifecycle (one effective version per code), client
walls (folder matches client, no cross-client references) and that every
citation in eval/golden.yaml points at an existing document version and section.
Exits non-zero if any check fails.
"""

import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS = REPO_ROOT / "corpus"
GOLDEN = REPO_ROOT / "eval" / "golden.yaml"

REQUIRED = ["code", "title", "version", "status", "doc_type", "effective_date", "owner",
            "tenant", "client", "confidentiality"]
STATUSES = {"draft", "effective", "superseded", "withdrawn"}
DOC_TYPES = {"sop", "policy", "specification", "quality_agreement", "deviation", "capa", "guideline"}
FOLDER_SCOPE = {  # folder -> (tenant, client)
    "public": ("public", None),
    "northbridge/shared": ("northbridge", None),
    "northbridge/client-a": ("northbridge", "client-a"),
    "northbridge/client-b": ("northbridge", "client-b"),
}
PERSONA_CLIENTS = {"qa-analyst-a": {"client-a"}, "qa-analyst-b": {"client-b"},
                   "qa-manager": {"client-a", "client-b"}}
BANNER = "SYNTHETIC – DEMO ONLY"
DOC_REF = re.compile(r"\b(?:SOP-[A-Z]{2,3}-\d{3}|DEV-\d{4}-\d{3}|CAPA-\d{4}-\d{3}|QA-[A-Z]{3}-\d{3}|"
                     r"SPEC-[A-Z]{3}-\d{3}|POL-[A-Z]{2}-\d{3})\b")
SECTION = re.compile(r"^#{2,3} (\d+(?:\.\d+)*)\.? ", re.M)
CITATION = re.compile(r"^(?P<code>[A-Z0-9-]+)@(?P<version>.+?) §(?P<section>\d+(?:\.\d+)*)$")


@dataclass
class Doc:
    path: Path
    meta: dict
    body: str = ""
    sections: set[str] = field(default_factory=set)

    @property
    def key(self) -> tuple[str, str]:
        return self.meta["code"], str(self.meta["version"])


def load_markdown(path: Path) -> Doc:
    text = path.read_text()
    _, front, body = text.split("---\n", 2)
    return Doc(path, yaml.safe_load(front), body, set(SECTION.findall(body)))


def load_corpus() -> list[Doc]:
    docs = [load_markdown(p) for p in sorted((CORPUS / "northbridge").rglob("*.md"))]
    for meta_path in sorted((CORPUS / "public").glob("*.meta.yaml")):
        docs.append(Doc(meta_path, yaml.safe_load(meta_path.read_text())))
    return docs


def check_documents(docs: list[Doc], errors: list[str]) -> None:
    def err(doc: Doc, msg: str) -> None:
        errors.append(f"{doc.path.relative_to(REPO_ROOT)}: {msg}")

    for doc in docs:
        m = doc.meta
        missing = [k for k in REQUIRED if k not in m]
        if missing:
            err(doc, f"missing metadata {missing}")
            continue
        if m["status"] not in STATUSES:
            err(doc, f"unknown status {m['status']!r}")
        if m["doc_type"] not in DOC_TYPES:
            err(doc, f"unknown doc_type {m['doc_type']!r}")
        for k in ("effective_date", "review_date"):
            if m.get(k) is not None and not isinstance(m[k], date):
                err(doc, f"{k} is not a date")

        folder = str(doc.path.parent.relative_to(CORPUS))
        if FOLDER_SCOPE.get(folder) != (m["tenant"], m["client"]):
            err(doc, f"folder {folder!r} does not match tenant/client {m['tenant']}/{m['client']}")

        if doc.path.suffix == ".md":
            expected = f"{m['code']}_v{m['version']}.md"
            if doc.path.name != expected:
                err(doc, f"file name should be {expected}")
            if BANNER not in doc.body:
                err(doc, "missing synthetic-data banner")
        else:
            pdf = doc.path.with_name(doc.path.name.replace(".meta.yaml", ".pdf"))
            if not pdf.exists():
                err(doc, f"missing {pdf.name}")
            if m.get("regulatory_status") == "consultation_draft" and not m.get("required_qualifier"):
                err(doc, "draft guidance needs a required_qualifier")

    seen = Counter(d.key for d in docs if "code" in d.meta)
    for key, n in seen.items():
        if n > 1:
            errors.append(f"duplicate document {key[0]} v{key[1]}")

    by_code = defaultdict(list)
    for d in docs:
        by_code[d.meta["code"]].append(d)
    for code, versions in by_code.items():
        effective = [d for d in versions if d.meta["status"] == "effective"]
        if len(effective) != 1:
            errors.append(f"{code}: expected exactly one effective version, found {len(effective)}")
        for d in versions:
            nxt = d.meta.get("superseded_by")
            if d.meta["status"] == "superseded" and not any(str(v.meta["version"]) == str(nxt) for v in versions):
                err(d, f"superseded_by {nxt!r} does not exist")

    clients = {d.meta["code"]: d.meta["client"] for d in docs}
    for doc in docs:
        for ref in set(DOC_REF.findall(doc.body)) - {doc.meta["code"]}:
            if ref not in clients:
                err(doc, f"references unknown document {ref}")
            elif doc.meta["client"] and clients[ref] and clients[ref] != doc.meta["client"]:
                err(doc, f"references {ref} of another client ({clients[ref]})")


def check_golden(docs: list[Doc], errors: list[str]) -> None:
    index = {d.key: d for d in docs}
    codes = {d.meta["code"]: d for d in docs}
    for q in yaml.safe_load(GOLDEN.read_text()):
        qid = q["id"]
        allowed = PERSONA_CLIENTS.get(q["persona"])
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
                errors.append(f"{qid}: cites missing document {m['code']} v{m['version']}")
                continue
            if doc.meta["status"] != "effective":
                errors.append(f"{qid}: cites non-effective {m['code']} v{m['version']}")
            if doc.meta["client"] and doc.meta["client"] not in allowed:
                errors.append(f"{qid}: {q['persona']} cannot see {m['code']} ({doc.meta['client']})")
            # PDF sections are verified when the PDFs are parsed at ingestion.
            if doc.path.suffix == ".md" and m["section"] not in doc.sections:
                errors.append(f"{qid}: {m['code']} has no section {m['section']}")
        for ref in q.get("must_not_cite", []):
            if ref.split("@")[0] not in codes:
                errors.append(f"{qid}: must_not_cite names unknown document {ref}")


def main() -> None:
    docs = load_corpus()
    errors: list[str] = []
    check_documents(docs, errors)
    check_golden(docs, errors)

    scopes = Counter(f"{d.meta['tenant']}/{d.meta['client'] or 'shared'}" for d in docs)
    statuses = Counter(d.meta["status"] for d in docs)
    print(f"{len(docs)} documents: " + ", ".join(f"{k} {v}" for k, v in sorted(scopes.items())))
    print("status: " + ", ".join(f"{k} {v}" for k, v in sorted(statuses.items())))
    print(f"golden questions: {len(yaml.safe_load(GOLDEN.read_text()))}")

    if errors:
        print(f"\n{len(errors)} problem(s):")
        for e in errors:
            print(f"  ✗ {e}")
        sys.exit(1)
    print("\nall checks passed")


if __name__ == "__main__":
    main()
