"use server";

import { cookies } from "next/headers";

import { getPersonas } from "@/lib/api";
import { PERSONA_COOKIE } from "@/lib/persona";

export async function switchPersona(formData: FormData) {
  const id = formData.get("persona");
  const personas = await getPersonas();
  if (typeof id !== "string" || !personas.some((p) => p.id === id)) {
    throw new Error("Unknown persona");
  }
  (await cookies()).set(PERSONA_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
}
