"""ICH Q9 alignment, controls against the regulations, and the platform's own risk assessment.

Every document reference here is resolved against the library when a page loads: a clause
that no longer resolves to an in-force section is shown as unresolved, and a quote is shown
only if the in-force text contains it word for word. Gaps are listed, not hidden.
"""

import psycopg

from app import assurance
from app.assurance_info import TIER_RULES

SECTIONS_SQL = """
SELECT d.code, d.version, d.title, c.section_path, c.text
  FROM chunks c JOIN documents d ON d.id = c.document_id
 WHERE d.code = ANY (%s) AND d.status = 'effective' AND d.client_id IS NULL
 ORDER BY d.code, c.ordinal
"""
# Every recorded question (automated test runs excluded), with the QA decision on held ones.
ROUTES_SQL = """
SELECT a.payload ->> 'tier', a.payload ->> 'decision', a.payload ->> 'answer_type', r.payload ->> 'outcome'
  FROM audit_log a
  JOIN users q ON q.id = a.payload ->> 'persona' AND NOT q.is_test
  LEFT JOIN audit_log r ON r.event_type = 'review' AND (r.payload ->> 'ask_seq')::bigint = a.seq
 WHERE a.event_type = 'ask'
"""
CAUGHT_SQL = """
SELECT c ->> 'id', count(*) FROM audit_log a, jsonb_array_elements(a.payload -> 'checks') c
 WHERE a.event_type = 'ask' AND c ->> 'status' = 'fail' GROUP BY 1
UNION ALL
SELECT s ->> 'rule', count(*) FROM audit_log a, jsonb_array_elements(a.payload -> 'screen' -> 'rules') s
 WHERE a.event_type = 'ask' GROUP BY 1
"""


class Library:
    """The in-force sections of the documents a page cites, loaded in one query."""

    def __init__(self, conn: psycopg.Connection, codes: set[str]):
        self.rows = conn.execute(SECTIONS_SQL, (sorted(codes),)).fetchall()

    def ref(self, code: str, section: str, label: str, quote: str | None = None) -> dict:
        """A citation to the first in-force section numbered `section` (or below it)."""
        hits = [r for r in self.rows if r[0] == code and
                (r[3] == section or r[3].startswith(section + " ") or r[3].startswith(section + "."))]
        if quote:
            hits = [r for r in hits if assurance.evidence_form(quote) in assurance.evidence_form(r[4])]
        if not hits:
            return {"doc": code, "section": section, "label": label, "resolved": False}
        code_, version, title, path, _ = hits[0]
        return {"doc": code_, "version": version, "title": title, "section": path, "label": label,
                "quote": quote, "resolved": True}


# --- ICH Q9 alignment -------------------------------------------------------------

Q9_PRINCIPLES = [
    ("3", "The evaluation of the risk to quality should be based on scientific knowledge and ultimately link to "
          "the protection of the patient",
     "Every answer comes from approved, in-force documents and quotes them word for word. The AI's own opinion "
     "never counts as evidence."),
    ("3", "The level of effort, formality and documentation of the quality risk management process should be "
          "commensurate with the level of risk",
     "Tier 1 answers are released by fixed checks and recorded; tier 2 answers need a named QA Manager's "
     "e-signature; decisions reserved for people are refused outright."),
    ("5.1", "formality can be considered a continuum (or spectrum), ranging from low to high",
     "The three tiers are three points on that continuum, each with its own route, reviewer and record."),
    ("5.3", "Subjectivity can impact every stage of a quality risk management process",
     "The tier comes from fixed, written rules, never from the AI's confidence: the same question always "
     "gets the same route, and the rule that decided it is named."),
    ("5.2", "Risk-based decision-making is inherent in all quality risk management activities",
     "The assistant prepares the evidence. Decisions such as batch release, deviation classification, root "
     "cause and CAPA stay with the people responsible for them."),
]

Q9_TIERS = [
    {"tier": "T1", "risk": "Low", "what": "What an approved SOP, specification or guideline says",
     "formality": "Fixed checks on every claim, citations, audit record",
     "who": "No one before use; QA and auditors can review any answer afterwards", "route": "Answered straight away"},
    {"tier": "T2", "risk": "Medium",
     "what": "Investigation support, or an answer quoting a procedure that requires a person to act",
     "formality": "A named QA Manager reviews and e-signs; the meaning of the signature is recorded",
     "who": "A QA Manager, never the person who asked", "route": "Waits for QA sign-off"},
    {"tier": "T3", "risk": "High",
     "what": "A decision reserved for people: batch release, deviation classification, root cause, CAPA",
     "formality": "Highest: the assistant does not take part",
     "who": "The investigator, QA or the Qualified Person, outside the assistant",
     "route": "Not answered; the reason and its source documents are shown"},
]
OUTCOMES = ["released", "not_found", "held", "approved", "rejected", "refused"]


def _outcome(decision: str, answer_type: str, review: str | None) -> str:
    if review:
        return review
    if decision == "held_for_review":
        return "held"
    if decision == "refused":
        return "refused"
    return "not_found" if answer_type == "not_found" else "released"


def q9(conn: psycopg.Connection) -> dict:
    lib = Library(conn, {"ICH-Q9R1"})
    grid = {t["tier"]: dict.fromkeys(OUTCOMES, 0) for t in Q9_TIERS}
    off_route = 0  # answers released although their tier required a person, or a T3 not refused
    for tier, decision, answer_type, review in conn.execute(ROUTES_SQL).fetchall():
        if tier not in grid:
            continue  # "n/a": a failed AI step, refused before any tier applied
        o = _outcome(decision, answer_type, review)
        grid[tier][o] += 1
        if (tier == "T3" and o != "refused") or (tier == "T2" and o == "released" and answer_type == "answer"):
            off_route += 1
    return {
        "principles": [{"ref": lib.ref("ICH-Q9R1", s, f"ICH Q9(R1) §{s}", quote), "how": how}
                       for s, quote, how in Q9_PRINCIPLES],
        "tiers": Q9_TIERS, "tier_rules": TIER_RULES,
        "grid": grid, "outcomes": OUTCOMES, "off_route": off_route,
    }


# --- Controls and validation ------------------------------------------------------

def _c(issuer, reg, requirement, status, company=(), system=(), evidence=None, note=None):
    return {"issuer": issuer, "reg": reg, "requirement": requirement, "status": status,
            "company": list(company), "system": list(system), "evidence": evidence, "note": note}


ANX11, ANX22, Q9R1, Q10 = "EU-GMP-ANX11", "EU-GMP-ANX22-DRAFT", "ICH-Q9R1", "ICH-Q10"
PART11 = "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11"

CONTROLS = [
    _c("EU", (ANX11, "1", "Annex 11 §1 Risk management"), "Risk management throughout the system's lifecycle",
       "covered", [("POL-QA-001", "5", "Risk tiers")], ["Tier rules R-INV-Q, R-INV-AI, R-INV-DOC, R-HUMAN"],
       ("ICH Q9 alignment", "/q9")),
    _c("EU", (ANX11, "4", "Annex 11 §4 Validation"), "The system is validated for its intended use",
       "gap", [], ["Golden-set evaluation with held-out questions", "Assurance lab and automated tests"],
       ("Proof and value", "/proof"),
       "Not validated: there are no user requirements, validation plan or report. The evaluation is supporting "
       "evidence, not validation."),
    _c("EU", (ANX11, "6", "Annex 11 §6 Accuracy checks"), "Built-in checks for the correct and secure entry "
       "and processing of data", "covered", [],
       ["11 checks on every AI draft (V1–V11)", "Every quote verified word for word"], ("Rules and checks", "/assurance")),
    _c("EU", (ANX11, "7", "Annex 11 §7 Data storage"), "Data secured, accessible and backed up",
       "gap", [], ["Managed cloud database"], None,
       "Backup and restore have not been verified for this demo."),
    _c("EU", (ANX11, "9", "Annex 11 §9 Audit trails"), "A record of all GMP-relevant changes and deletions",
       "covered", [("SOP-QA-030", "5", "Electronic records")],
       ["Append-only, hash-chained audit trail", "The database refuses changes and deletions",
        "Recorded before anything is released"], ("Audit trail", "/audit")),
    _c("EU", (ANX11, "10", "Annex 11 §10 Change and configuration management"),
       "Changes made in a controlled manner", "partial", [("SOP-QA-020", "1", "Purpose")],
       ["Rule-set version and fingerprint on every record", "Prompt fingerprints", "Pinned model version"],
       ("Rules and checks", "/assurance"), "No formal change records are kept for the demo itself."),
    _c("EU", (ANX11, "11", "Annex 11 §11 Periodic evaluation"), "Periodic evaluation of the validated state",
       "partial", [], ["Golden-set evaluation re-run after changes"], ("Proof and value", "/proof"),
       "Re-run on demand; there is no scheduled periodic review."),
    _c("EU", (ANX11, "12", "Annex 11 §12 Security"), "Access restricted to authorised persons",
       "partial", [("POL-QA-001", "2", "Users")],
       ["Client walls applied in the database before ranking", "Role-based access; auditors read-only"],
       ("Trust centre", "/trust"), "The persona switcher stands in for sign-in; production needs company sign-in."),
    _c("EU", (ANX11, "13", "Annex 11 §13 Incident management"), "Incidents reported, assessed and resolved",
       "partial", [("SOP-QA-012", "1", "Purpose")], ["Failed AI steps are recorded as refusals"], None,
       "No incident process specific to the assistant."),
    _c("EU", (ANX11, "14", "Annex 11 §14 Electronic signature"), "E-signatures with the same impact as "
       "hand-written ones, permanently linked to the record", "covered", [],
       ["Password e-signature with recorded meaning", "Signed content hash re-checked",
        "Nobody signs their own question"], ("Review inbox", "/reviews")),
    _c("EU", (ANX11, "16", "Annex 11 §16 Business continuity"), "Provisions for continuity if the system "
       "breaks down", "gap", [], [], None, "Not addressed in the demo."),
    _c("EU", (ANX11, "17", "Annex 11 §17 Archiving"), "Archived data checked for accessibility and integrity",
       "partial", [("SOP-QA-030", "7", "Archiving")], ["Audit trail export (CSV) and live chain check"],
       ("Audit trail", "/audit")),
    _c("EU", (ANX22, "1", "Draft Annex 22 §1 Scope"), "Generative AI should not be used in critical GMP "
       "applications", "covered", [("POL-QA-001", "4", "Prohibited uses")], ["Screening rules S1–S5"],
       ("Rules and checks", "/assurance")),
    _c("EU", (ANX22, "3.1", "Draft Annex 22 §3.1 Intended use"), "The intended use is described and approved",
       "covered", [("POL-QA-001", "1", "Purpose"), ("POL-QA-001", "3", "Permitted uses")], []),
    _c("EU", (ANX22, "3.3", "Draft Annex 22 §3.3 Human-in-the-loop"), "The operator's responsibility is part "
       "of the intended use", "covered", [("POL-QA-001", "5", "Risk tiers")],
       ["Tier 2 answers held for a QA Manager's e-signature"], ("Review inbox", "/reviews")),
    _c("EU", (ANX22, "4.2", "Draft Annex 22 §4 Test metrics and acceptance criteria"), "Performance measured "
       "against acceptance criteria set in advance", "partial", [],
       ["21 golden questions with expected outcomes written before tuning"], ("Proof and value", "/proof"),
       "A small set; acceptance criteria are not formally approved."),
    _c("EU", (ANX22, "6.2", "Draft Annex 22 §6 Independence of test data"), "Test data kept apart from the data "
       "used to build the system", "partial", [], ["Held-out questions tracked as clean or contaminated"],
       ("Proof and value", "/proof")),
    _c("EU", (ANX22, "9.2", "Draft Annex 22 §9 Confidence threshold"), "Predictions made only when the model "
       "is confident enough", "by_design", [], ["No decision depends on the AI's confidence"], ("ICH Q9 alignment", "/q9"),
       "Fixed rules route every answer; when the documents do not support an answer it is 'not found' or held, "
       "never guessed."),
    _c("EU", (ANX22, "10.1", "Draft Annex 22 §10 Change control and monitoring"), "Changes controlled and "
       "performance monitored in operation", "partial", [("SOP-QA-020", "1", "Purpose")],
       ["Fingerprints on every record", "Evaluation re-run after changes"], ("Proof and value", "/proof")),
    _c("EU", (ANX22, "10.5", "Draft Annex 22 §10.5 Human review"), "Outputs reviewed by a person where required",
       "covered", [], ["Review inbox with e-signature"], ("Review inbox", "/reviews")),
    _c("ICH", (Q9R1, "5.1", "ICH Q9(R1) §5.1 Formality"), "Formality matched to the level of risk",
       "covered", [("POL-QA-001", "5", "Risk tiers")], ["Three tiers, each with its own route"], ("ICH Q9 alignment", "/q9")),
    _c("ICH", (Q9R1, "5.3", "ICH Q9(R1) §5.3 Subjectivity"), "Subjectivity managed and minimised",
       "covered", [], ["Routing by fixed, written rules"], ("Rules and checks", "/assurance")),
    _c("ICH", (Q10, "1.6.1", "ICH Q10 §1.6.1 Knowledge management"), "Product and process knowledge managed "
       "and shared", "covered", [("SOP-QA-030", "3", "Document lifecycle")],
       ["Answers only from approved, in-force versions"], ("Document library", "/documents")),
    _c("FDA", ("PART11", "11.10(e)", "21 CFR 11.10(e) Audit trails"), "Secure, time-stamped audit trails",
       "covered", [], ["Hash-chained audit trail"], ("Audit trail", "/audit")),
    _c("FDA", ("PART11", "11.50", "21 CFR 11.50 and 11.70 Signature manifestation and linking"),
       "Signed records show who, when and what the signature means, and stay linked", "covered", [],
       ["Signature line with name, time and meaning", "Signature bound to the content hash"], ("Review inbox", "/reviews")),
    _c("FDA", ("PART11", "11.300", "21 CFR 11.200 and 11.300 Signature controls"), "Signatures use distinct "
       "identification components and controls against misuse", "partial", [],
       ["Password with lockout after 3 failures in 15 minutes"], ("Review inbox", "/reviews"),
       "Identity comes from the demo persona switcher, not two distinct identification components."),
]


def controls(conn: psycopg.Connection) -> dict:
    codes = {r["reg"][0] for r in CONTROLS} | {d for r in CONTROLS for d, _, _ in r["company"]}
    lib = Library(conn, codes - {"PART11"})
    rows = []
    for r in CONTROLS:
        code, section, label = r["reg"]
        reg = ({"doc": "21 CFR Part 11", "section": section, "label": label, "resolved": True, "external": PART11}
               if code == "PART11" else lib.ref(code, section, label))
        rows.append(r | {"reg": reg, "company": [lib.ref(d, s, f"{d} §{s} {t}") for d, s, t in r["company"]]})
    counts = {s: sum(r["status"] == s for r in rows) for s in ("covered", "partial", "gap", "by_design")}
    return {"rows": rows, "counts": counts}


# --- Platform risk (FMEA of the assistant itself) -----------------------------------

def _risk(id_, component, failure, effect, s, before, after, measures, residual_note=None):
    (o1, d1), (o2, d2) = before, after
    return {"id": id_, "component": component, "failure": failure, "effect": effect, "severity": s,
            "before": {"o": o1, "d": d1, "rpn": s * o1 * d1}, "after": {"o": o2, "d": d2, "rpn": s * o2 * d2},
            "measures": measures, "note": residual_note}


RISKS = [
    _risk("R01", "Drafting (AI)", "States something the documents do not say", "Wrong GMP information is used", 4,
          (4, 4), (2, 2), ["V1", "V2", "V4", "V5", "V6", "V10", "V11"]),
    _risk("R02", "Search", "Grounds an answer in a superseded or draft version", "Out-of-date instruction followed", 4,
          (3, 4), (1, 2), ["Only in-force versions are searched", "V3", "V9"]),
    _risk("R03", "Search", "Shows one client's information to another client's team", "Confidentiality breach", 5,
          (3, 4), (1, 2), ["Client walls applied before ranking", "Excluded documents counted, never named"]),
    _risk("R04", "Drafting (AI)", "Follows instructions planted inside a record", "Manipulated answer", 4,
          (3, 3), (2, 2), ["S5", "V8", "Planted text flagged and treated as data"]),
    _risk("R05", "Screening", "Makes a decision reserved for people", "Batch release or CAPA decided by software", 5,
          (3, 3), (1, 1), ["S1", "S2", "S3", "S4", "V7", "Refusal cites SOP-QA-060 and POL-QA-001"]),
    _risk("R06", "Chats", "A prohibited request is split across two messages", "Rule bypassed", 5,
          (3, 4), (1, 2), ["Follow-ups screened as typed and as rewritten",
                           "Targets named earlier carried into screening", "Rewrite may not add codes"]),
    _risk("R07", "Routing", "An answer that needs a person is released automatically", "Unreviewed use", 4,
          (3, 3), (1, 2), ["R-HUMAN", "R-INV-Q", "R-INV-AI", "R-INV-DOC"]),
    _risk("R08", "Audit trail", "A record is changed or deleted afterwards", "Evidence lost", 4,
          (2, 4), (1, 1), ["Database refuses changes and deletions", "Hash chain verified live",
                           "Recorded before release"]),
    _risk("R09", "E-signature", "Signature misused: own question, guessed password, altered text",
          "Invalid approval", 4, (2, 3), (1, 1),
          ["Nobody signs their own question", "Lockout after 3 failures in 15 minutes", "Signed content re-checked"]),
    _risk("R10", "AI service", "The AI service fails or returns malformed output", "No answer, or a broken one", 3,
          (3, 2), (3, 1), ["No fallback model", "A failure is recorded as a refusal"],
          "Occurrence depends on the AI provider and stays the same; detection is certain."),
    _risk("R11", "Change", "A model or prompt change silently alters behaviour", "Unvalidated behaviour", 4,
          (3, 4), (2, 2), ["Pinned model version", "Rule-set and prompt fingerprints on every record",
                           "Golden set re-run after changes"]),
    _risk("R12", "People", "Users trust an answer without reading its sources", "Automation bias", 4,
          (3, 4), (3, 3), ["Plain status line on every answer", "Sources and checks one click away"],
          "The highest residual risk: needs user training and periodic review, which the demo cannot show."),
]


def rule_ids() -> set[str]:
    return set(assurance.SCREEN_RULES) | set(assurance.CHECKS) | {r["id"] for r in TIER_RULES}


def platform_risk(conn: psycopg.Connection) -> dict:
    caught = dict(conn.execute(CAUGHT_SQL).fetchall())
    titles = ({k: v["title"] for k, v in assurance.SCREEN_RULES.items()}
              | {k: v[0] for k, v in assurance.CHECKS.items()} | {r["id"]: r["rule"] for r in TIER_RULES})
    risks = [r | {"measures": [{"rule": m, "title": titles[m], "caught": caught.get(m, 0)} if m in titles
                               else {"rule": None, "title": m, "caught": None} for m in r["measures"]]}
             for r in RISKS]
    return {"id": "RA-GXP-0001", "scales": {"severity": 5, "occurrence": 5, "detection": 5}, "risks": risks}
