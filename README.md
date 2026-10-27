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
