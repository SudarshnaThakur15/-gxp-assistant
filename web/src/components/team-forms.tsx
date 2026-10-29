"use client";

import { useActionState } from "react";

import { answerTeam, askTeam, type TeamState } from "@/app/actions";

const INITIAL: TeamState = { error: null, done: false };
const field = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-strong focus:border-brand focus:outline-none";
const button = "w-fit rounded-lg bg-brand-action px-4 py-2 text-sm font-semibold text-white shadow-brand transition-transform active:scale-[0.97] disabled:cursor-wait disabled:opacity-40";

export const TEAMS = [
  { id: "quality-control", name: "Quality Control" },
  { id: "quality-assurance", name: "Quality Assurance" },
  { id: "production", name: "Production" },
  { id: "engineering", name: "Engineering" },
];

// "Not found": put the question to the team that owns that kind of document.
export function AskTeamForm({ askSeq, question }: { askSeq: number; question: string }) {
  const [state, formAction, pending] = useActionState(askTeam.bind(null, askSeq), INITIAL);
  if (state.done) return <p className="rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok-text">Sent. The team&apos;s answer will appear here.</p>;
  return (
    <form action={formAction} aria-busy={pending} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Team</span>
        <select name="team" defaultValue="quality-control" className={field}>
          {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Question for the team</span>
        <textarea name="question" rows={2} maxLength={1000} defaultValue={question} className={field} />
      </label>
      {state.error && <p className="rounded-lg bg-fail-bg px-3 py-2 text-sm text-fail-text">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Sending…" : "Send to the team"}</button>
    </form>
  );
}

export function AnswerTeamForm({ requestSeq }: { requestSeq: number }) {
  const [state, formAction, pending] = useActionState(answerTeam.bind(null, requestSeq), INITIAL);
  if (state.done) return <p className="rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok-text">Answer sent and recorded.</p>;
  return (
    <form action={formAction} aria-busy={pending} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-strong">Your answer</span>
        <textarea name="answer" rows={3} maxLength={1000} required className={field} />
      </label>
      {state.error && <p className="rounded-lg bg-fail-bg px-3 py-2 text-sm text-fail-text">{state.error}</p>}
      <button disabled={pending} className={button}>{pending ? "Sending…" : "Send answer"}</button>
    </form>
  );
}
