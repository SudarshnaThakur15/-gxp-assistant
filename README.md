# GxP Knowledge Assistant (demo)

Governed retrieval over a dummy CDMO's approved documents: cited answers, a
deterministic assurance layer, risk tiers, e-signature review and a
tamper-evident audit trail.

```
api/   Python FastAPI: retrieval, AI calls, assurance layer, audit trail (owns all DB access)
web/   Next.js UI: calls the API server-side, never the database
neon.ts  Neon services for this project (Postgres)
```

## Setup

Prerequisites: Node 24, [uv](https://docs.astral.sh/uv/), Neon CLI (`npm i -g neon`).

```bash
neon login --profile sudarshna   # the Neon account that owns project icy-haze-75054773
npm run db:env                   # pull DATABASE_URL / DATABASE_URL_UNPOOLED into .env
# add GROQ_API_KEY to .env (see .env.example)
npm install && npm --prefix web install && (cd api && uv sync)
npm run migrate                  # applies api/migrations/*.sql over the direct URL
```

The default Neon CLI profile on this machine belongs to a different account, so
Neon commands here always pass `--profile sudarshna` (the `db:*` scripts do this).

## Run

```bash
npm run dev:api   # http://localhost:8000  (GET /health/db = end-to-end DB check)
npm run dev:web   # http://localhost:3000
npm run build     # web production build + API compile check
```

## Knowledge base

```
corpus/public/            4 official guidelines (EU GMP Annex 11, draft Annex 22, ICH Q9(R1), ICH Q10) + *.meta.yaml
corpus/northbridge/       synthetic CDMO documents: shared/ SOPs, client-a/ Aldermoor, client-b/ Corvane
eval/golden.yaml          16 test questions with expected citations, refusals and holdout split
```

Every Markdown document carries its metadata (code, version, status, client, …) in a YAML
header. Sources and licences for the public guidelines are in `corpus/SOURCES.md`.

A third source type shows how real client documents arrive: `northbridge/dms-export/` holds
unmodified Word files plus a `dms_export.csv` (shaped like a Veeva/MasterControl export) and a
`mapping.yaml` that maps its columns onto our fields. A record with missing metadata (here,
SOP-WH-090 has no status) is **rejected at ingestion and logged**, never guessed at.

```bash
cd api
uv run python -m app.corpus_check   # metadata, lifecycle, client walls, golden citations vs parsed sections
uv run python -m app.ingest         # parse → chunk → embed locally (bge-small) → Neon; idempotent
```

Ingestion re-embeds a document only when its file, parser or embedding model changes; a
metadata-only change (e.g. a new review date in the DMS) updates the record without re-embedding.
Every ingested document, metadata change, withdrawal, run summary, rejection and failure is written to the audit trail. Design notes and lessons: `docs/ingestion-lessons.md`.

## Question pipeline: the 7 gates

The AI generates; a deterministic Assurance Layer (`api/app/assurance.py`, no AI inside) verifies.
Every question passes the same gates in the same order (`api/app/pipeline.py`):

| Gate | What happens | Code |
|---|---|---|
| 1 Screen | Rules block prohibited decisions (S1 release/disposition, S2 classification, S3 root cause, S4 CAPA selection, S5 instruction override); the AI classifier runs only if no rule refused, and can only make the outcome stricter | `assurance.screen_rules`, `screening.py` |
| 2 Retrieve | Approved, in-force versions the user may see; exclusion trace | `retrieval.py` |
| 3 Generate | The AI drafts cited claims only, each with a verbatim quote | `answer.py` |
| 4 Validate | V1–V9: claims present, citations retrieved, versions in force, quotes word for word, quotes substantive, numbers in source, no decision language, injected text not repeated, draft-guidance label | `assurance.validate` |
| 5 Tier | T1 knowledge → release; T2 investigation or procedure requiring a person → hold for review; T3 prohibited → refuse | `assurance.tier` |
| 6 Record | Hash-chained audit entry with inputs, outputs, gate results, rule-set version + fingerprint, prompt versions, model id, committed before release | `pipeline.ask` |
| 7 Release | Released by rules / Held for review / Refused | `assurance.release`, `pipeline.public_view` |

```bash
cd api
uv run pytest -q                        # Assurance Layer unit tests (no AI, no database)
uv run python -m app.retrieval_eval     # retrieval only
uv run python -m app.answer_eval        # all 7 gates over eval/golden.yaml (calls the model; several minutes)
```

`POST /ask {"persona", "question"}` runs the pipeline and returns only the public view: a draft
held for review is never returned to the requester. If the audit entry cannot be written, the
API returns 503 and nothing is released.

## Audit trail

`audit_log` is append-only (UPDATE/DELETE/TRUNCATE are blocked by triggers) and
hash-chained: each entry stores `sha256(prev_hash:seq:record)`. `GET /audit/verify`
recomputes every hash and reports the first entry that no longer matches.

```bash
cd api
uv run python -m app.audit_cli append --count 5   # sample entries
uv run python -m app.audit_cli verify             # chain intact: 5 entries
uv run python -m app.audit_cli tamper 3           # admin bypasses the trigger and edits #3
uv run python -m app.audit_cli verify             # CHAIN BROKEN at entry #3
uv run python -m app.audit_cli restore            # put #3 back for the next rehearsal
```
