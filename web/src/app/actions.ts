"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";

import { getPersonas, postJson, type AskResult, type SignResult } from "@/lib/api";
import { getCurrentPersona, PERSONA_COOKIE } from "@/lib/persona";

export async function switchPersona(formData: FormData) {
  const id = formData.get("persona");
  const personas = await getPersonas();
  if (typeof id !== "string" || !personas.some((p) => p.id === id)) {
    throw new Error("Unknown persona");
  }
  (await cookies()).set(PERSONA_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function reverifyAudit() {
  refresh(); // the page verifies the chain on every render
}

export type AskState ={ question: string; result: AskResult | null; error: string | null };

export async function askQuestion(_prev: AskState, formData: FormData): Promise<AskState> {
  const question = String(formData.get("question") ?? "").trim();
  if (question.length < 3) {
    return { question, result: null, error: "Type a question first." };
  }
  const { current } = await getCurrentPersona();
  const res = await postJson<AskResult>("/ask", { persona: current.id, question });
  if (!res.ok) {
    // 503: the audit entry could not be written, so nothing was released.
    return { question, result: null, error: `Nothing was released (${res.status}). Try again in a minute.` };
  }
  refresh();
  return { question, result: res.data, error: null };
}

export type SignState = { result: SignResult | null; error: string | null };

export async function signAnswer(askSeq: number, _prev: SignState, formData: FormData): Promise<SignState> {
  const decision = formData.get("decision");
  const password = String(formData.get("password") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (decision !== "approve" && decision !== "reject") {
    return { result: null, error: "Choose approve or reject." };
  }
  if (decision === "reject" && !reason) {
    return { result: null, error: "A rejection needs a reason." };
  }
  // The signer is the current persona; the API checks role, own question and access again.
  const { current } = await getCurrentPersona();
  const res = await postJson<SignResult>(`/reviews/${askSeq}`, {
    persona: current.id,
    decision,
    password,
    reason: reason || null,
  });
  if (!res.ok) {
    const detail = res.detail as { message?: string } | string | null;
    const message = typeof detail === "string" ? detail : detail?.message;
    return { result: null, error: message ?? `Signature refused (${res.status}).` };
  }
  refresh();
  return { result: res.data, error: null };
}
