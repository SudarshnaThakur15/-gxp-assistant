// Plain-English wording for outcomes and rule reasons. The technical codes stay visible in the
// Checks and Record tabs; everyday screens use these sentences.

import type { Outcome } from "@/lib/api";

export type Tone = "ok" | "wait" | "fail" | "info";

export const STATUS: Record<Outcome, { title: string; tone: Tone; icon: string }> = {
  released: { title: "Answered from approved documents", tone: "ok", icon: "✓" },
  not_found: { title: "Not found in the documents you can see", tone: "info", icon: "○" },
  held: { title: "Waiting for QA sign-off", tone: "wait", icon: "◷" },
  approved: { title: "Approved and signed by QA", tone: "ok", icon: "✓" },
  rejected: { title: "Rejected by QA", tone: "fail", icon: "✕" },
  refused: { title: "Not answered", tone: "fail", icon: "⊘" },
};

// Short label for pills and lists.
export const SHORT: Record<Outcome, string> = {
  released: "Answered",
  not_found: "Not found",
  held: "Waiting for QA",
  approved: "Approved by QA",
  rejected: "Rejected by QA",
  refused: "Not answered",
};

const REASONS: [RegExp, string][] = [
  [/^S0\b/, "You are not signed in as a known user."],
  [/^S1\b/, "Batch release and shipment decisions belong to the Qualified Person, not to this assistant."],
  [/^S2\b/, "Classifying an open deviation is the investigator's decision, not this assistant's."],
  [/^S3\b/, "Finding the root cause of an open event is the investigator's decision, not this assistant's."],
  [/^S4\b/, "Choosing a CAPA is a decision for QA, not for this assistant."],
  [/^S5\b/, "The question tried to change the assistant's instructions."],
  [/^S7\b/, "The question mixes alphabets or is not in English, so the rules can't read it reliably. Please ask in plain English."],
  [/^AI screen/, "The question asks for a decision this assistant is not allowed to make."],
  [/^R-INV-Q\b/, "It asks about investigations or past events, so QA checks the answer before you use it."],
  [/^R-INV-AI\b/, "It looks like investigation support, so QA checks the answer before you use it."],
  [/^R-INV-DOC\b/, "It quotes a deviation or CAPA record, so QA checks the answer before you use it."],
  [/^R-HUMAN\b/, "The procedure it quotes requires a person to act, so QA confirms it before you use it."],
  [/^V1\b/, "The draft contained nothing that could be checked."],
  [/^V2\b/, "The draft cited a passage it was never given."],
  [/^V3\b/, "The draft cited a document version that is no longer in force."],
  [/^V4\b/, "A quote in the draft was not found word for word in its source, or was cut out of its context."],
  [/^V5\b/, "A quote in the draft was too short to count as evidence."],
  [/^V6\b/, "The draft said something its quote does not: a number, unit, limit or 'not' did not match."],
  [/^V7\b/, "The draft used decision language (such as “approved for release” or “meets the specification”) that the assistant may not use."],
  [/^V8\b/, "The draft repeated instructions planted in a record."],
  [/^V9\b/, "Draft guidance was cited without its “not yet in force” label."],
  [/^V10\b/, "The draft named a product form or code its source never mentions."],
  [/^V11\b/, "The documents don't mention exactly what you asked about."],
  [/^P1\b/, "Part of the investigation pack cited the wrong kind of record."],
  [/^P2\b/, "The draft gave a cause for the open deviation. That is the investigator's decision."],
  [/^follow-up failed: AddedIdentifiers/, "The follow-up couldn't be understood safely, so nothing was searched. Ask it as a complete question."],
  [/failed: /, "The AI service did not respond in time, so nothing was released. Please try again."],
];

export function plainReason(reason: string): string {
  return REASONS.find(([pattern]) => pattern.test(reason))?.[1] ?? reason;
}

export function plainReasons(reasons: string[]): string[] {
  return [...new Set(reasons.map(plainReason))];
}

export const CHECK_PLAIN: Record<string, string> = {
  V1: "The answer contains claims that can be checked",
  V2: "Every source it cites was really found for this question",
  V3: "Every source is the version in force today",
  V4: "Every quote matches its source word for word",
  V5: "Every quote is long enough to prove something",
  V6: "Every number appears in the cited document",
  V7: "No release, classification, root-cause or CAPA decisions",
  V8: "No instructions planted in a record were followed",
  V9: "Draft guidance is labelled as not yet in force",
  V10: "No product form or code is added that the source doesn't mention",
  V11: "The sources cover what you specifically asked",
};

export const GATE_PLAIN: Record<string, { title: string; what: string }> = {
  Screen: { title: "Screened the question", what: "Rules first, then an AI check that can add a refusal but never remove one." },
  Retrieve: { title: "Searched approved documents", what: "Only in-force documents you may see; others are filtered out first." },
  Generate: { title: "AI drafted an answer", what: "Claims, each with a word-for-word quote. Nothing shown unchecked." },
  Validate: { title: "Checked every claim", what: "11 fixed checks on quotes, numbers, versions and wording." },
  Tier: { title: "Decided who must look", what: "From the kind of question, never from the AI's confidence." },
  Record: { title: "Recorded in the audit trail", what: "Saved and sealed before anything was shown." },
  Release: { title: "Answered, held for QA or not answered", what: "Exactly as the checks decided." },
};
