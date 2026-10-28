import Link from "next/link";
import { Suspense } from "react";

import { reverifyAudit } from "@/app/actions";
import { Card, ErrorNote, formatTime, Mono, PageHeader, Skeleton } from "@/components/ui";
import { getAudit, settle, verifyAudit } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

const PAGE_SIZE = 50;

export default function AuditPage(props: PageProps<"/audit">) {
  return (
    <>
      <PageHeader eyebrow="Audit trail" title="Every step, recorded before anything is released.">
        Each entry stores the hash of the entry before it, so changing any past entry breaks every link after it.
        The database refuses edits and deletions, and verification recomputes every hash from scratch.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={1} />}>
        <ChainStatus />
      </Suspense>
      <Suspense fallback={<Skeleton lines={4} />}>
        <Entries searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function ChainStatus() {
  const res = await settle(verifyAudit());
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {res.data ? (
          <p className={`text-sm font-medium ${res.data.ok ? "text-emerald-800" : "text-rose-800"}`}>
            {res.data.ok
              ? `✓ Chain intact: ${res.data.entries} entries verified just now`
              : `✕ Chain broken at entry #${res.data.broken_at}: ${res.data.reason}`}
            {res.data.head_hash && <span className="ml-2 font-normal text-zinc-500">head <Mono>{res.data.head_hash.slice(0, 16)}…</Mono></span>}
          </p>
        ) : (
          <p className="text-sm text-rose-800">Could not verify: {res.error}</p>
        )}
        <div className="flex gap-2">
          <form action={reverifyAudit}>
            <button className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">Re-verify</button>
          </form>
          <a href="/audit/csv" className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-800 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50">
            Download CSV
          </a>
        </div>
      </div>
    </Card>
  );
}

async function Entries({ searchParams }: { searchParams: PageProps<"/audit">["searchParams"] }) {
  const raw = (await searchParams).before;
  const before = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : undefined;
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  const res = await settle(getAudit(me.id, PAGE_SIZE, before));
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const entries = res.data;
  const oldest = entries.at(-1)?.seq;

  return (
    <div className="flex flex-col gap-3">
      {!me.can_sign && (
        <p className="text-xs text-zinc-500">
          Entry contents (questions, drafts, signatures) are shown to QA Managers only. Everyone can see and verify the chain.
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Event</th>
              <th className="px-4 py-3 font-medium">Contents</th>
              <th className="px-4 py-3 font-medium">Previous hash → hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 align-top">
            {entries.map((e) => (
              <tr key={e.seq}>
                <td className="px-4 py-2"><Mono>{e.seq}</Mono></td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-600">{formatTime(e.recorded_at)}</td>
                <td className="px-4 py-2 text-xs"><Mono>{e.actor}</Mono></td>
                <td className="px-4 py-2 text-xs">
                  {e.event_type === "ask" ? <Link href={`/runs/${e.seq}`} className="underline"><Mono>{e.event_type}</Mono></Link> : <Mono>{e.event_type}</Mono>}
                </td>
                <td className="max-w-md px-4 py-2 text-xs">
                  {e.payload ? (
                    <details>
                      <summary className="cursor-pointer text-zinc-700">{summarise(e.event_type, e.payload)}</summary>
                      <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-zinc-50 p-2 text-[0.7rem]">{JSON.stringify(e.payload, null, 2)}</pre>
                    </details>
                  ) : (
                    <span className="text-zinc-400">QA Managers only</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-500">
                  <Mono>{e.prev_hash.slice(0, 8)}</Mono> → <Mono className="text-zinc-800">{e.hash.slice(0, 8)}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 text-sm">
        {before && <Link href="/audit" className="text-zinc-700 hover:underline">← Newest</Link>}
        {oldest && oldest > 1 && entries.length === PAGE_SIZE && (
          <Link href={`/audit?before=${oldest}`} className="text-zinc-700 hover:underline">Older entries →</Link>
        )}
      </div>
    </div>
  );
}

function summarise(eventType: string, payload: Record<string, unknown>): string {
  if (eventType === "ask") return `${payload.decision}: ${String(payload.question).slice(0, 80)}`;
  if (eventType === "review") return `${payload.outcome} answer #${payload.ask_seq}`;
  if (eventType === "signature_refused") return `refused (${payload.code}) for answer #${payload.ask_seq}`;
  return Object.keys(payload).slice(0, 4).join(", ");
}
