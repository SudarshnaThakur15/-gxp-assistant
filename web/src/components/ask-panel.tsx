"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { askQuestion, type AskState } from "@/app/actions";
import { ByBadge, Citations, decisionOutcome, Mono, OutcomePill, TierChip } from "@/components/ui";

// Each suggestion shows a different path through the gates.
const SUGGESTIONS = [
  { text: "What is the protein concentration specification for ALD-101?", note: "released by rules" },
  { text: "Who must approve a change to a master batch record?", note: "held: a person must act" },
  { text: "Can batch ALD-26-117 be released?", note: "refused by a rule, no AI call" },
  { text: "Can generative AI be used in critical GMP applications?", note: "draft guidance label" },
  { text: "Summarise deviation DEV-2026-019.", note: "record with planted AI instructions" },
];

const INITIAL: AskState = { question: "", result: null, error: null };

export function AskPanel({ model }: { model: string }) {
  const [state, formAction, pending] = useActionState(askQuestion, INITIAL);
  const [text, setText] = useState("");
  const r = state.result;

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="question" className="sr-only">Your question</label>
        <textarea
          id="question"
          name="question"
          rows={2}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about an SOP, a specification, a deviation or a regulation…"
          className="w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pending || text.trim().length < 3}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {pending ? "Running the 7 gates…" : "Ask"}
          </button>
          {pending && <span className="text-xs text-zinc-500">The AI steps usually take 5–20 seconds.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              type="button"
              onClick={() => setText(s.text)}
              title={s.note}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-left text-xs text-zinc-700 hover:bg-zinc-100"
            >
              {s.text}
            </button>
          ))}
        </div>
      </form>

      {state.error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{state.error}</p>}

      {r && (
        <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <OutcomePill outcome={decisionOutcome(r.decision, r.answer_type)} label={r.decision_label} />
            <TierChip tier={r.tier} />
            <span className="text-xs text-zinc-500">
              Audit <Mono>#{r.receipt.audit_seq}</Mono> · <Mono>{r.receipt.audit_hash.slice(0, 12)}…</Mono> · rules{" "}
              <Mono>{r.receipt.ruleset_version}</Mono>
            </span>
          </div>
          <p className="text-sm leading-relaxed text-zinc-900">{r.message}</p>
          {r.notices.map((n) => (
            <p key={n} className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">{n}</p>
          ))}
          {r.citations.length > 0 && <Citations citations={r.citations} />}
          {r.decision !== "released" && r.reasons.length > 0 && (
            <div className="text-sm">
              <p className="font-medium text-zinc-800">
                {r.decision === "refused" ? "Why it was refused" : "Why a person must review it"} (fixed rules):
              </p>
              <ul className="mt-1 list-disc pl-5 text-zinc-700">
                {r.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </div>
          )}
          <ol className="flex flex-wrap gap-2">
            {r.gates.map((g) => (
              <li key={g.n} className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-xs ring-1 ring-zinc-200">
                <span className="font-semibold text-zinc-800">{g.n} {g.gate}</span>
                <ByBadge by={g.by} model={g.by === "AI" ? model : null} />
                <span className="text-zinc-600">{g.result}</span>
              </li>
            ))}
          </ol>
          <Link href={`/runs/${r.receipt.audit_seq}`} className="text-sm font-medium text-zinc-900 underline underline-offset-2">
            Open the full run: every check, passage and audit record →
          </Link>
        </div>
      )}
    </div>
  );
}
