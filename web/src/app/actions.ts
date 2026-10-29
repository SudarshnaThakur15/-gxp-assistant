"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getPersonas, postJson, type AskResult, type SignResult } from "@/lib/api";
import { getCurrentPersona, PERSONA_COOKIE } from "@/lib/persona";

// Where each role starts: the QA Manager's work is the review inbox.
const HOME = { qa_analyst: "/", qa_manager: "/reviews", auditor: "/" } as const;

export async function switchPersona(id: string) {
  const persona = (await getPersonas()).find((p) => p.id === id);
  if (!persona) {
    throw new Error("Unknown persona");
  }
  (await cookies()).set(PERSONA_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(HOME[persona.role]);
}

// Pages that verify the chain or run the lab do so on every render: refreshing re-runs them.
export async function refreshPage() {
  refresh();
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
