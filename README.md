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
