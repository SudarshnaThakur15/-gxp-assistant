"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { askQuestion } from "@/app/actions";
import { Spinner, TopBar } from "@/components/pending";

// Each suggestion shows a different path through the rules.
const SUGGESTIONS = [
  { text: "What is the protein concentration specification for ALD-101?", note: "answered from a specification" },
  { text: "Who must approve a change to a master batch record?", note: "a person must act, so QA signs first" },
  { text: "Can batch ALD-26-117 be released?", note: "refused by a rule, no AI call" },
  { text: "Can generative AI be used in critical GMP applications?", note: "draft guidance gets its label" },
  { text: "Summarise deviation DEV-2026-019.", note: "a record with planted AI instructions" },
];

// The question box. In a chat, what you type is a follow-up: it is read with the chat's earlier questions.
export function Composer({ chatId, showSuggestions, onAsk }: {
  chatId: string | null;
  showSuggestions: boolean;
  onAsk?: (question: string | null) => void; // the question being checked; null once it failed
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const router = useRouter();

  function send() {
    const question = text.trim();
    if (question.length < 3 || busy) return;
    setText("");
    setError(null);
    onAsk?.(question);
    startTransition(async () => {
      const res = await askQuestion(question, chatId);
      if (res.error !== undefined) {
        setError(res.error);
        setText(question);
        onAsk?.(null);
        return;
      }
      startTransition(() => router.push(`/c/${res.chatId}#run-${res.seq}`));
    });
  }

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
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="rounded-card border border-line bg-white p-2 shadow-lift"
      >
        {error && !busy && <p className="mx-2 mt-1 rounded-lg bg-fail-bg px-3 py-2 text-sm text-fail-text">{error}</p>}
        <div className="flex items-end gap-2">
          <label htmlFor="question" className="sr-only">{chatId ? "Your follow-up" : "Your question"}</label>
          <textarea
            id="question"
            name="question"
            rows={1}
            maxLength={1000}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={busy ? "Checking your question…" : chatId ? "Ask a follow-up…" : "Ask about an SOP, a specification, a deviation or a regulation…"}
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] text-strong placeholder:text-faint focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || text.trim().length < 3}
            className="mb-0.5 flex items-center gap-2 rounded-lg bg-brand-action px-4 py-2.5 text-sm font-semibold text-white shadow-brand transition-[opacity,transform] active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
          >
            {busy && <Spinner className="h-3.5 w-3.5" />}
            {busy ? "Checking" : "Ask"}
          </button>
        </div>
        <p className="px-3 pb-1 pt-1 text-[11px] text-faint">
          {chatId
            ? "Follow-ups are read with this chat's earlier questions. Start a new chat for a new topic."
            : "Each chat keeps its own context. Enter to send, Shift+Enter for a new line."}
        </p>
      </form>
    </div>
  );
}
