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

## Web interface

The persona switcher in the sidebar stands in for sign-in. Every screen reads from the API, and
the API builds every view from the audit log.

| Page | What it shows |
|---|---|
| `/` Console | Ask a question; live counts; answers waiting for your signature; recent questions |
| `/runs`, `/runs/{n}` | Every run with filters; one run's answer, reasons, 11 checks, 7-gate trace, signature and history |
| `/runs/{n}/evidence` | Printable inspection evidence pack assembled from the audit trail |
| `/reviews` | Held answers with the electronic signature form (QA Managers) |
| `/how-it-works` | The 7 gates, who decides each, live counts |
| `/assurance` | Every rule in plain English, rule-set fingerprint, failures recorded, and the assurance lab: bad drafts run live through the rules (no AI) |
| `/documents`, `/documents/{code}` | Controlled documents and versions; citations link to the exact section |
| `/audit` | Chain verification, every entry, CSV export (entry contents for QA Managers only) |
| `/proof` | The saved golden-set evaluation (`answer_eval --save`): expected vs actual outcome, unsafe releases; adjustable ROI model |
| `/trust` | Data boundary (the AI model host is external), safeguards with live checks, recent AI calls |
| `/sources` | The three document sources and the last import, including rejected files |

What a persona sees is enforced by the API, not the page: requesters see their own runs, a QA
Manager sees the runs of the programmes they cover, and withheld drafts and entry contents are
shown only to signers.

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
uv run pytest -q                        # unit tests: rules, lab, signatures (no AI, no database)
RUN_DB_TESTS=1 uv run pytest -q tests/test_retrieval_db.py   # permission tests on the real database (rolled back)
uv run python -m app.retrieval_eval     # retrieval only
uv run python -m app.answer_eval        # all 7 gates over eval/golden.yaml (calls the model; several minutes)
```

`POST /ask {"persona", "question"}` runs the pipeline and returns only the public view: a draft
held for review is never returned to the requester. If the audit entry cannot be written, the
API returns 503 and nothing is released.

## QA review and electronic signature

An answer held for review (tier T2) reaches its requester only after a QA Manager signs it
(`app/review.py`). The audit log is the only record: the review queue is the list of held `ask`
entries without a `review` entry, and each decision is a new audit entry.

| Control (21 CFR Part 11 / EU GMP Annex 11) | How |
|---|---|
| Who may sign | `can_sign` users only; never on their own question; must have access to every cited document |
| Identity at signing | Password re-entered for every signature; stored only as a scrypt hash |
| Signature manifestation | Printed name, title, date and time (UTC) and meaning (approved / rejected + reason) |
| Signature linked to the record | Stores the SHA-256 of the exact text and citations signed; a later change makes the answer refused |
| Re-check before approval | Every cited version must still be in force with the same fingerprint |
| Failed attempts | Every refused attempt is recorded; 3 wrong passwords in 15 minutes lock signing |
| No editing | Approve or reject only; editing would bypass the validation checks |

```bash
cd api
uv run python -m app.review_cli set-password qa-manager    # hidden prompt
uv run python -m app.review_cli queue qa-manager
uv run python -m app.review_cli sign 72 --as qa-manager --approve
uv run python -m app.review_cli status 72 --as qa-analyst-a
```

API: `GET /reviews?persona=` (queue, signers only), `POST /reviews/{seq}`
`{"persona", "decision": "approve" | "reject", "password", "reason"}`, and
`GET /answers/{seq}?persona=` for the requester (the `receipt.audit_seq` returned by `/ask`).

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
