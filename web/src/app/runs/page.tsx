import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, ErrorNote, formatTime, Mono, OutcomePill, PageHeader, RunLink, Skeleton, TierChip } from "@/components/ui";
import { getRuns, settle, type Filter } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

const PILLS: { filter: Filter | null; label: string }[] = [
  { filter: null, label: "All" },
  { filter: "released", label: "Released by rules" },
  { filter: "held", label: "Held for review" },
  { filter: "decided", label: "Decided by QA" },
  { filter: "refused", label: "Refused" },
];

const EMPTY: Record<string, string> = {
  all: "No questions yet. Ask one in the console.",
  released: "Nothing released yet. Knowledge answers that pass every check (tier T1) appear here.",
  held: "Nothing held. Investigation answers and procedures that require a person (tier T2) appear here.",
  decided: "Nothing decided yet. Held answers appear here once a QA Manager approves or rejects them.",
  refused: "Nothing refused. Prohibited requests and answers that fail a blocking check appear here.",
};

export default function RunsPage(props: PageProps<"/runs">) {
  return (
    <>
      <PageHeader eyebrow="Question runs" title="Every question, checked and routed.">
        The AI drafts; fixed rules check each claim, set the tier and decide what the person who asked may see.
        Every run below is an entry in the tamper-evident audit trail.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={4} />}>
        <RunsTable searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function RunsTable({ searchParams }: { searchParams: PageProps<"/runs">["searchParams"] }) {
  const raw = (await searchParams).filter;
  const filter = typeof raw === "string" && PILLS.some((p) => p.filter === raw) ? (raw as Filter) : null;
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const res = await settle(getRuns(persona.data.current.id, filter ?? undefined));
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { counts, runs } = res.data;

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-2" aria-label="Filter runs">
        {PILLS.map((p) => {
          const active = p.filter === filter;
          return (
            <Link
              key={p.label}
              href={p.filter ? `/runs?filter=${p.filter}` : "/runs"}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm ring-1 ring-inset ${
                active ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-700 ring-zinc-300 hover:bg-zinc-50"
              }`}
            >
              {p.label} <span className={active ? "text-zinc-300" : "text-zinc-400"}>{counts[p.filter ?? "all"]}</span>
            </Link>
          );
        })}
      </nav>

      {runs.length === 0 ? (
        <EmptyState>{EMPTY[filter ?? "all"]}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Question</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium">Why (fixed rules)</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {runs.map((run) => (
                <tr key={run.seq} className="align-top">
                  <td className="px-4 py-3">
                    <RunLink seq={run.seq}>{run.question}</RunLink>
                    <p className="text-xs text-zinc-500">
                      <Mono>#{run.seq}</Mono> · {run.requested_by.name}
                    </p>
                  </td>
                  <td className="px-4 py-3"><OutcomePill outcome={run.outcome} label={run.label} /></td>
                  <td className="px-4 py-3"><TierChip tier={run.tier} /></td>
                  <td className="max-w-xs px-4 py-3 text-xs text-zinc-600">{run.reason ?? "All checks passed"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">{formatTime(run.recorded_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
