"use client";

import { useId } from "react";

import { switchPersona } from "@/app/actions";
import type { Persona } from "@/lib/api";

export function PersonaSwitcher({ personas, currentId }: { personas: Persona[]; currentId: string }) {
  const id = useId();
  return (
    <form action={switchPersona}>
      <label className="sr-only" htmlFor={id}>
        Switch persona
      </label>
      <select
        id={id}
        name="persona"
        defaultValue={currentId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm"
      >
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.role === "qa_manager" ? "QA Manager" : "QA Analyst"}
          </option>
        ))}
      </select>
    </form>
  );
}
