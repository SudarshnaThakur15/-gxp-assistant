"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";

import { askQuestion, type AskState } from "@/app/actions";
import { Spinner, TopBar } from "@/components/pending";

// Each suggestion shows a different path through the rules.
const SUGGESTIONS = [
  { text: "What is the protein concentration specification for ALD-101?", note: "answered from a specification" },
  { text: "Who must approve a change to a master batch record?", note: "a person must act, so QA signs first" },
  { text: "Can batch ALD-26-117 be released?", note: "refused by a rule, no AI call" },
  { text: "Can generative AI be used in critical GMP applications?", note: "draft guidance gets its label" },
  { text: "Summarise deviation DEV-2026-019.", note: "a record with planted AI instructions" },
];

const INITIAL: AskState = { question: "", result: null, error: null };

export function Composer({ showSuggestions }: { showSuggestions: boolean }) {
  const [state, formAction, pending] = useActionState(askQuestion, INITIAL);
  const [text, setText] = useState("");
  const [asked, setAsked] = useState("");
  const [opening, startOpening] = useTransition();
  const router = useRouter();
  const seq = state.result?.receipt.audit_seq;
  const busy = pending || opening;

  useEffect(() => {
    if (seq) startOpening(() => router.push(`/?run=${seq}`));
  }, [seq, router]);

  return (
    <div className="flex flex-col gap-3">
      {busy && <TopBar />}
      {showSuggestions && !busy && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s.text} type="button" onClick={() => setText(s.text)} title={s.note}
              className="rounded-full border border-brand/40 bg-brand-soft px-3 py-1.5 text-left text-[13px] text-brand-text transition-colors hover:bg-brand-tint">
              {s.text}
            </button>
          ))}
        </div>
      )}
      <form
        action={(fd) => { setAsked(text.trim()); setText(""); formAction(fd); }}
        className="rounded-card border border-line bg-white p-2 shadow-lift"
      >
        {busy && (
          <div role="status" aria-live="polite" className="flex flex-col gap-1.5 border-b border-line-soft px-3 pb-3 pt-2 motion-safe:animate-fade-in">
            <p className="text-sm text-strong"><span className="text-faint">You asked:</span> {asked}</p>
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-3.5 w-3.5 text-brand" />
              {pending
                ? "Screening, searching approved documents, drafting, checking every claim, recording. Usually 5–20 seconds."
                : "Checked and recorded. Opening your answer…"}
            </p>
          </div>
        )}
        {state.error && !busy && <p className="mx-2 mt-1 rounded-lg bg-fail-bg px-3 py-2 text-sm text-fail-text">{state.error}</p>}
        <div className="flex items-end gap-2">
          <label htmlFor="question" className="sr-only">Your question</label>
          <textarea
            id="question"
            name="question"
            rows={1}
            maxLength={1000}
            value={busy ? "" : text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && text.trim().length >= 3) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask about an SOP, a specification, a deviation or a regulation…"
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] text-strong placeholder:text-faint focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || text.trim().length < 3}
            className="mb-0.5 rounded-lg bg-brand-action px-4 py-2.5 text-sm font-semibold text-white shadow-brand transition-[opacity,transform] active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? "Checking…" : "Ask"}
          </button>
        </div>
        <p className="px-3 pb-1 pt-1 text-[11px] text-faint">
          Each question is answered on its own from approved documents. Enter to send, Shift+Enter for a new line.
        </p>
      </form>
    </div>
  );
}
