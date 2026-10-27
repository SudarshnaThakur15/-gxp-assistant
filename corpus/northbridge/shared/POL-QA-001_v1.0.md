---
code: POL-QA-001
title: Intended Use of the AI Knowledge Assistant
version: "1.0"
status: effective
doc_type: policy
effective_date: 2026-09-01
review_date: 2027-09-01
owner: Head of Quality Assurance
tenant: northbridge
client: null
confidentiality: internal
---

> SYNTHETIC – DEMO ONLY. Fictional company, products and people.

# POL-QA-001 Intended Use of the AI Knowledge Assistant (v1.0)

## 1. Purpose
To define what the AI knowledge assistant may and may not be used for, so that its use stays
within non-critical, human-in-the-loop applications (draft EU GMP Annex 22 §1).

## 2. Users
Trained NorthBridge QA, QC and production staff. Users see only documents for the clients
they are assigned to.

## 3. Permitted uses
- Finding and summarising **effective**, approved documents, with citations.
- Preparing **investigation packs**: related past deviations, applicable SOP versions and
  specifications, for review by the investigator.
- Producing first drafts that a qualified person reviews before use.

## 4. Prohibited uses
The assistant must **refuse** to:
- make or recommend a **batch disposition, release or certification** decision;
- **classify** a deviation;
- determine a **root cause** or select a **CAPA**;
- answer from anything other than the approved documents it retrieves.

These decisions belong to the investigator, QA and the Qualified Person (SOP-QA-060 §5.2).

## 5. Risk tiers
| Tier | Example | Route |
|---|---|---|
| T1 | Answer to a question about an SOP or specification | Released with citations |
| T2 | Investigation pack or draft | Released only after review and electronic signature by a QA Manager |
| T3/T4 | Anything in §4 | Refused |

## 6. Records
Every question, retrieved source, answer, refusal and signature is recorded in the
tamper-evident audit trail.
