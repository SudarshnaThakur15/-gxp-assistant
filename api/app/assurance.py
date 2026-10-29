"""The Assurance Layer: fixed, versioned, testable rules. It contains NO AI.

The pipeline runs these gates in order (see app/pipeline.py):
  1 SCREEN    screen_rules()  deterministic blocks on prohibited decisions and instruction overrides
  4 VALIDATE  validate()      checks on the AI's draft answer
  5 TIER      tier()          consequence tier from the task type and fixed rules (never from AI scores)
  7 RELEASE   release()       release / hold for review / refuse, exactly as the tier and checks say
Every decision records RULESET_VERSION and RULESET_FINGERPRINT, so it can be replayed
against the exact rules that ran (invariant 7). The AI can only make an outcome
stricter (invariant 2): AI verdicts are combined with these rules and the stricter
result always wins. AI confidence is never used as a gate (invariant 8).

Change any rule below → bump RULESET_VERSION (the fingerprint changes on its own).
"""

import hashlib
import re
import unicodedata
from dataclasses import dataclass

from app.audit import canonical_json
from app.retrieval import Hit, source_id

RULESET_VERSION = "2026.10.29-1"

# --- Gate 1: screening rules -------------------------------------------------
# A rule fires when its `decision` pattern matches and (if given) its `target` pattern
# also matches, i.e. the request is about acting on something specific, not about
# what a procedure says. `open_records_only`: asking what a CLOSED, documented record
# says is allowed; deciding anything about an OPEN or unnamed event is not.

UNNAMED_TARGET = (r"\b(?:this|that|our|my|the following)\s+(?:deviation|event|incident|failure|excursion)\b"
                  r"|\bis\s+(?:it|this)\b")

INJECTION_PATTERNS = [
    r"ignore (?:all )?(?:previous|prior|above|your) (?:instructions|rules)",
    r"\b(?:note|message) to (?:any )?ai\b",
    r"disregard (?:your|the|all) (?:rules|instructions)",
    r"\byou are now\b",
    r"\bsystem prompt\b",
]

# The approved documents a refusal rests on. Cited only where the in-force version says it word for word.
QP_DECIDES = {"doc": "SOP-QA-060", "section": "5", "quote": (
    "Batch disposition and certification are decisions of the Qualified Person. They may not be "
    "delegated to any person who is not a QP, or to any computerised system or AI tool")}
QA_DECIDES = {"doc": "SOP-QA-012", "section": "5.6", "quote": (
    "Classification, root cause and CAPA are decided by the investigator and QA, never by the assistant")}


def _policy(quote: str) -> dict:
    return {"doc": "POL-QA-001", "section": "4", "quote": quote}


AI_SCREEN_SOURCES = [_policy("These decisions belong to the investigator, QA and the Qualified Person")]


SCREEN_RULES = {
    "S1": {
        "title": "Release, shipment or disposition decision for a specific batch",
        "sources": [QP_DECIDES, _policy("make or recommend a batch disposition, release or certification decision")],
        "decision": (r"\b(?:releas(?:e|ed|ing)|ship(?:ped|ping)?|certif(?:y|ied|ication)|dispos(?:e|ed|ition)"
                     r"|reject(?:ed|ion)?|good to go|ok(?:ay)? to (?:use|ship|release)"
                     r"|approv(?:e|ed|al) (?:it |this |the batch )?for (?:use|release|sale|shipment))\b"),
        "target": (r"\b[A-Z]{2,4}-\d{2}-\d{3}\b|\b(?:this|that|our|my)\s+(?:batch|lot)\b"
                   r"|\b(?:can|could|should|may|shall)\s+(?:we|i)\b"),
    },
    "S2": {
        "title": "Classifying a deviation",
        "sources": [QA_DECIDES, _policy("classify a deviation")],
        "decision": (r"\b(?:classif(?:y|ied|ication)|categori[sz](?:e|ed|ation))\b"
                     r"|\b(?:critical|major|minor)\s+or\s+(?:critical|major|minor)\b"),
        "target": UNNAMED_TARGET + r"|\bDEV-\d{4}-\d{3}\b",
        "open_records_only": True,
    },
    "S3": {
        "title": "Determining a root cause",
        "sources": [QA_DECIDES, _policy("determine a root cause or select a CAPA")],
        "decision": r"\broot[\s-]?causes?\b|\bwhat\s+caused\b|\bwhy\s+did\b",
        "target": UNNAMED_TARGET + r"|\bDEV-\d{4}-\d{3}\b",
        "open_records_only": True,
    },
    "S4": {
        "title": "Selecting or recommending a CAPA",
        "sources": [QA_DECIDES, _policy("determine a root cause or select a CAPA")],
        "decision": (r"\b(?:which|what)\s+(?:capa|corrective action|preventive action)s?\b.{0,40}"
                     r"\b(?:should|would|do you|to (?:choose|pick|select|take|implement))\b"
                     r"|\b(?:recommend|suggest|propose|choose|select|pick)\w*\s+(?:a |an |the )?"
                     r"(?:capa|corrective|preventive)"),
        "target": None,
    },
    "S5": {
        "title": "Attempt to override the assistant's instructions",
        "sources": [_policy("answer from anything other than the approved documents it retrieves")],
        "decision": "|".join(INJECTION_PATTERNS),
        "target": None,
    },
}

# --- Gate 4: validation rules ------------------------------------------------
QUOTE_MIN_WORDS, QUOTE_MIN_CHARS = 3, 12   # a quote must be long enough to be real evidence
EVIDENCE_KEEP = "≤≥<>%./-+°µ="               # symbols that carry meaning in GMP values
PROHIBITED_LANGUAGE = (  # decision language the AI's own words may never contain
    r"\b(?:approved|cleared|ok|okay|safe|ready)\s+(?:for|to)\s+(?:release|ship|shipment|use|sale)\b"
    r"|\b(?:can|may|should|could)\s+(?:now\s+)?be\s+(?:released|shipped|certified|disposed)\b"
    r"|\brelease\s+(?:the|this|that)\s+(?:batch|lot)\b"
    r"|\b(?:we|i)\s+(?:recommend|suggest|propose)\b"
    r"|\b(?:likely|probable|possible|suspected)\s+root\s+cause\b"
    r"|\bshould\s+be\s+classified\b|\bclassify\s+(?:it|this)\s+as\b"
)
# Scope terms narrow what an answer is about. If a claim names one its cited document never
# mentions (V10), or the question names one no cited document mentions (V11), the answer may
# be about a related but different thing (e.g. a syringe shelf life given for "vials").
SCOPE_CONCEPTS = {
    "vial": r"\bvials?\b",
    "syringe": r"\bsyringes?\b|\bpfs\b|\bpre-?filled\b",
    "lyophilised": r"\blyophili[sz]\w*|\bfreeze-?dried\b",
    "tablet": r"\btablets?\b",
    "capsule": r"\bcapsules?\b",
    "ampoule": r"\bampou?les?\b",
    "cartridge": r"\bcartridges?\b",
    "bag": r"\bbags?\b",
    "powder": r"\bpowders?\b",
}
# Each check: title and severity ("hard": a failure refuses the answer; "review": it holds it for QA).
CHECKS = {
    "V1": ("An answer must contain at least one cited claim", "hard"),
    "V2": ("Every citation points to a passage retrieved for this question", "hard"),
    "V3": ("Every cited document version is in force right now", "hard"),
    "V4": ("Every quote appears word for word in its source", "hard"),
    "V5": ("Quotes are long enough to be real evidence", "hard"),
    "V6": ("Numbers in each claim appear in its cited document", "review"),
    "V7": ("No decision language (release, classification, root cause, CAPA)", "hard"),
    "V8": ("Injected instructions are neither followed nor repeated", "hard"),
    "V9": ("Draft guidance carries its 'not yet in force' label", "hard"),
    "V10": ("Each claim adds no product form or identifier its cited document doesn't mention", "hard"),
    "V11": ("The cited documents cover what the question is specifically about", "review"),
}
IDENTIFIER = r"\b[A-Z]{2,4}-\d{1,3}\b"  # product, equipment and batch identifiers (ALD-101, ISO-2, FIT-04)
NUMBER = r"\d+(?:\.\d+)?"
WHOLE_NUMBER = r"(?<![\d.]){}(?!\.?\d)"  # a claimed number must stand alone: "5" is not in "0.5" or "25"

# --- Gate 5: tier rules --------------------------------------------------------
INVESTIGATION_REQUEST = (
    r"\binvestigation pack\b|\bhave we (?:had|seen)\b|\bhistory of\b"
    r"|\b(?:previous|past|earlier|prior|similar|related|other)\s+"
    r"(?:deviations?|failures?|events?|excursions?|incidents?|investigations?)\b"
    r"|\bsummar(?:y|i[sz]e)\b.{0,30}\b(?:deviation|investigation|capa|record)s?\b"
    r"|\b(?:DEV|CAPA)-\d{4}-\d{3}\b"
)
INVESTIGATION_DOC_TYPES = ("deviation", "capa")
HUMAN_ACTION = (  # a cited procedure section that requires a person → never auto-released
    r"\backnowledg(?:e|es|ed|ement)\b|\bapprov(?:e|es|ed|al|als)\b|\bquarantin(?:e|es|ed)\b"
    r"|\bnotif(?:y|ies|ied|ication)\b|\binform(?:s|ed)?\b|\breport(?:s|ed)?\s+to\s+(?:qa|quality)\b"
    r"|\bsign(?:s|ed|ature|atures|ing)?\b|\be-?signatures?\b|\b(?:qa|qp)\s+decides\b"
    r"|\bmust\s+be\s+(?:reviewed|approved|signed)\b"
)
HUMAN_ACTION_DOC_TYPES = ("sop", "policy")
TIERS = {"T1": "Knowledge answer: released by rules with citations",
         "T2": "Investigation or human-action content: held for QA review and electronic signature",
         "T3": "Prohibited decision: refused, citing the documents the rule rests on"}

RULESET = {
    "version": RULESET_VERSION,
    "screen": SCREEN_RULES, "screen_ai_sources": AI_SCREEN_SOURCES, "unnamed_target": UNNAMED_TARGET,
    "validation": {"checks": CHECKS, "quote_min_words": QUOTE_MIN_WORDS, "quote_min_chars": QUOTE_MIN_CHARS,
                   "evidence_keep": EVIDENCE_KEEP, "prohibited_language": PROHIBITED_LANGUAGE,
                   "injection_patterns": INJECTION_PATTERNS, "scope_concepts": SCOPE_CONCEPTS,
                   "identifier": IDENTIFIER, "number": NUMBER, "whole_number": WHOLE_NUMBER},
    "tier": {"investigation_request": INVESTIGATION_REQUEST, "investigation_doc_types": INVESTIGATION_DOC_TYPES,
             "human_action": HUMAN_ACTION, "human_action_doc_types": HUMAN_ACTION_DOC_TYPES, "tiers": TIERS},
}
RULESET_FINGERPRINT = hashlib.sha256(canonical_json(RULESET).encode()).hexdigest()

DECISION_LABELS = {"released": "Released by rules", "held_for_review": "Held for review", "refused": "Refused"}


@dataclass
class Check:
    id: str
    title: str
    severity: str     # "hard": failure → refused | "review": failure → held for review
    status: str       # "pass" | "fail" | "fixed" | "skip"
    detail: str = ""


# --- helpers -------------------------------------------------------------------

_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−"), "-")
_QUOTES = {ord("‘"): "'", ord("’"): "'", ord("“"): '"', ord("”"): '"'}


def plain(text: str) -> str:
    """Unicode-normalised text: compatibility forms, one dash style, one quote style."""
    return unicodedata.normalize("NFKC", text).translate(_DASHES).translate(_QUOTES)


def evidence_form(text: str) -> str:
    """What 'word for word' compares: letters, digits and meaningful symbols, in order.
    Spacing, capitalisation, Markdown/table formatting and dash styles are ignored."""
    return "".join(ch for ch in plain(text).casefold() if ch.isalnum() or ch in EVIDENCE_KEEP).strip(".,")


def scope_terms(text: str) -> set[str]:
    """Product forms (by concept) and identifiers named in a text."""
    t = plain(text)
    return ({name for name, pattern in SCOPE_CONCEPTS.items() if re.search(pattern, t, re.I)}
            | set(re.findall(IDENTIFIER, t)))


def unsupported_terms(text: str, evidence: str) -> list[str]:
    """Scope terms named in `text` that the evidence never mentions."""
    missing = []
    for term in sorted(scope_terms(text)):
        if term in SCOPE_CONCEPTS:
            if not re.search(SCOPE_CONCEPTS[term], plain(evidence), re.I):
                missing.append(term)
        elif evidence_form(term) not in evidence_form(evidence):
            missing.append(term)
    return missing


def injection_offset(text: str) -> int | None:
    """Character offset where injected instructions start in a passage, or None."""
    starts = [m.start() for p in INJECTION_PATTERNS if (m := re.search(p, text, re.I))]
    return min(starts) if starts else None


# --- Gate 1 ----------------------------------------------------------------------

def screen_rules(question: str, named_records: list[dict]) -> list[dict]:
    """Prohibited-decision and instruction-override rules that fire for this question."""
    fired = []
    records = [r for r in named_records if r.get("doc_type") in INVESTIGATION_DOC_TYPES]
    for rule_id, rule in SCREEN_RULES.items():
        if not re.search(rule["decision"], question, re.I):
            continue
        if rule["target"] and not re.search(rule["target"], question, re.I):
            continue
        if (rule.get("open_records_only") and records and not re.search(UNNAMED_TARGET, question, re.I)
                and all(r["record_state"] == "closed" for r in records)):
            continue  # reporting what a closed, documented record already says
        fired.append({"rule": rule_id, "title": rule["title"]})
    return fired


# --- Gate 4 ----------------------------------------------------------------------

def validate(question: str, draft: dict, hits: list[Hit], in_force: dict[int, bool],
             injected: dict[str, int]) -> tuple[list[Check], list[dict], list[str]]:
    """Check the AI draft. Returns (checks, resolved claims, notices added by rules)."""
    by_id = {source_id(h): h for h in hits}
    claims = draft.get("claims", []) if draft.get("status") == "answered" else []
    checks: list[Check] = []

    def add(cid, failures, ok_detail="", status_if_ok="pass"):
        title, severity = CHECKS[cid]
        checks.append(Check(cid, title, severity, "fail" if failures else status_if_ok,
                            "; ".join(failures) if failures else ok_detail))

    def document_text(h: Hit) -> str:
        """Everything retrieved from a cited document, with its code, version, section and title."""
        return plain(" ".join([*(x.text for x in hits if x.document_id == h.document_id),
                               h.code, h.version, h.section, h.title]))

    if draft.get("status") == "answered" and not claims:
        add("V1", ["answered but no claims"])
        return checks, [], []
    if not claims:
        checks.append(Check("V1", "Not found: nothing to verify", "hard", "skip", "draft says not found"))
        return checks, [], []
    add("V1", [], f"{len(claims)} claim(s)")

    resolved, missing = [], []
    for i, c in enumerate(claims, 1):
        h = by_id.get(c["source_id"])
        if h is None:
            missing.append(f"claim {i} cites {c['source_id']}, which was not retrieved")
        resolved.append({**c, "n": i, "hit": h})
    add("V2", missing)
    cited = [r for r in resolved if r["hit"] is not None]

    stale = [f"claim {r['n']}: {r['hit'].code} v{r['hit'].version} is no longer in force"
             for r in cited if not in_force.get(r["hit"].document_id, False)]
    add("V3", stale)

    not_verbatim = [f"claim {r['n']}: quote not found word for word in {r['hit'].code} §{r['hit'].section}"
                    for r in cited
                    if not evidence_form(r["quote"]) or evidence_form(r["quote"]) not in evidence_form(r["hit"].text)]
    add("V4", not_verbatim)

    too_short = [f"claim {r['n']}: quote '{r['quote']}' is too short to be evidence" for r in resolved
                 if len(r["quote"].split()) < QUOTE_MIN_WORDS and len(evidence_form(r["quote"])) < QUOTE_MIN_CHARS]
    add("V5", too_short)

    unsupported = []
    for r in cited:
        evidence = document_text(r["hit"])
        absent = sorted({n for n in re.findall(NUMBER, plain(r["text"]))
                         if not re.search(WHOLE_NUMBER.format(re.escape(n)), evidence)})
        if absent:
            unsupported.append(f"claim {r['n']}: {', '.join(absent)} not in {r['hit'].code}")
    add("V6", unsupported)

    forbidden = [f"claim {r['n']}: '{m.group(0)}'" for r in resolved
                 if (m := re.search(PROHIBITED_LANGUAGE, plain(r["text"]), re.I))]
    add("V7", forbidden)

    echoed = []
    for r in cited:
        sid, h = source_id(r["hit"]), r["hit"]
        if re.search("|".join(INJECTION_PATTERNS), plain(r["text"] + " " + r["quote"]), re.I):
            echoed.append(f"claim {r['n']} repeats an instruction aimed at AI systems")
        elif sid in injected and evidence_form(r["quote"]) in evidence_form(h.text[injected[sid]:]):
            echoed.append(f"claim {r['n']} quotes injected text in {h.code} §{h.section}")
    add("V8", echoed)

    notices = []
    for q in dict.fromkeys(r["hit"].required_qualifier for r in cited if r["hit"].required_qualifier):
        notices.append(q)
    add("V9", [],
        f"label added by rule: {' | '.join(notices)}" if notices else "no draft guidance cited",
        status_if_ok="fixed" if notices else "pass")

    added = [f"claim {r['n']} says {', '.join(t)}, which {r['hit'].code} never mentions"
             for r in cited if (t := unsupported_terms(r["text"], document_text(r["hit"])))]
    add("V10", added)
    evidence = " ".join(f"{h.text} {h.title} {h.code} {h.section}"
                        for h in {source_id(r["hit"]): r["hit"] for r in cited}.values())
    asked = unsupported_terms(question, evidence)
    add("V11", [f"question names {', '.join(asked)}; the cited documents never mention it"] if asked else [])
    return checks, resolved, notices


# --- Gate 5 ----------------------------------------------------------------------

def tier(question: str, screen: dict, cited: list[Hit], checks: list[Check]) -> tuple[str, list[str]]:
    """Consequence tier from the task type and fixed rules. AI input can only raise it."""
    if screen["refused"]:
        return "T3", [f"{r['rule']}: {r['title']}" for r in screen["rules"]] or ["AI screen: prohibited decision"]
    reasons = []
    if m := re.search(INVESTIGATION_REQUEST, question, re.I):
        reasons.append(f"R-INV-Q: investigation request ('{m.group(0)}')")
    if screen.get("ai_intent") == "investigation_support":
        reasons.append("R-INV-AI: AI screen classified the request as investigation support")
    for h in {source_id(h): h for h in cited}.values():
        if h.doc_type in INVESTIGATION_DOC_TYPES:
            reasons.append(f"R-INV-DOC: cites {h.code}, a {h.doc_type} record")
        if h.doc_type in HUMAN_ACTION_DOC_TYPES and (m := re.search(HUMAN_ACTION, plain(h.text), re.I)):
            reasons.append(f"R-HUMAN: {h.code} §{h.section} requires a person ('{m.group(0)}')")
    reasons += [f"{c.id}: {c.title}" for c in checks  # titles only: details quote the withheld draft
                if c.severity == "review" and c.status == "fail"]
    return ("T2" if reasons else "T1"), list(dict.fromkeys(reasons))


# --- Gate 7 ----------------------------------------------------------------------

def release(tier_: str, answer_type: str, checks: list[Check]) -> str:
    """release / hold for review / refuse, exactly as the tier and checks say."""
    if answer_type == "error" or tier_ == "T3":
        return "refused"
    if any(c.severity == "hard" and c.status == "fail" for c in checks):
        return "refused"
    if answer_type == "not_found":
        return "released"  # "not found" carries no content to review
    return "held_for_review" if tier_ == "T2" else "released"
