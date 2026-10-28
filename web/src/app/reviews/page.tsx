import { Suspense } from "react";

import { SignForm } from "@/components/sign-form";
import { Card, Citations, EmptyState, ErrorNote, Mono, PageHeader, RunLink, Skeleton, TierChip } from "@/components/ui";
import { getQueue, settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function ReviewsPage() {
  return (
    <>
      <PageHeader eyebrow="Review queue" title="Held answers wait here for a signature.">
        An answer is held when the rules put it in tier T2: an investigation request, a cited deviation or CAPA record,
        a procedure that requires a person to act, or a check that needs a human eye. A QA Manager compares the draft
        with its quotes, then approves or rejects it with an electronic signature. Nobody signs their own question.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={3} />}>
        <Queue />
      </Suspense>
    </>
  );
}

async function Queue() {
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  if (!me.can_sign) {
    return (
      <EmptyState>
        {me.name} cannot sign. Only a QA Manager sees the withheld drafts. Switch persona to Jordan Lee (QA Manager) to
        review them.
      </EmptyState>
    );
  }
  const queue = await settle(getQueue(me.id));
  if (!queue.data) return <ErrorNote>API unreachable: {queue.error}</ErrorNote>;
  if (queue.data.length === 0) {
    return <EmptyState>Nothing waiting. Ask “Who must approve a change to a master batch record?” as an analyst to see one appear.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-600">{queue.data.length} answer(s) waiting for {me.name}.</p>
      {queue.data.map((item) => (
        <Card
          key={item.ask_seq}
          title={<RunLink seq={item.ask_seq}>{item.question}</RunLink>}
          aside={<span className="flex items-center gap-2 text-xs text-zinc-500"><TierChip tier={item.tier} /> <Mono>#{item.ask_seq}</Mono> · {item.requested_by}</span>}
        >
          <div className="flex flex-col gap-4">
            <ul className="list-disc pl-5 text-xs text-zinc-600">
              {item.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Withheld draft</p>
              <p className="text-sm leading-relaxed text-zinc-900">{item.text}</p>
            </div>
            <Citations citations={item.citations} />
            <p className="text-xs text-zinc-500">
              You sign exactly this text and these citations: content <Mono>{item.content_hash.slice(0, 16)}…</Mono>
            </p>
            <SignForm askSeq={item.ask_seq} signerName={me.name} />
          </div>
        </Card>
      ))}
    </div>
  );
}
