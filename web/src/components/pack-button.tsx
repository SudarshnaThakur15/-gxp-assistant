"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { askQuestion } from "@/app/actions";
import { Spinner } from "@/components/pending";

// A refused root-cause, classification or CAPA question: offer the part the assistant may do.
export function PackButton({ deviation, chatId }: { deviation: string; chatId: string }) {
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function prepare() {
    setError(null);
    startTransition(async () => {
      const res = await askQuestion(`Prepare an investigation pack for ${deviation}.`, chatId);
      if (res.error !== undefined) {
        setError(res.error);
        return;
      }
      startTransition(() => router.push(`/c/${res.chatId}#run-${res.seq}`));
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-brand/40 bg-brand-soft p-4">
      <p className="text-sm font-semibold text-strong">The assistant can help with the investigation instead</p>
      <p className="text-sm text-body">
        It can gather what the records say about {deviation}, earlier similar deviations with the causes and CAPAs people
        documented, and what the procedures require. A QA Manager signs it off, and the investigator decides.
      </p>
      {error && <p className="rounded-lg bg-fail-bg px-3 py-2 text-sm text-fail-text">{error}</p>}
      <button type="button" onClick={prepare} disabled={busy}
        className="flex w-fit items-center gap-2 rounded-lg bg-brand-action px-4 py-2 text-sm font-semibold text-white shadow-brand transition-transform active:scale-[0.97] disabled:cursor-wait disabled:opacity-60">
        {busy && <Spinner className="h-3.5 w-3.5" />}
        {busy ? "Preparing the pack…" : `Prepare an investigation pack for ${deviation}`}
      </button>
    </div>
  );
}
