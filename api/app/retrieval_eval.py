"""Score retrieval against eval/golden.yaml.

    uv run python -m app.retrieval_eval

For each question: are the documents it must cite retrieved, are forbidden
documents (other client, superseded version) absent, and does the coarse
"found" floor agree on not_found questions? Retrieval only; answers are judged later.
"""

import yaml

from app.corpus import REPO_ROOT
from app.db import connect
from app.retrieval import retrieve


def doc_key(ref: str) -> tuple[str, str | None]:
    code, _, rest = ref.partition("@")
    return code, (rest.split(" §")[0] if rest else None)


def main() -> None:
    questions = yaml.safe_load((REPO_ROOT / "eval" / "golden.yaml").read_text())
    hit_needed = hit_got = leaks = 0
    with connect() as conn:
        for q in questions:
            r = retrieve(conn, q["persona"], q["question"])
            got = {(h.code, h.version) for h in r.hits}
            missing = [c for c, v in map(doc_key, q.get("must_cite", [])) if (c, v) not in got]
            leaked = [f"{c} v{v}" if v else c for c, v in map(doc_key, q.get("must_not_cite", []))
                      if any(gc == c and (v is None or gv == v) for gc, gv in got)]
            hit_needed += len(q.get("must_cite", []))
            hit_got += len(q.get("must_cite", [])) - len(missing)
            leaks += len(leaked)
            print(f"{q['id']} {q['split']:<7} {q['expect']:<12} best={r.best_similarity:.3f} found={r.found!s:<5} "
                  f"missing={missing or '-'} leaked={leaked or '-'} {r.ms['query']}ms")
    print(f"\nretrieval hit rate {hit_got}/{hit_needed} = {hit_got / hit_needed:.0%}; leaks {leaks}")


if __name__ == "__main__":
    main()
