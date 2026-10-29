"use client";

import { useActionState } from "react";

import { signAnswer, type SignState } from "@/app/actions";

const INITIAL: SignState = { result: null, error: null };

const field = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-strong focus:border-brand focus:outline-none";

// Electronic signature: the password is re-entered for every signature, and the
// meaning of the signature is shown before it is applied.
export function SignForm({ askSeq, signerName }: { askSeq: number; signerName: string }) {
  const [state, formAction, pending] = useActionState(signAnswer.bind(null, askSeq), INITIAL);

  if (state.result) {
    return (
      <p className={`rounded-xl px-4 py-3 text-sm ${state.result.outcome === "approved" ? "bg-ok-bg text-ok-text" : "bg-fail-bg text-fail-text"}`}>
        {state.result.signature} Recorded as audit #{state.result.receipt.audit_seq}.
      </p>
    );
  }

  return (
    <form action={formAction} aria-busy={pending} className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed text-body">
        Signing as <span className="font-semibold text-strong">{signerName}</span>. Approve means{" "}
        <em>reviewed against the cited sources and released for use</em>. Reject means it is not released.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Reason (required to reject)</span>
        <input name="reason" maxLength={500} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Signing password</span>
        <input name="password" type="password" required autoComplete="current-password" className={field} />
      </label>
      {state.error && <p className="rounded-lg bg-fail-bg px-3 py-2 text-sm text-fail-text">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button name="decision" value="approve" disabled={pending}
          className="rounded-lg bg-ok-text px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-[0.97] disabled:cursor-wait disabled:opacity-40">
          {pending ? "Signing…" : "Approve and sign"}
        </button>
        <button name="decision" value="reject" disabled={pending}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-fail-text ring-1 ring-inset ring-fail/40 transition-transform active:scale-[0.97] disabled:cursor-wait disabled:opacity-40">
          {pending ? "Signing…" : "Reject and sign"}
        </button>
      </div>
    </form>
  );
}
