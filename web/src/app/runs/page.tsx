import Link from "next/link";
import { Suspense } from "react";

import { EmptyState, ErrorNote, formatTime, Mono, OutcomePill, PageHeader, Skeleton } from "@/components/ui";
import { getRuns, settle, type Filter } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";
import { plainReason } from "@/lib/plain";
import { LinkPending } from "@/components/pending";

const PILLS: { filter: Filter | null; label: string }[] = [
  { filter: null, label: "All" },
  { filter: "released", label: "Answered" },
  { filter: "held", label: "Waiting for QA" },
  { filter: "decided", label: "Decided by QA" },
  { filter: "refused", label: "Can't answer" },
];

const EMPTY: Record<string, string> = {
  all: "No questions yet. Ask one on the Ask page.",
  released: "Nothing answered yet. Answers that pass every check appear here.",
  held: "Nothing is waiting for QA. Investigation questions and procedures that need a person appear here.",
  decided: "Nothing decided yet. Answers appear here once a QA Manager approves or rejects them.",
  refused: "Nothing refused. Prohibited requests and drafts that fail a check appear here.",
};

const TITLE = {
  qa_analyst: ["My questions", "Everything you have asked, and what happened to it."],
  qa_manager: ["Team questions", "Questions from the programmes you cover."],
  auditor: ["All questions", "Every question across both programmes, including automated test runs."],
} as const;

export default function RunsPage(props: PageProps<"/runs">) {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <RunsTable searchParams={props.searchParams} />
    </Suspense>
  );
}

async function RunsTable({ searchParams }: { searchParams: PageProps<"/runs">["searchParams"] }) {
  const raw = (await searchParams).filter;
  const filter = typeof raw === "string" && PILLS.some((p) => p.filter === raw) ? (raw as Filter) : null;
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  const res = await settle(getRuns(me.id, filter ?? undefined));
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { counts, runs } = res.data;
  const [title, sub] = TITLE[me.role];

  return (
    <>
      <PageHeader eyebrow="Questions" title={title}>
        {sub} Each one is recorded in the audit trail, with the rules that decided it.
      </PageHeader>
      <nav className="flex flex-wrap gap-2" aria-label="Filter questions">
        {PILLS.map((p) => {
          const active = p.filter === filter;
          return (
            <Link key={p.label} href={p.filter ? `/runs?filter=${p.filter}` : "/runs"} aria-current={active ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-ink text-white" : "border border-line bg-white text-body hover:border-line-strong"}`}>
              <LinkPending />
              {p.label} <span className={active ? "text-white/60" : "text-faint"}>{counts[p.filter ?? "all"]}</span>
            </Link>
          );
        })}
      </nav>

      {runs.length === 0 ? (
        <EmptyState>{EMPTY[filter ?? "all"]}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {runs.map((run) => (
            <li key={run.seq}>
              <Link href={`/runs/${run.seq}`}
                className="flex flex-col gap-2 rounded-card border border-line bg-white p-4 shadow-card transition-shadow hover:shadow-lift sm:flex-row sm:items-center sm:gap-4">
                <LinkPending />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-strong">{run.question}</p>
                  <p className="mt-0.5 text-sm text-muted">{run.reason ? plainReason(run.reason) : "Every check passed."}</p>
                  <p className="mt-1 text-xs text-faint">
                    <Mono>#{run.seq}</Mono>{me.role !== "qa_analyst" && ` · ${run.requested_by.name}`} · {formatTime(run.recorded_at)}
                    {run.test && " · automated test run"}
                  </p>
                </div>
                <OutcomePill outcome={run.outcome} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
