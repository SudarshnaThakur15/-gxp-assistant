"use client";

import { useId, useState, useTransition } from "react";

import { switchPersona } from "@/app/actions";
import { Overlay, Spinner, TopBar } from "@/components/pending";
import type { Persona } from "@/lib/api";

const ROLE = { qa_analyst: "QA Analyst", qa_manager: "QA Manager", auditor: "Auditor", team_member: "Team member" } as const;

// Switching persona reloads every view for the new role, so show it happening instead of freezing.
export function PersonaSwitcher({ personas, currentId }: { personas: Persona[]; currentId: string }) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<Persona | null>(null);

  return (
    <>
      <label className="sr-only" htmlFor={id}>Switch persona</label>
      <div className="relative">
        <select
          id={id}
          value={pending && target ? target.id : currentId}
          disabled={pending}
          onChange={(e) => {
            const next = personas.find((p) => p.id === e.target.value) ?? null;
            setTarget(next);
            startTransition(() => switchPersona(e.target.value));
          }}
          className="w-full cursor-pointer appearance-none rounded-lg border border-ink-line bg-ink-2 px-2.5 py-2 pr-8 text-sm text-white transition-opacity disabled:cursor-wait disabled:opacity-60"
        >
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {ROLE[p.role]}</option>
          ))}
        </select>
        <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white/60">
          {pending ? <Spinner className="h-3.5 w-3.5" /> : "▾"}
        </span>
      </div>
      {pending && target && (
        <>
          <TopBar />
          <Overlay>
          <div role="status" aria-live="polite"
            className="fixed inset-0 z-40 flex items-center justify-center bg-page/60 backdrop-blur-[2px] motion-safe:animate-fade-in">
            <div className="flex items-center gap-3 rounded-card border border-line bg-white px-5 py-4 text-strong shadow-lift">
              <Spinner className="h-5 w-5 text-brand" />
              <div>
                <p className="font-semibold">Switching to {target.name}</p>
                <p className="text-sm text-muted">Loading what {target.role === "auditor" ? "an" : "a"} {ROLE[target.role]} can see and do…</p>
              </div>
            </div>
          </div>
          </Overlay>
        </>
      )}
    </>
  );
}
