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

RULESET_VERSION = "2026.10.30-1"

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


# "that batch" names a batch, except after a reporting verb, where "that" starts a clause:
# "SOP-QA-060 states that batch disposition is a QP decision" asks what a document says.
REPORTING_VERBS = ("say", "says", "said", "state", "states", "stated", "show", "shows", "mean", "means",
                   "confirm", "confirms", "require", "requires", "specify", "specifies", "indicate", "indicates",
                   "mention", "mentions", "explain", "explains", "ensure", "ensures", "note", "notes")
THAT_BATCH = "".join(rf"(?<!\b{v} )" for v in REPORTING_VERBS) + r"\bthat\s+(?:batch|lot)\b"


AI_SCREEN_SOURCES = [_policy("These decisions belong to the investigator, QA and the Qualified Person")]

SCREEN_RULES = {
    "S1": {
        "title": "Release, shipment or disposition decision for a specific batch",
        "sources": [QP_DECIDES, _policy("make or recommend a batch disposition, release or certification decision")],
        "decision": (r"\b(?:releas(?:e|ed|ing)|ship(?:ped|ping)?|certif(?:y|ied|ication)|dispos(?:e|ed|ition)"
                     r"|reject(?:ed|ion)?|good to go|ok(?:ay)? to (?:use|ship|release)"
                     r"|approv(?:e|ed|al) (?:it |this |the batch )?for (?:use|release|sale|shipment))\b"),
        "target": (r"\b[A-Z]{2,4}-\d{2}-\d{3}\b|\b(?:this|our|my)\s+(?:batch|lot)\b|" + THAT_BATCH
                   + r"|\b(?:can|could|should|may|shall)\s+(?:we|i)\b"),
    },
    "S2": {
        "title": "Classifying a deviation",
        "sources": [QA_DECIDES, _policy("classify a deviation")],
        "decision": (r"\b(?:classif(?:y|ied|ication)|categori[sz](?:e|ed|ation))\b"
                     r"|\b(?:critical|major|minor)\s+or\s+(?:critical|major|minor)\b"
                     r"|\bcriteria\s+for\s+(?:a\s+)?(?:critical|major|minor)\b"
                     r"|\b(?:what|which)\s+(?:category|class|classification)\b"),
        "target": UNNAMED_TARGET + r"|\bDEV-\d{4}-\d{3}\b"  # a named record, or an event described by its values
                  + r"|\b\d+(?:\.\d+)?\s*-?\s*(?:hours?|h|minutes?|min|days?|°\s?C)(?![A-Za-z])",
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
# A follow-up that points back ("can it be released?") is also screened with what the chat named earlier.
BACK_REFERENCE = r"\b(?:it|its|this|that|these|those|they|them|same|above|previous|earlier)\b"
CODE = r"\b[A-Z]{2,5}(?:-[A-Z0-9]+)+\b"  # whole codes: ALD-26-117, SOP-QA-060, DEV-2026-027, ALD-101

# --- Gate 1, before any rule: read the question the way a person would --------------
# Invisible characters, look-alike letters from other alphabets and other languages would let a
# prohibited request slip past the rules and leave only the AI screen. Rules read the cleaned text;
# the record keeps what was typed.
CONFUSABLES = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
    "ԁ": "d", "ӏ": "l", "һ": "h", "ԛ": "q", "ԝ": "w", "ѵ": "v", "А": "A", "В": "B", "Е": "E", "К": "K",
    "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y", "І": "I", "Ј": "J",
    "Ѕ": "S", "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N",
    "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X", "Υ": "Y", "ο": "o", "α": "a", "ν": "v", "ι": "i", "κ": "k",
    "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
})
FOREIGN_WORDS = {  # common words of the languages a user might switch to; any two, outnumbering English, = refused
    "der", "die", "das", "und", "nicht", "kann", "können", "werden", "wird", "mit", "für", "auf", "eine", "charge",
    "freigegeben", "ist", "sind", "wie", "welche", "les", "est", "une", "pour", "avec", "peut", "être", "quelle",
    "los", "las", "una", "para", "puede", "ser", "qué", "cuál", "het", "een", "niet", "worden", "gli", "può",
    "essere", "quale",
}
ENGLISH_WORDS = {"the", "a", "an", "is", "are", "can", "be", "of", "for", "to", "what", "which", "how", "does",
                 "do", "with", "in", "on", "and", "must", "should", "when", "who", "have", "has", "was", "were"}
INPUT_RULES = {"S7": {"title": "Text the rules cannot read reliably: mixed alphabets or not English"}}

# --- Gate 1: "does this result pass?" is QC's decision -------------------------------
# The assistant may state the acceptance criterion, never compare a result with it.
CRITERION_QUESTION = (r"\b(?:pass(?:es|ed)?|fail(?:s|ed)?|meets?|compl(?:y|ies)|conforms?|acceptable"
                      r"|within\s+(?:the\s+)?spec\w*|out\s+of\s+spec\w*|oos)\b")
MEASURED_VALUE = (r"\bresults?\b|\bmeasured\b|\b\d+(?:\.\d+)?\s*(?:%|°\s?C|EU/m[gL]|mg/mL|CFU|mg|mL|µm|h|hours?"
                  r"|days?|months?)(?![A-Za-z])")

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
# A conformance verdict in the AI's own words ("meets the specification", "the batch conforms") is the
# OOS decision, which belongs to QC. Allowed only where the cited passage itself says it.
CONFORMANCE = (
    r"\b(?:meets?|met|pass(?:es|ed)?|compl(?:y|ies|ied)\s+with|conforms?(?:\s+to)?|conformed|(?:is|are|falls?)\s+within"
    r"|(?:is|are)\s+outside|out\s+of)\s+(?:the\s+|its\s+|all\s+)?(?:release\s+|acceptance\s+)?"
    r"(?:spec(?:ification)?s?|limits?|criteri(?:a|on)|requirements?|range)\b"
    r"|\b(?:batch|lot|result|it)\s+(?:conforms|complies|passes|is\s+acceptable)\b"
    r"|\bis\s+(?:oos|out\s+of\s+spec(?:ification)?|in\s+spec(?:ification)?)\b"
    r"|\bmeets?\s+the\s+criteria\s+for\s+(?:a\s+)?(?:critical|major|minor)\b"
    r"|\b(?:counts|qualifies|would\s+be\s+classified|is\s+classified)\s+as\s+(?:a\s+)?(?:critical|major|minor)\b"
)
# The AI's sentence must say what its quote says (V6): numbers with their unit and limit direction,
# no added "not", no dropped "not" or "must". Codes, dates and section numbers are compared separately.
UNIT = (r"(?:%|°\s?C|º\s?C|degrees?\s+C\b|EU/mg|EU/mL|EU/ml|mg/mL|mg/ml|µg/mL|μg/mL|ug/mL|CFU(?:/[A-Za-z0-9³]+)?"
        r"|µm|μm|um|mm|cm|mL|ml|mg|µg|μg|ug|kg|g|L|h|hrs?|hours?|minutes?|min|seconds?|sec|s|days?|weeks?|months?"
        r"|years?|ppm|mbar|bar|kPa|Pa|rpm)(?![A-Za-z])")
UNIT_ALIASES = {"hr": "h", "hrs": "h", "hour": "h", "hours": "h", "minute": "min", "minutes": "min", "sec": "s",
                "second": "s", "seconds": "s", "days": "day", "weeks": "week", "months": "month", "years": "year",
                "um": "µm", "μm": "µm", "ug": "µg", "μg": "µg", "ug/ml": "µg/ml", "μg/ml": "µg/ml", "ºc": "°c",
                "degrees c": "°c", "degree c": "°c"}
COMPARATORS = [  # limit direction just before a number; the longer phrases come first
    ("max", r"≤|=<|\bnot\s+more\s+than|\bno\s+more\s+than|\bup\s+to|\bat\s+most|\bmaximum(?:\s+of)?|\bmax\.?"
            r"|\bwithin|\bno\s+later\s+than"),
    ("min", r"≥|>=|\bnot\s+less\s+than|\bno\s+less\s+than|\bat\s+least|\bminimum(?:\s+of)?|\bmin\."),
    ("max", r"<|\bless\s+than|\bbelow|\bunder|\bfewer\s+than"),
    ("min", r">|\bmore\s+than|\bgreater\s+than|\babove|\bover|\bexceed(?:s|ing)?"),
]
NEGATION = r"\b(?:not|no|never|none|without|cannot|can't|don't|doesn't|mustn't|isn't|aren't|won't)\b"
LIMIT_PHRASES = r"\b(?:not|no)\s+(?:more|less|later)\s+than\b"  # limits, not negations
OBLIGATION = r"\b(?:must|shall)\b"
OBLIGATION_KEPT = r"\b(?:must|shall|required|requires?|need|needs|has\s+to|have\s+to|only)\b"
REFERENCE_NAMES = (r"\b(?:annex|chapter|part|article|appendix|clause|schedule|step|volume|vol\.?)\s+\d+[a-z]?\b"
                   r"|\b\d+\s+CFR\b|\bQ\d+[A-Z]?(?:\(R\d\))?")
CONTEXT_CUES = r"\b(?:not|no|never|cannot|unless|except|only|if|until|without|prior\s+to)\b"

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
    "V4": ("Every quote appears word for word in its source, as a whole, in context", "hard"),
    "V5": ("Quotes are long enough to be real evidence", "hard"),
    "V6": ("Each claim's numbers, units, limits and negations match its quote", "hard"),
    "V7": ("No decision language (release, conformance, classification, root cause, CAPA)", "hard"),
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

# --- Investigation packs: the AI prepares, the investigator decides ------------------
# For an open deviation the assistant may not determine the root cause, classify it or choose a
# CAPA (S2–S4), but it may gather what the records and procedures say. Causes and CAPAs in a pack
# come only from earlier, closed records, each quoted; never from the AI about the open case.
PACK_REQUEST = r"\binvestigation pack\b"
PACK_SECTIONS = {
    "subject": "what the open deviation itself records (never its cause)",
    "similar_case": "an earlier, closed deviation about the same kind of event",
    "earlier_cause": "the root cause documented in such an earlier, closed record",
    "earlier_capa": "a CAPA documented for such an earlier event",
    "procedure": "what an SOP, policy, specification or guideline requires",
}
EARLIER_DOC_TYPES = ("deviation", "capa")
PROCEDURE_DOC_TYPES = ("sop", "policy", "specification", "guideline", "quality_agreement")
CAUSE_WORDS = r"\b(?:caus(?:e|ed|es|ing)|due to|because|attribut\w*|result(?:ed|ing)? from|originat\w*)\b"
PACK_CHECKS = {
    "P1": ("Each part of the pack cites the right kind of record", "hard"),
    "P2": ("Nothing in the pack states a cause for the open deviation", "hard"),
}

RULESET = {
    "version": RULESET_VERSION,
    "screen": SCREEN_RULES, "screen_ai_sources": AI_SCREEN_SOURCES, "unnamed_target": UNNAMED_TARGET,
    "followup": {"back_reference": BACK_REFERENCE, "code": CODE},
    "input": {"confusables": sorted(CONFUSABLES.items()), "foreign_words": sorted(FOREIGN_WORDS),
              "english_words": sorted(ENGLISH_WORDS), "rules": INPUT_RULES},
    "criterion_only": {"question": CRITERION_QUESTION, "measured_value": MEASURED_VALUE},
    "binding": {"reference_names": REFERENCE_NAMES, "unit": UNIT, "unit_aliases": UNIT_ALIASES, "comparators": COMPARATORS, "negation": NEGATION,
                "limit_phrases": LIMIT_PHRASES, "obligation": OBLIGATION, "obligation_kept": OBLIGATION_KEPT,
                "context_cues": CONTEXT_CUES, "conformance": CONFORMANCE},
    "pack": {"request": PACK_REQUEST, "sections": PACK_SECTIONS, "earlier_doc_types": EARLIER_DOC_TYPES,
             "procedure_doc_types": PROCEDURE_DOC_TYPES, "cause_words": CAUSE_WORDS, "checks": PACK_CHECKS},
    "validation": {"checks": CHECKS, "quote_min_words": QUOTE_MIN_WORDS, "quote_min_chars": QUOTE_MIN_CHARS,
                   "evidence_keep": EVIDENCE_KEEP, "prohibited_language": PROHIBITED_LANGUAGE,
                   "injection_patterns": INJECTION_PATTERNS, "scope_concepts": SCOPE_CONCEPTS,
                   "identifier": IDENTIFIER, "number": NUMBER, "whole_number": WHOLE_NUMBER},
    "tier": {"investigation_request": INVESTIGATION_REQUEST, "investigation_doc_types": INVESTIGATION_DOC_TYPES,
             "human_action": HUMAN_ACTION, "human_action_doc_types": HUMAN_ACTION_DOC_TYPES, "tiers": TIERS},
}
RULESET_FINGERPRINT = hashlib.sha256(canonical_json(RULESET).encode()).hexdigest()

DECISION_LABELS = {"released": "Answered", "held_for_review": "Waiting for QA sign-off", "refused": "Not answered"}


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


def canonical(text: str) -> str:
    """Text as a person reads it: compatibility forms, no invisible characters, look-alike letters made Latin."""
    t = unicodedata.normalize("NFKC", text)
    return plain("".join(ch for ch in t if unicodedata.category(ch) != "Cf").translate(CONFUSABLES))


def _script(ch: str) -> str:
    return "LATIN" if ch in "µμ" else unicodedata.name(ch, "UNKNOWN").split()[0]


def mixed_script(text: str) -> bool:
    """A word mixing alphabets (a Cyrillic 'е' inside 'release') is disguised."""
    t = "".join(ch for ch in unicodedata.normalize("NFKC", text) if unicodedata.category(ch) != "Cf")
    return any(len({_script(ch) for ch in word}) > 1 for word in re.findall(r"[^\W\d_]+", t))


def unsupported_language(text: str) -> bool:
    """The rules are written in English: another alphabet, or another language's common words, cannot be screened."""
    t = canonical(text)
    if any(ch.isalpha() and _script(ch) != "LATIN" for ch in t):
        return True
    words = re.findall(r"[^\W\d_]+", t.casefold())
    foreign, english = sum(w in FOREIGN_WORDS for w in words), sum(w in ENGLISH_WORDS for w in words)
    return foreign >= 2 and foreign > english


def criterion_only(text: str) -> bool:
    """Asks whether a measured result passes: the answer may give the acceptance criterion, never the verdict."""
    t = canonical(text)
    return bool(re.search(CRITERION_QUESTION, t, re.I) and re.search(MEASURED_VALUE, t, re.I))


def _masked(text: str) -> tuple[str, list[str]]:
    """Text with codes, section and version numbers removed; dates and times returned separately."""
    t = plain(text)
    stamps = re.findall(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b", t)
    t = re.sub(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b", " ", t)
    t = re.sub(CODE, " ", t)
    t = re.sub(r"§\s*\d+(?:\.\d+)*|\bv\d+(?:\.\d+)*\b|\bversion\s+\d+(?:\.\d+)*", " ", t, flags=re.I)
    t = re.sub(REFERENCE_NAMES, " ", t, flags=re.I)  # "Annex 11", "21 CFR Part 11": names, not values
    return t, stamps


def unbulleted(quote: str) -> str:
    """A quote without a leading list marker the model may copy from list style ("- ", "* ", "1. ")."""
    return re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", quote)


def _unit(u: str | None) -> str | None:
    if not u:
        return None
    u = re.sub(r"\s+", " ", u.casefold().replace("º", "°")).replace("° c", "°c")
    return UNIT_ALIASES.get(u, u)


def quantities(text: str) -> list[dict]:
    """Every number in a text with its unit and limit direction; a range shares its unit and direction."""
    t, _ = _masked(text)
    found = []
    for m in re.finditer(rf"(?<![\w.])(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?\s*({UNIT})?", t):
        window = t[max(0, m.start() - 25):m.start()]
        direction = next((d for d, pattern in COMPARATORS if re.search(rf"(?:{pattern})\s*$", window, re.I)), None)
        values = {float(m.group(1))} | ({float(m.group(2))} if m.group(2) else set())
        sign = {"max": "≤ ", "min": "≥ "}.get(direction, "")
        found.append({"text": sign + m.group(0).strip(), "values": values, "unit": _unit(m.group(3)), "dir": direction})
    return found


def _clauses(text: str, cue: str) -> list[set[str]]:
    """The content words right after each cue word ("may not be delegated to any person" → delegated, person)."""
    t = re.sub(LIMIT_PHRASES, " ", plain(text).casefold())
    return [set(re.findall(r"[a-z]{4,}", t[m.end():m.end() + 60])[:4]) for m in re.finditer(cue, t)]


def binding_problems(claim: str, quote: str) -> list[str]:
    """What the AI's sentence says that its quote does not (V6)."""
    problems = []
    said, heard = quantities(claim), quantities(quote)
    for q in said:
        same = [h for h in heard if q["values"] & h["values"]]
        if not same:
            problems.append(f"'{q['text']}' is not in its quote")
        elif not any((not q["unit"] or not h["unit"] or q["unit"] == h["unit"])
                     and (not q["dir"] or not h["dir"] or q["dir"] == h["dir"]) for h in same):
            problems.append(f"'{q['text']}' but the quote says '{same[0]['text']}'")
    _, claim_stamps = _masked(claim)
    _, quote_stamps = _masked(quote)
    problems += [f"'{s}' is not in its quote" for s in claim_stamps if s not in quote_stamps]
    claim_words = set(re.findall(r"[a-z]{4,}", plain(claim).casefold()))
    claim_negates = bool(_clauses(claim, NEGATION))
    if claim_negates and not _clauses(quote, NEGATION):
        problems.append("adds a 'not' its quote does not have")
    if not claim_negates and any(len(c & claim_words) >= 2 for c in _clauses(quote, NEGATION)):
        problems.append("drops a 'not' that its quote has")
    if not re.search(OBLIGATION_KEPT, plain(claim), re.I) and any(
            len(c & claim_words) >= 2 for c in _clauses(quote, OBLIGATION)):
        problems.append("drops a 'must' or 'shall' that its quote has")
    return problems


_SEP = r"(?:[^\w≤≥<>%./\-+°µμ=]|_)*"
SENTENCE_START = re.compile(r"[.!?](?=\s)|\n\s*\n|\n\s*(?=[-*#|]|\d+(?:\.\d+)*\s)|\|")


def quote_context_problem(quote: str, source: str) -> str | None:
    """A word-for-word quote can still mislead: cut mid-word or mid-number, without the 'do not' or 'only if'
    just before it, or joined across table rows (V4)."""
    chars = evidence_form(quote)
    src = plain(source).casefold()
    m = re.search(_SEP.join(re.escape(c) for c in chars), src) if chars else None
    if m is None:
        return "could not be placed in its source"
    s, e = m.start(), m.end()
    before, after = src[s - 1:s], src[e:e + 1]
    if before.isalnum() or (before in ".," and s >= 2 and src[s - 2].isdigit() and src[s:s + 1].isdigit()):
        return "starts in the middle of a word or number"
    if after.isalnum() or (after in ".," and src[e + 1:e + 2].isdigit() and src[e - 1:e].isdigit()):
        return "ends in the middle of a word or number"
    starts = [x.end() for x in SENTENCE_START.finditer(src, 0, s)]
    if cue := re.search(CONTEXT_CUES, src[(starts[-1] if starts else 0):s]):
        return f"leaves out '{cue.group(0)}' just before it"
    lines = src[src.rfind("\n", 0, s) + 1:e].split("\n")
    if sum(line.lstrip().startswith("|") for line in lines) >= 2:
        return "joins two table rows"
    return None


def team_answer_problems(text: str) -> list[str]:
    """Decision wording in a team's free-text answer: it would reach the requester as a verdict."""
    t = canonical(text)
    found = [f"{r['rule']}: {r['title']}" for r in screen_rules(t, [])]
    found += [f"'{m.group(0)}'" for pattern in (PROHIBITED_LANGUAGE, CONFORMANCE) if (m := re.search(pattern, t, re.I))]
    return found


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


def screen_texts(texts: list[str], named_records: list[dict]) -> list[dict]:
    """screen_rules over every reading of one request (as typed, as rewritten, with carried targets)."""
    fired = {f["rule"]: f for t in texts for f in screen_rules(canonical(t), named_records)}
    out = [fired[r] for r in SCREEN_RULES if r in fired]
    if any(mixed_script(t) or unsupported_language(t) for t in texts):
        out.append({"rule": "S7", "title": INPUT_RULES["S7"]["title"]})
    return out


def carried_targets(message: str, earlier: list[str]) -> str:
    """What the chat's earlier questions named (a batch, a record, 'this batch') when the message points
    back at it, so a prohibited request cannot be split across messages."""
    if not earlier or not re.search(BACK_REFERENCE, message, re.I):
        return ""
    found = [m.group(0) for q in earlier for rule in SCREEN_RULES.values() if rule["target"]
             for m in re.finditer(rule["target"], q, re.I)]
    return " ".join(dict.fromkeys(found))


def added_identifiers(rewrite: str, conversation: str) -> list[str]:
    """Codes the AI's rewrite of a follow-up names that nobody wrote in the chat: it may only restate."""
    seen = evidence_form(conversation)
    return [x for x in dict.fromkeys(re.findall(CODE, plain(rewrite))) if evidence_form(x) not in seen]


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

    for r in resolved:
        r["quote"] = unbulleted(r["quote"])
    not_verbatim = [f"claim {r['n']}: quote not found word for word in {r['hit'].code} §{r['hit'].section}"
                    for r in cited
                    if not evidence_form(r["quote"]) or evidence_form(r["quote"]) not in evidence_form(r["hit"].text)]
    not_verbatim += [f"claim {r['n']}: the quote {problem}" for r in cited
                     if evidence_form(r["quote"]) and evidence_form(r["quote"]) in evidence_form(r["hit"].text)
                     and (problem := quote_context_problem(r["quote"], r["hit"].text))]
    add("V4", not_verbatim)

    too_short = [f"claim {r['n']}: quote '{r['quote']}' is too short to be evidence" for r in resolved
                 if len(r["quote"].split()) < QUOTE_MIN_WORDS and len(evidence_form(r["quote"])) < QUOTE_MIN_CHARS]
    add("V5", too_short)

    mismatched = [f"claim {r['n']}: {problem}" for r in resolved for problem in binding_problems(r["text"], r["quote"])]
    add("V6", mismatched)

    forbidden = [f"claim {r['n']}: '{m.group(0)}'" for r in resolved
                 if (m := re.search(PROHIBITED_LANGUAGE, plain(r["text"]), re.I))]
    forbidden += [f"claim {r['n']}: '{m.group(0)}'" for r in resolved  # unless the cited passage itself says it
                  if (m := re.search(CONFORMANCE, plain(r["text"]), re.I))
                  and not re.search(CONFORMANCE, plain(r["quote"]), re.I)]
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


def pack_subject(question: str, named_records: list[dict]) -> str | None:
    """The deviation an investigation pack is asked for: exactly one named deviation record."""
    if not re.search(PACK_REQUEST, question, re.I):
        return None
    deviations = sorted({r["code"] for r in named_records if r.get("doc_type") == "deviation"})
    return deviations[0] if len(deviations) == 1 else None


def validate_pack(subject: str, resolved: list[dict]) -> list[Check]:
    """The extra checks on an investigation pack (P1, P2)."""
    wrong, causes = [], []
    for r in resolved:
        h, section = r["hit"], r.get("section")
        if h is None:
            continue  # V2 already refuses a citation that was not retrieved
        about_subject = h.code == subject
        if section == "subject":
            ok = about_subject
        elif section in ("similar_case", "earlier_cause", "earlier_capa"):
            ok = not about_subject and h.doc_type in EARLIER_DOC_TYPES and h.record_state == "closed"
        else:
            ok = section == "procedure" and h.doc_type in PROCEDURE_DOC_TYPES
        if not ok:
            kind = " ".join(x for x in (h.record_state, h.doc_type) if x)
            wrong.append(f"claim {r['n']} ({section}) cites {h.code}, a {kind} record")
        # a cause for the open deviation may only be reported if its own record states it
        if (about_subject or section == "subject") and re.search(CAUSE_WORDS, plain(r["text"]), re.I) \
                and not re.search(CAUSE_WORDS, plain(r["quote"]), re.I):
            causes.append(f"claim {r['n']} gives a cause for {subject} that its record does not state")
    return [Check(cid, *PACK_CHECKS[cid], "fail" if failures else "pass", "; ".join(failures))
            for cid, failures in (("P1", wrong), ("P2", causes))]


# --- Gate 5 ----------------------------------------------------------------------

def tier(question: str, screen: dict, cited: list[Hit], checks: list[Check],
         quotes: dict[str, list[str]] | None = None) -> tuple[str, list[str]]:
    """Consequence tier from the task type and fixed rules. AI input can only raise it.

    `quotes`: the words each cited passage is quoted for (by source id). R-HUMAN reads those, not the
    whole section, so pointing to a procedure doesn't count as telling someone to act on it."""
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
        quoted = " ".join(quotes[source_id(h)]) if quotes and source_id(h) in quotes else h.text
        if h.doc_type in HUMAN_ACTION_DOC_TYPES and (m := re.search(HUMAN_ACTION, plain(quoted), re.I)):
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
