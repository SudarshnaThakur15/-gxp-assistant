"use client";

import { useActionState } from "react";

import { enterAccessCode, type AccessState } from "@/app/actions";

const INITIAL: AccessState = { error: null };

export function AccessForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(enterAccessCode, INITIAL);
  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3 rounded-card border border-line bg-white p-5 shadow-card">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="code" className="text-sm font-medium text-strong">Access code</label>
      <input id="code" name="code" type="password" required autoComplete="off" autoFocus
        className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-strong focus:border-brand focus:outline-none" />
      {state.error && <p className="rounded-lg bg-fail-bg px-3 py-2 text-sm text-fail-text">{state.error}</p>}
      <button disabled={pending}
        className="w-fit rounded-lg bg-brand-action px-4 py-2 text-sm font-semibold text-white shadow-brand disabled:opacity-60">
        {pending ? "Checking…" : "Enter"}
      </button>
    </form>
  );
}
