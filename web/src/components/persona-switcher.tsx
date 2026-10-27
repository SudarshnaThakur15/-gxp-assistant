"use client";

import { switchPersona } from "@/app/actions";
import type { Persona } from "@/lib/api";

export function PersonaSwitcher({ personas, currentId }: { personas: Persona[]; currentId: string }) {
  return (
    <form action={switchPersona}>
      <label className="sr-only" htmlFor="persona">
        Acting as
      </label>
      <select
        id="persona"
        name="persona"
        defaultValue={currentId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.title}
          </option>
        ))}
      </select>
    </form>
  );
}
