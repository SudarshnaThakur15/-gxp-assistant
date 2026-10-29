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
  { filter: "refused", label: "Not answered" },
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
  team_member: ["Questions", "Team members answer team requests and do not ask questions."],
} as const;

export default function RunsPage(props: PageProps<"/runs">) {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <RunsTable searchParams={props.searchParams} />
    </Suspense>
  );
}

const PAGE_SIZE = 20;

function pageHref(filter: Filter | null, page: number) {
  const q = new URLSearchParams();
  if (filter) q.set("filter", filter);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/runs?${s}` : "/runs";
}

async function RunsTable({ searchParams }: { searchParams: PageProps<"/runs">["searchParams"] }) {
  const params = await searchParams;
  const raw = params.filter;
  const rawPage = typeof params.page === "string" ? Number(params.page) : 1;
  const filter = typeof raw === "string" && PILLS.some((p) => p.filter === raw) ? (raw as Filter) : null;
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  const res = await settle(getRuns(me.id, filter ?? undefined));
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { counts, runs: all } = res.data;
  const [title, sub] = TITLE[me.role];
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Number.isInteger(rawPage) ? Math.min(Math.max(rawPage, 1), pages) : 1;
  const runs = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
      {all.length > PAGE_SIZE && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, all.length)} of {all.length}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {page > 1 && (
              <Link href={pageHref(filter, page - 1)} className="rounded-lg border border-line bg-white px-3 py-1.5 font-medium text-body hover:border-line-strong">
                <LinkPending />← Previous
              </Link>
            )}
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <Link key={n} href={pageHref(filter, n)} aria-current={n === page ? "page" : undefined}
                className={`min-w-9 rounded-lg px-2.5 py-1.5 text-center font-medium ${
                  n === page ? "bg-ink text-white" : "border border-line bg-white text-body hover:border-line-strong"}`}>
                <LinkPending />{n}
              </Link>
            ))}
            {page < pages && (
              <Link href={pageHref(filter, page + 1)} className="rounded-lg border border-line bg-white px-3 py-1.5 font-medium text-body hover:border-line-strong">
                <LinkPending />Next →
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
