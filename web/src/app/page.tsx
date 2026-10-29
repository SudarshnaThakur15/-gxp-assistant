import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Chat } from "@/components/chat";
import { Card, EmptyState, ErrorNote, formatTime, Mono, OutcomePill, PageHeader, RunLink, Skeleton, Stat } from "@/components/ui";
import { getRun, getRuns, getTeamRequests, settle, verifyAudit, type Persona } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";
import { plainReason } from "@/lib/plain";

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
  if (typeof raw === "string" && /^\d+$/.test(raw)) {  // links from before chats: open the question's chat
    const run = await settle(getRun(me.id, Number(raw)));
    if (run.data) redirect(`/c/${run.data.chat.id}#run-${raw}`);
  }
  return <Chat me={me} chatId={null} />;
}

// --- Auditors: read-only console ----------------------------------------------------------

// Verifying the chain recomputes every hash, so it streams in after the rest of the page.
async function ChainTile() {
  const audit = await settle(verifyAudit());
  return (
    <Stat value={audit.data ? (audit.data.ok ? "Intact" : "Broken") : "?"} label="Audit trail"
      caption={audit.data ? `${audit.data.entries} entries, verified now` : "could not verify"} />
  );
}

async function Overview({ me }: { me: Persona }) {
  const [runs, team] = await Promise.all([settle(getRuns(me.id)), settle(getTeamRequests(me.id))]);
  if (!runs.data) return <ErrorNote>API unreachable: {runs.error}</ErrorNote>;
  const c = runs.data.counts;
  const held = runs.data.runs.filter((r) => r.outcome === "held");
  const waitingOnTeam = (team.data ?? []).filter((r) => r.status === "waiting");
  const answered = runs.data.runs.filter((r) => r.outcome === "released").length;
  const share = c.all ? Math.round((answered / c.all) * 100) : 0;

  return (
    <>
      <PageHeader eyebrow="Auditor console" title="Everything the assistant has done, in one place.">
        Answers that pass every check go straight to the person who asked. Anything that needs a person waits for QA or
        for a team. You can open any question, its checks and its audit record, but you can&apos;t ask or sign, so your
        review stays independent.
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat value={`${share}%`} label="Answered straight away" caption={`${answered} of ${c.all}, with sources, every check passed`} tone="ok" />
        <Stat value={waitingOnTeam.length} label="Waiting on a team" caption="waiting for a reply" tone={waitingOnTeam.length ? "wait" : undefined} />
        <Stat value={c.held} label="Waiting for QA" caption="held for a signature" tone={c.held ? "wait" : undefined} />
        <Stat value={c.decided} label="Decided by QA" caption="approved or rejected" />
        <Stat value={c.refused} label="Not answered" caption="refused by a rule or failed a check" />
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
        <Card title={`Waiting on a team (${waitingOnTeam.length})`} aside={<Link href="/team-input" className="text-sm font-medium text-brand-text hover:underline">Team input →</Link>}>
          {waitingOnTeam.length === 0 ? <EmptyState>No question is waiting for a team&apos;s answer.</EmptyState> : (
            <ul className="flex flex-col gap-2">
              {waitingOnTeam.slice(0, 6).map((r) => (
                <li key={r.seq} className="rounded-xl border border-line-soft p-3">
                  <p className="text-xs text-faint"><Mono>#{r.ask_seq}</Mono> · {r.asked_by.name} · for {r.team.name}{r.test && " · test run"}</p>
                  <RunLink seq={r.ask_seq}>{r.question}</RunLink>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2" title="Latest questions" aside={<Link href="/runs" className="text-sm font-medium text-brand-text hover:underline">All →</Link>}>
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
