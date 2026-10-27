"""Hybrid retrieval with permission filtering before ranking.

One SQL round trip:
  - allowed chunks only (effective, persona's tenant or public, shared or persona's clients)
  - vector search + full-text search, fused with reciprocal rank fusion (RRF)
  - at most MAX_PER_DOC chunks per document
  - plus an exclusion trace: close matches that the filters removed, and why.
    Other clients' documents are only counted, never named (naming them would leak).
"""

import re
import time
from dataclasses import dataclass, field

import psycopg

from app.corpus import DOC_REF
from app.embedding import embed_query, to_pgvector

TOP_K = 8           # chunks returned to the answer step
CANDIDATES = 30     # per search arm, before fusion
MAX_PER_DOC = 2
RRF_K = 60
MIN_SIMILARITY = 0.70  # best vector similarity below this = "not found in approved documents" (tuned on eval/golden.yaml)


@dataclass
class Hit:
    chunk_id: int
    code: str
    version: str
    title: str
    section: str
    page: int | None
    text: str
    similarity: float
    score: float
    regulatory_status: str | None
    required_qualifier: str | None


@dataclass
class Retrieval:
    hits: list[Hit]
    found: bool
    best_similarity: float
    excluded: list[dict] = field(default_factory=list)
    ms: dict = field(default_factory=dict)


def keyword_query(question: str) -> str:
    # OR the words together; websearch_to_tsquery ANDs them by default, which is too strict for questions.
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9.\-]*", question)
    return " OR ".join(tokens) or "nothing"


SQL = """
WITH persona AS (
    SELECT tenant_id, client_ids FROM users WHERE id = %(persona)s
),
allowed AS (
    SELECT c.* FROM chunks c, persona p
     WHERE c.status = 'effective'
       AND c.tenant_id IN (p.tenant_id, 'public')
       AND (c.client_id IS NULL OR c.client_id = ANY (p.client_ids))
),
vec AS (
    SELECT id, row_number() OVER (ORDER BY embedding <=> %(qv)s::vector) AS r,
           1 - (embedding <=> %(qv)s::vector) AS sim
      FROM allowed ORDER BY embedding <=> %(qv)s::vector LIMIT %(n)s
),
kw AS (
    SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, q) DESC) AS r
      FROM allowed, websearch_to_tsquery('english', %(kq)s) q
     WHERE tsv @@ q ORDER BY ts_rank_cd(tsv, q) DESC LIMIT %(n)s
),
fused AS (
    SELECT coalesce(vec.id, kw.id) AS id,
           coalesce(1.0 / (%(rrf)s + vec.r), 0) + coalesce(1.0 / (%(rrf)s + kw.r), 0) AS score
      FROM vec FULL JOIN kw ON vec.id = kw.id
),
named AS (  -- documents the question names explicitly (e.g. "DEV-2026-019") are always included
    SELECT a.id, 1.0 AS score FROM allowed a JOIN documents d ON d.id = a.document_id
     WHERE d.code = ANY (%(codes)s)
),
scored AS (
    SELECT id, sum(score) AS score FROM (SELECT * FROM fused UNION ALL SELECT * FROM named) s GROUP BY id
),
capped AS (
    SELECT f.id, f.score, row_number() OVER (PARTITION BY c.document_id ORDER BY f.score DESC) AS per_doc
      FROM scored f JOIN chunks c ON c.id = f.id
),
excluded AS (  -- close matches the filters removed
    SELECT c.id, c.document_id, c.status, c.client_id, c.tenant_id
      FROM chunks c, persona p
     WHERE NOT (c.status = 'effective'
                AND c.tenant_id IN (p.tenant_id, 'public')
                AND (c.client_id IS NULL OR c.client_id = ANY (p.client_ids)))
     ORDER BY c.embedding <=> %(qv)s::vector LIMIT 10
)
SELECT 'hit', c.id, d.code, d.version, d.title, c.section_path, c.page, c.text,
       1 - (c.embedding <=> %(qv)s::vector), k.score, d.regulatory_status, d.required_qualifier, NULL
  FROM capped k JOIN chunks c ON c.id = k.id JOIN documents d ON d.id = c.document_id
 WHERE k.per_doc <= %(cap)s
UNION ALL
SELECT 'excluded', e.id, d.code, d.version, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       CASE WHEN e.status <> 'effective' THEN e.status ELSE 'not authorised' END
  FROM excluded e JOIN documents d ON d.id = e.document_id, persona p
"""


def retrieve(conn: psycopg.Connection, persona: str, question: str) -> Retrieval:
    t0 = time.perf_counter()
    qv = to_pgvector(embed_query(question))
    t1 = time.perf_counter()
    rows = conn.execute(SQL, {"persona": persona, "qv": qv, "kq": keyword_query(question),
                              "n": CANDIDATES, "rrf": RRF_K, "cap": MAX_PER_DOC,
                              "codes": DOC_REF.findall(question.upper())}).fetchall()
    t2 = time.perf_counter()

    hits = sorted((Hit(*r[1:12]) for r in rows if r[0] == "hit"), key=lambda h: h.score, reverse=True)[:TOP_K]
    best = max((h.similarity for h in hits), default=0.0)

    excluded, hidden = [], 0
    for r in rows:
        if r[0] != "excluded":
            continue
        if r[12] == "not authorised":
            hidden += 1
        else:
            item = {"document": f"{r[2]} v{r[3]}", "reason": r[12]}
            if item not in excluded:
                excluded.append(item)
    if hidden:
        excluded.append({"document": None, "reason": f"{hidden} close passage(s) from documents you are not authorised to see"})

    return Retrieval(hits, best >= MIN_SIMILARITY, round(best, 3), excluded,
                     {"embed": round((t1 - t0) * 1000), "query": round((t2 - t1) * 1000)})
