"""Gate 2, RETRIEVE: hybrid retrieval with permission filtering before ranking.

One SQL round trip:
  - allowed chunks only (effective, persona's tenant or public, shared or persona's clients)
  - vector search + full-text search, fused with reciprocal rank fusion (RRF)
  - at most MAX_PER_DOC chunks per document, except documents named in the question
    (e.g. "DEV-2026-019"): those are included directly, not just boosted in the ranking
    (see pick_named)
  - plus an exclusion trace: close matches that the filters removed, and why.
    Authorisation is checked first: anything the persona may not see is only counted,
    never named (naming it would leak that it exists).
"""

import re
import time
from dataclasses import dataclass, field

import psycopg
from psycopg.rows import dict_row

from app.corpus import DOC_REF
from app.embedding import embed_query, to_pgvector

TOP_K = 5             # chunks returned to the answer step (kept small: free-tier LLM token limits)
CANDIDATES = 30       # per search arm, before fusion
MAX_PER_DOC = 2
MAX_NAMED_CHUNKS = 10  # bound for documents named in the question (token budget)
RRF_K = 60
MIN_SIMILARITY = 0.70  # best similarity below this = clearly off-topic → "not found" (can only make outcomes stricter)


@dataclass
class Hit:
    chunk_id: int
    document_id: int
    code: str
    version: str
    title: str
    doc_type: str
    record_state: str | None
    fingerprint: str | None
    section: str
    page: int | None
    text: str
    similarity: float
    score: float
    regulatory_status: str | None
    required_qualifier: str | None
    is_named: bool


@dataclass
class Retrieval:
    hits: list[Hit]
    found: bool
    best_similarity: float
    excluded: list[dict] = field(default_factory=list)
    ms: dict = field(default_factory=dict)


def source_id(hit: Hit) -> str:
    """Stable id the model uses to cite a passage in this request."""
    return f"c{hit.chunk_id}"


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
    SELECT id, row_number() OVER (ORDER BY embedding <=> %(qv)s::vector) AS r
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
named AS (  -- every allowed chunk of a document the question names; pick_named() chooses among them
    SELECT a.id FROM allowed a JOIN documents d ON d.id = a.document_id WHERE d.code = ANY (%(codes)s)
),
candidates AS (
    SELECT id, max(score) AS score FROM (
        SELECT id, score FROM fused UNION ALL SELECT id, 0.0 FROM named
    ) s GROUP BY id
),
capped AS (
    SELECT k.id, k.score, k.id IN (SELECT id FROM named) AS is_named,
           row_number() OVER (PARTITION BY c.document_id ORDER BY k.score DESC, c.ordinal) AS per_doc
      FROM candidates k JOIN chunks c ON c.id = k.id
),
excluded AS (  -- close matches the filters removed
    SELECT c.id, c.document_id, c.status, c.client_id, c.tenant_id
      FROM chunks c, persona p
     WHERE NOT (c.status = 'effective'
                AND c.tenant_id IN (p.tenant_id, 'public')
                AND (c.client_id IS NULL OR c.client_id = ANY (p.client_ids)))
     ORDER BY c.embedding <=> %(qv)s::vector LIMIT 10
)
SELECT 'hit' AS kind, c.id AS chunk_id, c.document_id, d.code, d.version, d.title, d.doc_type, d.record_state,
       d.fingerprint, c.section_path AS section, c.page, c.text,
       1 - (c.embedding <=> %(qv)s::vector) AS similarity, k.score::float8 AS score,
       d.regulatory_status, d.required_qualifier,
       k.is_named, c.ordinal, NULL AS status, NULL::boolean AS authorised
  FROM capped k JOIN chunks c ON c.id = k.id JOIN documents d ON d.id = c.document_id
 WHERE k.per_doc <= %(cap)s OR k.is_named
UNION ALL
-- Authorisation and status are separate fields: a passage the persona may not see is never
-- named, whatever its status (e.g. another client's superseded document).
SELECT 'excluded', e.id, e.document_id, d.code, d.version, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL::float8, NULL, NULL, NULL, NULL, e.status,
       coalesce(e.tenant_id IN (p.tenant_id, 'public')
                AND (e.client_id IS NULL OR e.client_id = ANY (p.client_ids)), false)
  FROM excluded e JOIN documents d ON d.id = e.document_id, persona p
"""

HIT_FIELDS = list(Hit.__dataclass_fields__)


def pick_named(rows: list[dict], codes: list[str], budget: int = MAX_NAMED_CHUNKS) -> list[dict]:
    """Chunks of the documents named in the question.

    Whole documents if they all fit in the budget. Otherwise the budget is shared in turn
    between the named documents (in the order the question names them), each giving its
    most relevant chunks first, so one long document cannot crowd out another.
    Returned in document order. A named document the persona may not see has no rows here."""
    if len(rows) <= budget:
        chosen = rows
    else:
        queues = [sorted((r for r in rows if r["code"] == code), key=lambda r: (-r["similarity"], r["ordinal"]))
                  for code in dict.fromkeys(codes)]
        chosen = []
        while len(chosen) < budget and any(queues):
            for q in queues:
                if q and len(chosen) < budget:
                    chosen.append(q.pop(0))
    order = {code: i for i, code in enumerate(dict.fromkeys(codes))}
    return sorted(chosen, key=lambda r: (order.get(r["code"], len(order)), r["ordinal"]))


def retrieve(conn: psycopg.Connection, persona: str, question: str) -> Retrieval:
    t0 = time.perf_counter()
    qv = to_pgvector(embed_query(question))
    t1 = time.perf_counter()
    codes = DOC_REF.findall(question.upper())
    with conn.cursor(row_factory=dict_row) as cur:
        rows = cur.execute(SQL, {"persona": persona, "qv": qv, "kq": keyword_query(question),
                                 "n": CANDIDATES, "rrf": RRF_K, "cap": MAX_PER_DOC, "codes": codes}).fetchall()
    t2 = time.perf_counter()

    hit_rows = [r for r in rows if r["kind"] == "hit"]
    named = pick_named([r for r in hit_rows if r["is_named"]], codes)
    named_ids = {r["chunk_id"] for r in named}
    ranked = sorted((r for r in hit_rows if r["chunk_id"] not in named_ids), key=lambda r: r["score"], reverse=True)
    picked = named + ranked[:max(TOP_K - len(named), 0)]
    hits = [Hit(**{k: r[k] for k in HIT_FIELDS}) for r in picked]
    best = max((h.similarity for h in hits), default=0.0)

    excluded, hidden = [], 0
    for r in rows:
        if r["kind"] != "excluded":
            continue
        if r["authorised"] is not True:  # never name what the persona may not see
            hidden += 1
        elif (item := {"document": f"{r['code']} v{r['version']}", "reason": r["status"]}) not in excluded:
            excluded.append(item)
    if hidden:
        excluded.append({"document": None,
                         "reason": f"{hidden} close passage(s) from documents you are not authorised to see"})

    # Named documents are explicit requests: being off-topic by similarity does not apply to them.
    found = bool(named) or best >= MIN_SIMILARITY
    return Retrieval(hits, found, round(float(best), 3), excluded,
                     {"embed": round((t1 - t0) * 1000), "query": round((t2 - t1) * 1000)})
