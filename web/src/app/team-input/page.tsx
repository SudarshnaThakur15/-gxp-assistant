import Link from "next/link";
import { Suspense } from "react";

import { AnswerTeamForm } from "@/components/team-forms";
import { EmptyState, ErrorNote, formatTime, Mono, PageHeader, Pill, Skeleton } from "@/components/ui";
import { getTeamRequests, settle, type Persona, type TeamRequest } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function TeamInputPage() {
  return (
    <>
      <PageHeader eyebrow="Team input" title="Questions sent to a team.">
        When the documents don&apos;t cover a question, the person who asked can send it to the team responsible. It
        stays open until someone from that team replies, and both the question and the reply are saved in the audit
        trail. Replies are marked as the team&apos;s own answer: they don&apos;t come from an approved document and are not
        checked automatically.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={4} />}>
        <Requests />
      </Suspense>
    </>
  );
}

async function Requests() {
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const { current: me, all } = persona.data;
  const res = await settle(getTeamRequests(me.id));
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const waiting = res.data.filter((r) => r.status === "waiting");
  const answered = res.data.filter((r) => r.status === "answered");

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Waiting for an answer ({waiting.length})</h2>
        {waiting.length === 0 ? (
          <EmptyState>
            Nothing is waiting. A request appears here when someone gets &ldquo;Not found&rdquo; and chooses
            &ldquo;Send to the team&rdquo; on that answer.
          </EmptyState>
        ) : waiting.map((r) => <RequestCard key={r.seq} r={r} me={me} people={all} />)}
      </section>
      {answered.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Answered ({answered.length})</h2>
          {answered.map((r) => <RequestCard key={r.seq} r={r} me={me} people={all} />)}
        </section>
      )}
    </>
  );
}

function RequestCard({ r, me, people }: { r: TeamRequest; me: Persona; people: Persona[] }) {
  const members = people.filter((p) => p.teams.some((t) => t.id === r.team.id)).map((p) => p.name);
  // Team members see the question only; the run itself stays visible to whoever could see it before.
  const canOpen = me.role !== "team_member";
  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-faint">
          {canOpen ? <Link href={`/runs/${r.ask_seq}`} className="font-medium text-brand-text hover:underline">Question #{r.ask_seq}</Link>
            : <>Question <Mono>#{r.ask_seq}</Mono></>}
          {" · "}asked by {r.asked_by.name} · {formatTime(r.recorded_at)}{r.test && " · test run"}
        </p>
        <Pill tone={r.status === "waiting" ? "wait" : "ok"}>For {r.team.name}</Pill>
      </div>
      <p className="text-[17px] leading-relaxed text-strong">&ldquo;{r.question}&rdquo;</p>
      {r.answer ? (
        <div className="rounded-xl bg-page p-4">
          <p className="text-sm font-semibold text-strong">{r.answer.by.name} answered · {formatTime(r.answer.recorded_at)}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-body">{r.answer.text}</p>
          <p className="mt-2 text-xs text-faint">Recorded as audit #{r.answer.seq}. A person&apos;s statement, not an approved document.</p>
        </div>
      ) : r.can_answer ? (
        <AnswerTeamForm requestSeq={r.seq} />
      ) : (
        <p className="text-sm text-muted">
          Only a member of {r.team.name} can answer{members.length ? `: switch to ${members.join(" or ")} in the left menu to respond` : ""}.
        </p>
      )}
    </article>
  );
}
