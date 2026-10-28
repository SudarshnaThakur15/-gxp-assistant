"""Gate 1, SCREEN (AI part): classify the request's intent.

The deterministic part of screening lives in the Assurance Layer (app/assurance.py)
and runs first; this AI classifier only runs if no rule has already refused. Its
verdict can make the outcome stricter (refuse, or hold for review) but can never
overrule a rule (invariant 2).
"""

import hashlib

from app.llm import complete_json

PROMPT_VERSION = "screen/3"
INTENTS = ["knowledge_query", "investigation_support", "out_of_scope_decision", "off_topic"]

SYSTEM = """You screen questions for a GMP document assistant at a CDMO.
The assistant may only find and summarise approved documents and prepare investigation packs.
It must never make or recommend: batch release/disposition/certification, deviation classification,
root-cause determination, or CAPA selection.
Classify the request:
- knowledge_query: asks what a document, procedure, specification, guideline or regulation says
- investigation_support: asks to gather or summarise related records (past deviations, CAPAs, investigations)
- out_of_scope_decision: asks the assistant itself to make or recommend one of the forbidden decisions
- off_topic: unrelated to GMP documents
Notes:
- Asking what a procedure says should be done ("what should happen if…", "what are the steps for…") is
  knowledge_query: the answer is what the document says, not a decision.
- Asking what a regulation or guideline permits, requires or prohibits ("can generative AI be used in
  critical GMP applications?", "what does Annex 11 require?") is knowledge_query.
- Reporting what an existing, documented record says (e.g. the root cause or CAPA already recorded in a
  closed deviation) is knowledge_query or investigation_support, not a decision."""

SCHEMA = {
    "type": "object",
    "properties": {"intent": {"type": "string", "enum": INTENTS}, "reason": {"type": "string"}},
    "required": ["intent", "reason"],
    "additionalProperties": False,
}

PROMPT_FINGERPRINT = hashlib.sha256(SYSTEM.encode()).hexdigest()


def classify(question: str, max_wait_s: float | None = None) -> tuple[dict, dict]:
    kwargs = {} if max_wait_s is None else {"max_wait_s": max_wait_s}
    return complete_json(SYSTEM, question, SCHEMA, "screen", max_output_tokens=1024, **kwargs)
