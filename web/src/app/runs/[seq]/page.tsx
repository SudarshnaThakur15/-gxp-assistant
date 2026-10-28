import Link from "next/link";
import { Suspense } from "react";

import { SignForm } from "@/components/sign-form";
import {
  ByBadge, Card, CheckList, CitationChip, Citations, ErrorNote, formatTime, Mono, OutcomePill, PageHeader, Skeleton, TierChip,
} from "@/components/ui";
import { getRun, settle, type Gate, type RunDetail } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function RunPage(props: PageProps<"/runs/[seq]">) {
  return (
    <>
      <Link href="/runs" className="text-sm text-zinc-600 hover:underline">← Question runs</Link>
      <Suspense fallback={<Skeleton lines={5} />}>
        <Run params={props.params} />
      </Suspense>
    </>
  );
}

const HELD_MESSAGE = "Held for review. This answer must be reviewed and electronically signed by a QA Manager before it can be used.";

async function Run({ params }: { params: PageProps<"/runs/[seq]">["params"] }) {
  const seq = Number((await params).seq);
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  const res = Number.isInteger(seq) ? await settle(getRun(me.id, seq)) : null;
  if (!res?.data) {
    return <ErrorNote>No run #{(await params).seq} is visible to {me.name}. Runs are visible to the person who asked and to QA Managers who cover their programme.</ErrorNote>;
  }
  const run = res.data;

  return (
    <>
      <PageHeader eyebrow={`Run #${run.seq} · asked by ${run.requested_by.name} · ${formatTime(run.recorded_at)}`} title={run.question} />
      <div className="flex flex-wrap items-center gap-2">
        <OutcomePill outcome={run.outcome} label={run.label} />
        <TierChip tier={run.tier} />
        <span className="text-xs text-zinc-500">
          Rules <Mono>{run.ruleset.version}</Mono> · AI <Mono>{run.model ?? "not called"}</Mono>
        </span>
        <Link href={`/runs/${run.seq}/evidence`}
          className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-800 ring-1 ring-inset ring-zinc-300 hover:bg-white">
          Inspection evidence pack ↗
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <AnswerCard run={run} />
          <ReasonsCard run={run} />
          <Card title="Checked by the Assurance Layer"
            aside={<ByBadge by="rules" />}>
            {run.checks.length === 0 ? (
              <p className="text-sm text-zinc-500">No checks ran: the request was refused or failed before an answer was drafted.</p>
            ) : (
              <CheckList checks={run.checks} />
            )}
            <p className="mt-3 text-xs text-zinc-500">
              Rule set <Mono>{run.ruleset.version}</Mono> · fingerprint <Mono>{run.ruleset.fingerprint.slice(0, 12)}</Mono>.
              The fingerprint changes if any rule changes.
              {run.checks.some((c) => c.detail === null) && " Details quote the withheld draft, so only a QA Manager sees them."}
            </p>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <DecisionCard run={run} signerName={me.name} />
          <Card title="The 7 gates, as they ran">
            <ol className="flex flex-col gap-3">
              {run.trace.map((g) => <GateRow key={g.n} gate={g} />)}
            </ol>
          </Card>
          <Card title="History">
            <ol className="flex flex-col gap-3 border-l-2 border-zinc-200 pl-4">
              {run.history.map((h) => (
                <li key={h.seq} className="text-sm">
                  <p className="text-xs text-zinc-500">
                    <Mono>#{h.seq}</Mono> · {formatTime(h.recorded_at)} · {h.actor} · <Mono>{h.hash.slice(0, 10)}…</Mono>
                  </p>
                  <p className="text-zinc-800">{h.text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-zinc-500">Every step above is a record in the tamper-evident audit trail.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function AnswerCard({ run }: { run: RunDetail }) {
  const a = run.answer;
  const title = a?.withheld ? "Withheld draft (visible to QA Managers only)" : `What ${run.requested_by.name} sees`;
  return (
    <Card title={title} aside={a && !a.withheld && run.outcome === "approved" ? <span className="text-xs text-emerald-700">Signed by QA</span> : null}>
      {a ? (
        <div className="flex flex-col gap-4">
          {a.withheld && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {run.outcome === "held"
                ? `${run.requested_by.name} sees only: “${HELD_MESSAGE}”`
                : `Rejected in QA review: ${run.requested_by.name} never received this draft.`}
            </p>
          )}
          <p className="text-sm leading-relaxed text-zinc-900">{a.text}</p>
          {a.notices?.map((n) => <p key={n} className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">{n}</p>)}
          {a.citations && a.citations.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Grounded in the controlled documents</p>
              <Citations citations={a.citations} />
              <p className="text-xs text-zinc-500">Only approved, in-force versions are quoted, and every quote was checked word for word.</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-800">
          {run.outcome === "held" && HELD_MESSAGE}
          {run.outcome === "rejected" && `Rejected in QA review. Reason: ${run.review?.reason}`}
          {run.outcome === "refused" && "Refused. Nothing was released; the reasons are below."}
        </p>
      )}
    </Card>
  );
}

function ReasonsCard({ run }: { run: RunDetail }) {
  if (run.reasons.length === 0) return null;
  const refused = run.outcome === "refused";
  return (
    <Card title={refused ? "Why it was refused" : "Why a person is involved"}>
      <ul className="list-disc pl-5 text-sm text-zinc-800">
        {run.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <p className="mt-3 text-xs text-zinc-500">
        These reasons come from fixed rules, not from the AI. The AI can add a reason for a person to look, but can never remove one.
      </p>
    </Card>
  );
}

function DecisionCard({ run, signerName }: { run: RunDetail; signerName: string }) {
  if (run.review) {
    return (
      <Card title="Electronic signature">
        <p className="text-sm text-zinc-900">{run.review.signature}</p>
        {run.review.reason && <p className="mt-1 text-sm text-zinc-700">Reason: {run.review.reason}</p>}
        <p className="mt-3 text-xs text-zinc-500">
          Audit <Mono>#{run.review.audit_seq}</Mono> · signed content <Mono>{run.review.content_hash.slice(0, 16)}…</Mono>.
          If the signed text or citations change, the answer is refused instead of released.
        </p>
      </Card>
    );
  }
  if (run.outcome !== "held") return null;
  return (
    <Card title="Decision">
      {run.can_review ? (
        <SignForm askSeq={run.seq} signerName={signerName} />
      ) : (
        <p className="text-sm text-zinc-600">
          Waiting for a QA Manager. Only a QA Manager who covers this programme can approve or reject it, and never their
          own question. Switch persona to Jordan Lee to sign.
        </p>
      )}
    </Card>
  );
}

function GateRow({ gate: g }: { gate: Gate }) {
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-zinc-900">{g.n} {g.gate}</span>
        <ByBadge by={g.by} model={g.llm?.model} />
        <span className="text-xs font-medium text-zinc-700">{g.result}</span>
      </div>
      <GateDetail gate={g} />
    </li>
  );
}

function GateDetail({ gate: g }: { gate: Gate }) {
  const small = "text-xs text-zinc-600";
  switch (g.gate) {
    case "Screen":
      return (
        <div className={small}>
          {g.rules && g.rules.length > 0 && <p>Rules fired: {g.rules.map((r) => `${r.rule} ${r.title}`).join("; ")}</p>}
          {g.ai_intent && <p>AI classified it as <Mono>{g.ai_intent}</Mono>: {g.ai_reason}</p>}
          {g.llm && <p>{g.llm.input_tokens} in / {g.llm.output_tokens} out tokens · prompt <Mono>{g.prompt?.version}</Mono></p>}
        </div>
      );
    case "Retrieve":
      return (
        <div className={small}>
          {g.passages && g.passages.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {g.passages.map((p, i) => (
                <li key={i}>
                  <CitationChip c={p} /> · score {p.score.toFixed(3)}
                  {p.injection_flagged && <span className="ml-1 text-rose-700">· contains text addressed to AI, treated as data</span>}
                </li>
              ))}
            </ul>
          )}
          {g.excluded?.map((x, i) => <p key={i} className="text-amber-800">Excluded: {x.reason}</p>)}
          {g.best_similarity != null && <p>Best similarity {g.best_similarity.toFixed(2)} (below 0.70 means “not found”)</p>}
        </div>
      );
    case "Generate":
      return g.llm ? (
        <p className={small}>
          {g.claims} claim(s) drafted · {g.llm.input_tokens} in / {g.llm.output_tokens} out tokens · prompt <Mono>{g.prompt?.version}</Mono>
        </p>
      ) : null;
    case "Validate":
      return g.summary ? (
        <p className={small}>
          {g.summary.checks} checks · {g.summary.failed.length ? `failed: ${g.summary.failed.join(", ")}` : "none failed"}
        </p>
      ) : null;
    case "Tier":
      return g.reasons && g.reasons.length > 0 ? <p className={small}>{g.reasons.length} reason(s): see “Why” above</p> : null;
    case "Record":
      return <p className={small}>Audit <Mono>#{g.audit_seq}</Mono> · <Mono>{g.audit_hash?.slice(0, 16)}…</Mono>, committed before release</p>;
    default:
      return null;
  }
}
