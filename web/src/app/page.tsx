import Link from "next/link";
import { Suspense } from "react";

import { AskPanel } from "@/components/ask-panel";
import { ByBadge, Card, EmptyState, ErrorNote, formatTime, Mono, OutcomePill, PageHeader, RunLink, Skeleton, TierChip } from "@/components/ui";
import { getQueue, getRuns, settle, verifyAudit } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";
import { AI_MODEL } from "@/lib/site";

export default function ConsolePage() {
  return (
    <>
      <PageHeader eyebrow="Console" title="Ask the approved documents. Rules decide what you see.">
        The AI drafts an answer only from approved, in-force documents you are allowed to see. Fixed rules check
        every claim against its source, set the tier and record the run in the audit trail before anything is shown.
      </PageHeader>
      <Card title="Ask a question" aside={<ByBadge by="AI" model={AI_MODEL} />}>
        <AskPanel model={AI_MODEL} />
      </Card>
      <Suspense fallback={<Skeleton lines={2} />}>
        <Overview />
      </Suspense>
    </>
  );
}

function Tile({ value, label, caption, href }: { value: React.ReactNode; label: string; caption: string; href?: string }) {
  const body = (
    <>
      <p className="text-2xl font-bold tracking-tight text-zinc-900">{value}</p>
      <p className="text-sm font-medium text-zinc-800">{label}</p>
      <p className="text-xs text-zinc-500">{caption}</p>
    </>
  );
  const cls = "flex flex-col gap-0.5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm";
  return href ? <Link href={href} className={`${cls} hover:border-zinc-400`}>{body}</Link> : <div className={cls}>{body}</div>;
}

async function Overview() {
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  const [runs, audit, queue] = await Promise.all([
    settle(getRuns(me.id)),
    settle(verifyAudit()),
    me.can_sign ? settle(getQueue(me.id)) : Promise.resolve(null),
  ]);
  if (!runs.data) return <ErrorNote>API unreachable: {runs.error}</ErrorNote>;
  const c = runs.data.counts;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile value={c.all} label="Questions" caption="runs visible to you" href="/runs" />
        <Tile value={c.released} label="Released by rules" caption="cited, all checks passed" href="/runs?filter=released" />
        <Tile value={c.held} label="Held for review" caption="waiting for a QA signature" href="/runs?filter=held" />
        <Tile value={c.decided} label="Decided by QA" caption="signed: approved or rejected" href="/runs?filter=decided" />
        <Tile value={c.refused} label="Refused" caption="prohibited, unverifiable or failed safely" href="/runs?filter=refused" />
        <Tile
          value={audit.data ? (audit.data.ok ? "Intact" : "Broken") : "?"}
          label="Audit trail"
          caption={audit.data ? `${audit.data.entries} entries, verified just now` : "could not verify"}
          href="/audit"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {queue?.data && (
          <Card title={`Waiting for your signature (${queue.data.length})`}
            aside={<Link href="/reviews" className="text-sm text-zinc-600 hover:underline">Review queue →</Link>}>
            {queue.data.length === 0 ? (
              <EmptyState>Nothing to sign. Answers held by the rules (tier T2) appear here.</EmptyState>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {queue.data.slice(0, 5).map((item) => (
                  <li key={item.ask_seq} className="flex flex-col gap-1 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Mono className="text-zinc-500">#{item.ask_seq}</Mono>
                      <TierChip tier={item.tier} />
                      <RunLink seq={item.ask_seq}>{item.question}</RunLink>
                    </div>
                    <p className="text-xs text-zinc-500">{item.reasons[0]}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card title="Recent questions" aside={<Link href="/runs" className="text-sm text-zinc-600 hover:underline">All runs →</Link>}>
          {runs.data.runs.length === 0 ? (
            <EmptyState>No questions yet. Ask one above; every run appears here and in the audit trail.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {runs.data.runs.slice(0, 6).map((run) => (
                <li key={run.seq} className="flex flex-col gap-1 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <OutcomePill outcome={run.outcome} label={run.label} />
                    <RunLink seq={run.seq}>{run.question}</RunLink>
                  </div>
                  <p className="text-xs text-zinc-500">
                    <Mono>#{run.seq}</Mono> · {run.requested_by.name} · {formatTime(run.recorded_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
