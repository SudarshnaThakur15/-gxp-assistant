import Link from "next/link";
import { Suspense } from "react";

import { PrintButton } from "@/components/print-button";
import { CitationChip, ErrorNote, formatTime, Mono, Skeleton } from "@/components/ui";
import { getRun, settle, verifyAudit } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function EvidencePage(props: PageProps<"/runs/[seq]/evidence">) {
  return (
    <Suspense fallback={<Skeleton lines={6} />}>
      <Pack params={props.params} />
    </Suspense>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 break-inside-avoid border-t border-zinc-200 pt-4">
      <h2 className="text-lg font-semibold text-zinc-900">{n}. {title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-900">{children}</dd>
    </div>
  );
}

async function Pack({ params }: { params: PageProps<"/runs/[seq]/evidence">["params"] }) {
  const seq = Number((await params).seq);
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  const [res, chain] = await Promise.all([
    Number.isInteger(seq) ? settle(getRun(me.id, seq)) : Promise.resolve(null),
    settle(verifyAudit()),
  ]);
  if (!res?.data) return <ErrorNote>No run #{seq} is visible to {me.name}.</ErrorNote>;
  const run = res.data;
  const generatedAt = new Date().toISOString();
  const llm = run.trace.find((g) => g.gate === "Generate")?.llm ?? run.trace.find((g) => g.gate === "Screen")?.llm;
  const prompts = run.trace.filter((g) => g.prompt).map((g) => `${g.gate}: ${g.prompt?.version}`).join(" · ");

  return (
    <article className="mx-auto flex w-full max-w-4xl flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Inspection evidence pack</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Run #{run.seq}: {run.question}</h1>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link href={`/runs/${run.seq}`} className="rounded-lg px-3 py-1.5 text-sm text-zinc-700 ring-1 ring-inset ring-zinc-300">← Back to run</Link>
          <PrintButton />
        </div>
      </div>
      <div className="flex flex-col gap-1 text-xs text-zinc-600">
        <p>Generated {formatTime(generatedAt)} for {me.name}, assembled from the live audit trail, not from a template.</p>
        <p>
          Audit chain at generation time:{" "}
          {chain.data
            ? chain.data.ok ? `intact, ${chain.data.entries} entries verified.` : `BROKEN at entry #${chain.data.broken_at}: ${chain.data.reason}`
            : "could not be verified."}
        </p>
        <p>Demo: fictional documents, organisation and people. Not a validated system.</p>
      </div>

      <Section n={1} title="The request and its outcome">
        <dl className="flex flex-col gap-1.5">
          <Row label="Question">{run.question}</Row>
          <Row label="Asked by">{run.requested_by.name} (<Mono>{run.requested_by.id}</Mono>), {formatTime(run.recorded_at)}</Row>
          <Row label="Outcome">{run.label}</Row>
          <Row label="Tier">{run.tier}</Row>
          {run.error && <Row label="Failure">{run.error} (the request failed safely: nothing was released)</Row>}
        </dl>
      </Section>

      <Section n={2} title="AI involvement and the rules applied">
        <dl className="flex flex-col gap-1.5">
          <Row label="AI model">{llm ? <><Mono>{llm.model}</Mono> via {llm.provider}</> : "Not called (decided by rules alone)"}</Row>
          <Row label="Prompts">{prompts || "None"}</Row>
          <Row label="Rule set"><Mono>{run.ruleset.version}</Mono> · fingerprint <Mono>{run.ruleset.fingerprint}</Mono></Row>
          <Row label="Reasons (rules)">{run.reasons.length ? run.reasons.join("; ") : "None: all checks passed"}</Row>
        </dl>
        {run.checks.length > 0 && (
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-zinc-500"><tr><th className="py-1 pr-2">Check</th><th className="py-1 pr-2">Rule</th><th className="py-1 pr-2">Result</th><th className="py-1">Detail</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 align-top">
              {run.checks.map((c) => (
                <tr key={c.id}>
                  <td className="py-1 pr-2"><Mono>{c.id}</Mono></td>
                  <td className="py-1 pr-2">{c.title} ({c.severity === "hard" ? "blocking" : "review"})</td>
                  <td className="py-1 pr-2">{c.status}</td>
                  <td className="py-1 text-zinc-600">{c.detail ?? "shown to QA Managers only"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section n={3} title="Controlled documents relied on">
        {run.answer?.citations?.length ? (
          <ol className="flex flex-col gap-2">
            {run.answer.citations.map((c) => (
              <li key={c.n} className="flex flex-col gap-1 text-sm">
                <p>[{c.n}] <CitationChip c={c} />{c.page != null && <span className="text-xs text-zinc-500"> page {c.page}</span>}</p>
                {c.quotes.map((q) => <blockquote key={q} className="border-l-4 border-zinc-300 bg-zinc-50 px-3 py-1.5 text-zinc-700">“{q}”</blockquote>)}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-zinc-600">
            {run.outcome === "held" ? "Withheld until a QA Manager signs it." : "No document was quoted in a released answer."}
          </p>
        )}
        {run.answer && (
          <div className="mt-2 rounded-lg bg-zinc-50 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {run.answer.withheld ? "Withheld draft (QA Managers only)" : "Answer as released"}
            </p>
            <p className="text-zinc-900">{run.answer.text}</p>
          </div>
        )}
      </Section>

      <Section n={4} title="Signature">
        {run.review ? (
          <dl className="flex flex-col gap-1.5">
            <Row label="Signature">{run.review.signature}</Row>
            {run.review.reason && <Row label="Reason">{run.review.reason}</Row>}
            <Row label="Signed content">SHA-256 <Mono>{run.review.content_hash}</Mono></Row>
          </dl>
        ) : (
          <p className="text-sm text-zinc-600">
            {run.outcome === "held" ? "Not yet signed: waiting for a QA Manager." : "No signature required: decided by the rules."}
          </p>
        )}
      </Section>

      <Section n={5} title="Audit trail entries for this run">
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500"><tr><th className="py-1 pr-2">#</th><th className="py-1 pr-2">Time (UTC)</th><th className="py-1 pr-2">Who</th><th className="py-1 pr-2">Event</th><th className="py-1">Hash</th></tr></thead>
          <tbody className="divide-y divide-zinc-100 align-top">
            {run.history.map((h) => (
              <tr key={h.seq}>
                <td className="py-1 pr-2"><Mono>{h.seq}</Mono></td>
                <td className="whitespace-nowrap py-1 pr-2">{formatTime(h.recorded_at)}</td>
                <td className="py-1 pr-2"><Mono>{h.actor}</Mono></td>
                <td className="py-1 pr-2">{h.text}</td>
                <td className="py-1"><Mono>{h.hash.slice(0, 16)}…</Mono></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </article>
  );
}
