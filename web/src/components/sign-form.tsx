"use client";

import { useActionState } from "react";

import { signAnswer, type SignState } from "@/app/actions";

const INITIAL: SignState = { result: null, error: null };

// Electronic signature: the password is re-entered for every signature, and the
// meaning of the signature is shown before it is applied.
export function SignForm({ askSeq, signerName }: { askSeq: number; signerName: string }) {
  const [state, formAction, pending] = useActionState(signAnswer.bind(null, askSeq), INITIAL);

  if (state.result) {
    return (
      <p className={`rounded-xl px-4 py-3 text-sm ${
        state.result.outcome === "approved" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
        {state.result.signature} Recorded as audit #{state.result.receipt.audit_seq}.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-sm text-zinc-700">
        Signing as <span className="font-semibold">{signerName}</span>. Approving means:{" "}
        <em>reviewed against the cited sources and released for use</em>. Rejecting means: not released.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-700">Reason (required to reject)</span>
        <input name="reason" maxLength={500} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-700">Signing password</span>
        <input name="password" type="password" required autoComplete="current-password"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5" />
      </label>
      {state.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button name="decision" value="approve" disabled={pending}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          Approve and sign
        </button>
        <button name="decision" value="reject" disabled={pending}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-rose-700 ring-1 ring-inset ring-rose-300 disabled:opacity-40">
          Reject and sign
        </button>
      </div>
    </form>
  );
}
