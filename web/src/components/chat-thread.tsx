"use client";

import { useEffect, useRef, useState } from "react";

import { Composer } from "@/components/composer";
import { Spinner } from "@/components/pending";

// The conversation column: the messages (rendered on the server), the question being checked, and the
// question box. The new question shows at once; its answer replaces the placeholder when it is recorded.
export function ChatThread({ chatId, lastSeq, canAsk, children }: {
  chatId: string | null;
  lastSeq: number | null;
  canAsk: boolean;
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [answered, setAnswered] = useState(lastSeq);
  if (lastSeq !== answered) {  // the answer has arrived
    setAnswered(lastSeq);
    setPending(null);
  }

  const firstScroll = useRef(true);
  useEffect(() => {
    const target = document.getElementById(pending ? "pending-turn" : `run-${lastSeq}`);
    target?.scrollIntoView({ block: pending ? "center" : "start", behavior: firstScroll.current ? "auto" : "smooth" });
    firstScroll.current = false;
  }, [pending, lastSeq]);

  return (
    <section className="flex min-h-[70vh] min-w-0 flex-col gap-6">
      {(chatId || !pending) && children}
      {pending && <PendingTurn question={pending} />}
      {canAsk && (
        <div className="sticky bottom-3 z-10 mt-auto">
          <Composer chatId={chatId} showSuggestions={!chatId && !pending} onAsk={setPending} />
        </div>
      )}
    </section>
  );
}

function PendingTurn({ question }: { question: string }) {
  return (
    <div id="pending-turn" className="flex flex-col gap-3 motion-safe:animate-fade-in">
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-line rounded-card rounded-br-md bg-ink px-4 py-3 text-[15px] text-white">{question}</p>
      </div>
      <div role="status" aria-live="polite" className="rounded-card border border-line bg-white px-5 py-4 shadow-card">
        <p className="flex items-center gap-2 text-sm font-semibold text-strong">
          <Spinner className="h-4 w-4 text-brand" />
          Checking your question
        </p>
        <p className="mt-1 text-sm text-muted">
          Screening it, searching the approved documents, drafting, checking every claim and recording the result.
          Usually 5–20 seconds.
        </p>
      </div>
    </div>
  );
}
