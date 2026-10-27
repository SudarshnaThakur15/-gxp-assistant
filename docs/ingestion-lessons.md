# Ingestion: lessons for building the real product

What we learned hardening document ingestion in the demo, written so it can be reused when
building the production system. Each lesson: **the problem**, **how it showed up**, **the fix**,
and **what to do in production**.

Ingestion = taking documents from where they live, checking them, cutting them into
citable pieces ("chunks"), turning each piece into numbers that capture its meaning
("embeddings"), and storing everything so search can find it.

---

## 1. Re-process when *anything* that shapes the output changes, not just the file

**Problem.** We skipped a document when its file was unchanged. But we then improved the PDF
parser, and the database silently kept the old pieces (343 stored vs 318 the new parser makes).

**Fix.** Each document gets a **fingerprint** built from everything that affects its stored form:
the file's hash, the parser name + rule version, the embedding model, and the metadata that goes
into the embedded text or changes parsing (code, version, title, `line_numbers`). Any change →
re-process. Parser rule changes are signalled by bumping a version suffix (`pdfplumber 0.11/2`).

**Production.** Version every stage (parser, chunker, embedding model, prompt context line).
Store all of them per document so you can answer "which documents were built with the old rules?"

## 2. Fail closed: what leaves the source must leave the library

**Problem.** If a document was deleted from the source, or its DMS record later arrived without a
status, the database still marked the old copy `effective`, so the AI could keep citing it.

**Fix.** Every run **reconciles**: anything in the database that is not an accepted source is
marked `withdrawn` (with the reason in the audit log). Content-level rejections (e.g. no readable
text) also withdraw an existing copy. Nothing is deleted, so old answers stay reconstructable.

**Production.** Prefer **event-driven sync** from the DMS (document effective / superseded /
obsolete events) plus a nightly full reconciliation as a safety net. Alert when withdrawals spike.

## 3. Let the database enforce the rules that matter most

**Problem.** "Only one effective version per document" was checked only by our Python checker.

**Fix.** A partial unique index: `UNIQUE (code) WHERE status = 'effective'`. Within a run,
demotions (superseded / withdrawn) are applied **before** new effective versions, so the index
never sees two effective rows mid-run.

**Production.** Put every safety invariant in the database too (constraints, triggers), not only
in application code: there will be more than one writer eventually.

## 4. One bad file must never stop the run

**Problem.** An encrypted, corrupt or unexpected file raised an exception and killed ingestion
for every other document. (Seen for real: a bug made all 26 fail, and the run still completed,
recorded each failure, and exited non-zero.)

**Fix.** Each document is processed in its own try/except and its own transaction. Failures are
logged (`failed` in the run summary, audit event) and the process exits with an error code.

**Production.** Add a retry queue / dead-letter list for failed documents and an alert on any failure.

## 5. Detect "no text" documents (scanned PDFs)

**Problem.** A scanned PDF is a picture; text extraction returns nothing, and it would have entered
the library empty: present but unsearchable, with no warning.

**Fix.** If a document yields fewer than 30 words, it is **rejected** with
"needs OCR", never ingested empty.

**Production.** Route these to an OCR step (e.g. a document-intelligence service), and compare
words-per-page against expectations to catch partially scanned files.

## 6. Bound memory: embed in small batches

**Problem.** Embedding 343 pieces in one call on a 5 GB laptop got the process killed (exit 137).

**Fix.** Embed in batches of 32. Peak memory for a full run dropped from 1.3 GB to 1.0 GB, and a
300-page document can no longer exhaust memory.

**Production.** Batch size is a tuning knob; run embedding in a worker with a memory limit.

## 7. Don't re-embed what didn't change

**Problem.** Editing one section of a long SOP re-embedded every piece.

**Fix.** Before embedding, load the document's existing pieces; any piece whose exact text and
section are unchanged keeps its vector. Example: the Word SOP re-processed with **0** new embeddings.

**Production.** Embedding cost and time scale with *changes*, not corpus size. Key reuse on the
exact embedded text and the model name.

## 8. Count database round trips, not just queries

**Problem.** From the laptop each round trip to the EU database takes ~250 ms. Inserting chunks
one statement each would cost seconds per document.

**Fix.** All chunks of a document are sent in **one** statement (arrays + `unnest`). Learned the
hard way: a `WITH … DELETE … INSERT` in one statement does **not** work for replacing rows with the
same keys, because both parts see the same snapshot; the delete must be its own statement
(still in the same transaction).

**Production.** Run ingestion close to the database (same region), use bulk paths (`COPY`, arrays),
and measure round trips.

## 9. Only one ingestion at a time

**Problem.** Two concurrent runs could interleave writes to the same document.

**Fix.** `pg_try_advisory_lock` at the start; a second run exits with a clear message.

**Production.** Same lock, or a single-consumer job queue.

## 10. Normalise text once, the same way everywhere

**Problem.** PDFs contain ligatures (ﬁ), non-breaking spaces, words hyphenated across lines
(10 in our PDFs: "manufac- turing") and running headers on every page ("ICH Q9(R1) Guideline").
These hurt keyword search and will break exact-quote checking later.

**Fix.** Unicode NFKC normalisation, join hyphenated line breaks, collapse whitespace, and drop
lines that repeat on at least half the pages (headers/footers).

**Production.** The *same* normalisation function must be used for stored text, search queries and
quote verification; otherwise a correct quote can "fail" the check.

## 11. Treat DMS exports as hostile input

**Problems found.** Excel-saved CSVs start with a byte-order mark (corrupts the first column name);
status values arrive as `EFFECTIVE` / `effective`; a file name like `../../secret` could read files
outside the export folder; duplicate rows used to abort the whole run.

**Fix.** Read with `utf-8-sig`; map values case-insensitively; reject any path that resolves
outside the export folder; duplicate or conflicting DMS records (two effective versions) are
**rejected individually** (fail closed) instead of blocking every other document.

**Production.** Validate every external field against a schema, log the raw record with the
rejection, and give document control a report of rejected records to fix at the source.

## 12. Real Word documents number headings automatically

**Problem.** Most real SOPs use Word's automatic heading numbering, so the "5.2" is not in the text
and citations would lose their section numbers.

**Fix.** If a heading has no number in its text but has (or inherits) Word numbering, compute the
number from heading levels (1 → 2 → 2.1 → 2.2 → 3).

**Production.** This approximates Word's numbering; restarts and custom formats exist. Where
precision matters, render the document (e.g. to PDF) and read the visible numbers, or compare
both and flag mismatches.

---

## Checklist for the production ingestion service

- [ ] Fingerprint = file + every stage version + parse-affecting metadata
- [ ] Reconcile every run; withdraw (never delete) what left the source; event-driven sync from the DMS
- [ ] Database constraints for the core invariants (one effective version, access fields on chunks)
- [ ] Per-document isolation, retries, dead-letter list, alerts
- [ ] OCR route for no-text documents
- [ ] Bounded batches; incremental re-embedding; bulk inserts; ingest near the database
- [ ] Single-run lock or single-consumer queue
- [ ] One shared text-normalisation function (storage, search, quote checks)
- [ ] Schema validation and path safety for all DMS input; rejection report to document control
- [ ] Heading numbers verified against the rendered document where precision matters
- [ ] Every run, document, change, withdrawal, rejection and failure written to the audit trail
