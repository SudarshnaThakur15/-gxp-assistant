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

export type AskOutcome = { chatId: string; seq: number; error?: undefined } | { error: string };

// A new question, or a follow-up in a chat (the API checks the chat is this person's own).
export async function askQuestion(question: string, chatId: string | null): Promise<AskOutcome> {
  const text = question.trim();
  if (text.length < 3) {
    return { error: "Type a question first." };
  }
  const { current } = await getCurrentPersona();
  const res = await postJson<AskResult>("/ask", { persona: current.id, question: text, chat_id: chatId });
  if (!res.ok) {
    // 404: not a chat this person can continue. 503: the audit entry could not be written, so nothing was released.
    return {
      error: res.status === 404
        ? "This chat can't be continued. Start a new chat."
        : `Nothing was released (${res.status}). Try again in a minute.`,
    };
  }
  refresh();
  return { chatId: res.data.chat.id, seq: res.data.receipt.audit_seq };
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
