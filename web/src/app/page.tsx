import Link from "next/link";
import { Suspense } from "react";

import { AnswerCard } from "@/components/answer-card";
import { Composer } from "@/components/composer";
import { Card, EmptyState, ErrorNote, Eyebrow, formatTime, Mono, OutcomePill, PageHeader, RunLink, Skeleton, Stat } from "@/components/ui";
import { getRun, getRuns, settle, verifyAudit, type Persona, type RunSummary } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";
import { plainReason, STATUS } from "@/lib/plain";
import { LinkPending } from "@/components/pending";

export default function HomePage(props: PageProps<"/">) {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <Home searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  if (me.role === "auditor") return <Overview me={me} />;
  const raw = (await searchParams).run;
  const selected = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null;
  return <Chat me={me} selected={selected} />;
}

// --- Analysts and QA Managers: ask, like a chat ------------------------------------------

const DOT: Record<string, string> = { ok: "bg-ok", wait: "bg-wait", fail: "bg-fail", info: "bg-brand" };

async function Chat({ me, selected }: { me: Persona; selected: number | null }) {
  const [runs, run] = await Promise.all([
    settle(getRuns(me.id)),
    selected ? settle(getRun(me.id, selected)) : Promise.resolve(null),
  ]);
  const mine = (runs.data?.runs ?? []).filter((r) => r.requested_by.id === me.id);
  const today = new Date().toISOString().slice(0, 10);
  const groups: [string, RunSummary[]][] = [
    ["Today", mine.filter((r) => r.recorded_at.slice(0, 10) === today)],
    ["Earlier", mine.filter((r) => r.recorded_at.slice(0, 10) !== today)],
  ];

  const list = (
    <nav aria-label="Your questions" className="flex flex-col gap-4">
      <Link href="/" className="rounded-lg bg-ink px-3 py-2 text-center text-sm font-semibold text-white hover:bg-ink-2">
        <LinkPending />
        + New question
      </Link>
      {mine.length === 0 && <p className="px-1 text-sm text-faint">Your questions will appear here.</p>}
      {groups.filter(([, items]) => items.length).map(([label, items]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">{label}</p>
          {items.slice(0, 40).map((r) => (
            <Link key={r.seq} href={`/?run=${r.seq}`} aria-current={r.seq === selected ? "page" : undefined}
              className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                r.seq === selected ? "bg-brand-soft text-strong" : "text-body hover:bg-sunken/60"}`}>
              <LinkPending />
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[STATUS[r.outcome].tone]}`} aria-label={STATUS[r.outcome].title} />
              <span className="line-clamp-2">{r.question}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-1">{list}</div>
      </aside>
      <details className="rounded-card border border-line bg-white p-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-semibold text-strong">Your questions ({mine.length})</summary>
        <div className="mt-3">{list}</div>
      </details>

      <section className="flex min-h-[70vh] min-w-0 flex-col gap-5">
        {selected && run?.data ? (
          <>
            <div className="flex justify-end">
              <p className="max-w-[85%] rounded-card rounded-br-md bg-ink px-4 py-3 text-[15px] text-white">{run.data.question}</p>
            </div>
            <AnswerCard run={run.data} viewerId={me.id} />
          </>
        ) : selected ? (
          <ErrorNote>That question is not visible to {me.name}.</ErrorNote>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-3 py-6">
            <Eyebrow>Assistant</Eyebrow>
            <h1 className="max-w-2xl text-3xl font-extrabold leading-[1.08] sm:text-4xl">
              Ask the approved documents.<br />Rules decide what you see.
            </h1>
            <p className="max-w-xl text-[15px] leading-relaxed text-muted">
              Every answer quotes the exact document section it comes from. Fixed rules check each claim first, and
              anything that needs a person waits for a QA signature. Try one of these:
            </p>
          </div>
        )}
        <div className="sticky bottom-3 z-10 mt-auto">
          <Composer showSuggestions={!selected} />
        </div>
      </section>
    </div>
  );
}

// --- Auditors: read-only overview ---------------------------------------------------------

// Verifying the chain recomputes every hash, so it streams in after the rest of the page.
async function ChainTile() {
  const audit = await settle(verifyAudit());
  return (
    <Stat value={audit.data ? (audit.data.ok ? "Intact" : "Broken") : "?"} label="Audit trail"
      caption={audit.data ? `${audit.data.entries} entries, verified now` : "could not verify"} />
  );
}

async function Overview({ me }: { me: Persona }) {
  const runs = await settle(getRuns(me.id));
  if (!runs.data) return <ErrorNote>API unreachable: {runs.error}</ErrorNote>;
  const c = runs.data.counts;
  const held = runs.data.runs.filter((r) => r.outcome === "held");

  return (
    <>
      <PageHeader eyebrow="Overview" title="Everything the assistant did, and who decided.">
        A read-only view across both client programmes. You can open any question, its checks and its audit record,
        but you cannot ask or sign: auditors stay independent of the work they audit.
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat value={c.all} label="Questions" caption="across both programmes" />
        <Stat value={c.released} label="Answered by rules" caption="cited, every check passed" tone="ok" />
        <Stat value={c.held} label="Waiting for QA" caption="held for a signature" tone={c.held ? "wait" : undefined} />
        <Stat value={c.decided} label="Decided by QA" caption="approved or rejected" />
        <Stat value={c.refused} label="Can't answer" caption="prohibited or unverifiable" />
        <Suspense fallback={<Stat value={<span className="inline-block h-8 w-20 animate-pulse rounded bg-sunken" />} label="Audit trail" caption="verifying every entry…" />}>
          <ChainTile />
        </Suspense>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Waiting for QA sign-off (${held.length})`} aside={<Link href="/runs?filter=held" className="text-sm font-medium text-brand-text hover:underline">All →</Link>}>
          {held.length === 0 ? <EmptyState>Nothing is waiting for a signature.</EmptyState> : (
            <ul className="flex flex-col gap-2">
              {held.slice(0, 6).map((r) => (
                <li key={r.seq} className="rounded-xl border border-line-soft p-3">
                  <p className="text-xs text-faint"><Mono>#{r.seq}</Mono> · {r.requested_by.name}{r.test && " · test run"}</p>
                  <RunLink seq={r.seq}>{r.question}</RunLink>
                  {r.reason && <p className="text-sm text-muted">{plainReason(r.reason)}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Latest questions" aside={<Link href="/runs" className="text-sm font-medium text-brand-text hover:underline">All →</Link>}>
          <ul className="divide-y divide-line-soft">
            {runs.data.runs.slice(0, 8).map((r) => (
              <li key={r.seq} className="flex flex-col gap-1 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <OutcomePill outcome={r.outcome} />
                  {r.test && <span className="text-xs text-faint">test run</span>}
                </div>
                <RunLink seq={r.seq}>{r.question}</RunLink>
                <p className="text-xs text-faint"><Mono>#{r.seq}</Mono> · {r.requested_by.name} · {formatTime(r.recorded_at)}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
