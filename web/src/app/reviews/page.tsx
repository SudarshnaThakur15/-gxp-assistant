import Link from "next/link";
import { Suspense } from "react";

import { SignForm } from "@/components/sign-form";
import { Card, Citations, EmptyState, ErrorNote, Mono, PageHeader, Skeleton } from "@/components/ui";
import { getQueue, settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";
import { plainReasons } from "@/lib/plain";
import { LinkPending } from "@/components/pending";

export default function ReviewsPage(props: PageProps<"/reviews">) {
  return (
    <>
      <PageHeader eyebrow="Review inbox" title="Answers waiting for your signature.">
        An answer lands here when a person has to check it first: it is about an investigation, it quotes a procedure
        that needs someone to act, or one of the checks wants a second look. Compare the draft with its quotes, then approve or
        reject it with your signing password.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={3} />}>
        <Inbox searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Inbox({ searchParams }: { searchParams: PageProps<"/reviews">["searchParams"] }) {
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  const nameOf = (id: string) => persona.data.all.find((p) => p.id === id)?.name ?? id;
  if (!me.can_sign) {
    return <EmptyState>Only a QA Manager can review and sign. Switch to Jordan Lee (QA Manager) to see the inbox.</EmptyState>;
  }
  const queue = await settle(getQueue(me.id));
  if (!queue.data) return <ErrorNote>API unreachable: {queue.error}</ErrorNote>;
  const items = queue.data;
  if (items.length === 0) {
    return <EmptyState>Nothing waiting. Answers appear here when an analyst asks something the rules hold for QA.</EmptyState>;
  }
  const raw = (await searchParams).item;
  const item = items.find((i) => String(i.ask_seq) === raw) ?? items[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <nav aria-label="Waiting answers" className="flex flex-col gap-2 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
        <p className="text-sm text-muted">{items.length} waiting</p>
        {items.map((i) => (
          <Link key={i.ask_seq} href={`/reviews?item=${i.ask_seq}`} aria-current={i === item ? "page" : undefined}
            className={`rounded-xl border p-3 transition-colors ${i === item ? "border-brand bg-brand-soft" : "border-line bg-white hover:border-line-strong"}`}>
            <LinkPending />
            <p className="text-xs text-faint"><Mono>#{i.ask_seq}</Mono> · {nameOf(i.requested_by)}</p>
            <p className="line-clamp-2 text-sm font-medium text-strong">{i.question}</p>
          </Link>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <p className="text-xs text-faint"><Mono>#{item.ask_seq}</Mono> · asked by {nameOf(item.requested_by)}</p>
          <h2 className="mt-1 text-xl font-semibold">{item.question}</h2>
          {item.standalone_question && (
            <p className="mt-1 text-sm text-muted">
              A follow-up in a chat, understood as: <span className="text-strong">{item.standalone_question}</span>{" "}
              <Link href={`/c/${item.chat_id}#run-${item.ask_seq}`} className="font-medium text-brand-text hover:underline">See the whole chat →</Link>
            </p>
          )}
          <div className="mt-4 rounded-xl bg-page p-4">
            <p className="text-sm font-semibold text-strong">Why the rules held it</p>
            <ul className="mt-1.5 list-disc pl-5 text-sm text-body">
              {plainReasons(item.reasons).map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
          <div className="mt-5">
            <p className="mb-2 w-fit rounded-md bg-wait-bg px-2 py-1 text-xs font-semibold text-wait-text">Draft · not released</p>
            <p className="text-[17px] leading-relaxed text-strong">{item.text}</p>
          </div>
          <div className="mt-5">
            <p className="mb-3 text-sm font-semibold text-strong">Check it against the sources</p>
            <Citations citations={item.citations} />
          </div>
          <p className="mt-4 text-xs text-faint">
            You sign exactly this text and these citations (content <Mono>{item.content_hash.slice(0, 16)}…</Mono>).{" "}
            <Link href={`/runs/${item.ask_seq}`} className="font-medium text-brand-text hover:underline">See all checks →</Link>
          </p>
        </Card>
        <Card title="Your decision">
          <SignForm key={item.ask_seq} askSeq={item.ask_seq} signerName={me.name} />
        </Card>
      </div>
    </div>
  );
}
