import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";

import { getPersonas, type Persona } from "@/lib/api";

export const PERSONA_COOKIE = "persona";
const DEFAULT_PERSONA = "qa-analyst-a";

// Demo stand-in for real sign-in: the chosen persona lives in a cookie.
// cache(): the sidebar and the page share one lookup per request.
export const getCurrentPersona = cache(async (): Promise<{ current: Persona; all: Persona[] }> => {
  const [cookieStore, all] = await Promise.all([cookies(), getPersonas()]);
  const id = cookieStore.get(PERSONA_COOKIE)?.value ?? DEFAULT_PERSONA;
  const current = all.find((p) => p.id === id) ?? all.find((p) => p.id === DEFAULT_PERSONA) ?? all[0];
  return { current, all };
});
