import Link from "next/link";

import { Tabs } from "@/components/tabs";
import { ByBadge, CheckList, CitationChip, Citations, formatTime, Mono, Pill, TONE_PILL } from "@/components/ui";
import type { Citation, Gate, RunDetail } from "@/lib/api";
import { GATE_PLAIN, plainReasons, STATUS } from "@/lib/plain";

// One answer: a plain status line and the answer first; the proof one click away in tabs.
export function AnswerCard({ run, viewerId }: { run: RunDetail; viewerId: string }) {
  const status = STATUS[run.outcome];
  const isRequester = viewerId === run.requested_by.id;
  const citations = run.answer?.citations ?? [];
  const passed = run.checks.filter((c) => c.status === "pass" || c.status === "fixed").length;
  const counted = run.checks.filter((c) => c.status !== "skip").length;

  return (
    <article className="overflow-hidden rounded-card border border-line bg-white shadow-card">
      <div className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6 ${TONE_PILL[status.tone]}`}>
        <p className="flex items-center gap-2 font-semibold">
          <span aria-hidden className="text-base">{status.icon}</span>
          {status.title}
        </p>
        <p className="text-xs opacity-80">
          Run <Mono>#{run.seq}</Mono> · {formatTime(run.recorded_at)}{run.test && " · test run"}
        </p>
      </div>
      <div className="px-5 pb-6 pt-3 sm:px-6">
        <Tabs
          items={[
            { id: "answer", label: "Answer", content: <AnswerTab run={run} isRequester={isRequester} /> },
            { id: "sources", label: "Sources", count: citations.length || run.rule_sources.length, content: <SourcesTab run={run} /> },
            { id: "checks", label: "Checks", count: counted || undefined, content: <ChecksTab run={run} passed={passed} counted={counted} /> },
            { id: "trace", label: "How it ran", content: <TraceTab run={run} /> },
            { id: "record", label: "Record", content: <RecordTab run={run} /> },
          ]}
        />
      </div>
    </article>
  );
}

function Reasons({ run, title, sources = [] }: { run: RunDetail; title: string; sources?: Citation[] }) {
  const reasons = plainReasons(run.reasons);
  if (!reasons.length) return null;
  return (
    <div className="rounded-xl bg-page p-4">
      <p className="text-sm font-semibold text-strong">{title}</p>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-body">
        {reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      {sources.length > 0 && (
        <div className="mt-4 border-t border-line-soft pt-3">
          <p className="mb-2.5 text-sm font-semibold text-strong">Where this rule comes from</p>
          <Citations citations={sources} />
        </div>
      )}
      <p className="mt-3 text-xs text-faint">
        Decided by fixed rules, not by the AI.{sources.length > 0 && " Quoted word for word from the approved versions in force."}
      </p>
    </div>
  );
}

function AnswerTab({ run, isRequester }: { run: RunDetail; isRequester: boolean }) {
  const a = run.answer;
  const citations = a?.citations ?? [];
  return (
    <div className="flex flex-col gap-4">
      {run.outcome === "held" && isRequester && (
        <p className="text-[15px] leading-relaxed text-body">
          A QA Manager must check this answer before you can use it. It will appear here as soon as it is signed.
        </p>
      )}
      {run.outcome === "rejected" && (
        <p className="text-[15px] leading-relaxed text-body">
          A QA Manager rejected the draft, so it was never released{run.review?.reason ? `. Their reason: “${run.review.reason}”` : "."}
        </p>
      )}
      {run.outcome === "refused" && (
        <p className="text-[15px] leading-relaxed text-body">
          Nothing was released. You can ask what a procedure or record says; decisions stay with the responsible people.
        </p>
      )}
      {a && (
        <div className="flex flex-col gap-3">
          {a.withheld && (
            <p className="w-fit rounded-md bg-wait-bg px-2 py-1 text-xs font-semibold text-wait-text">
              Draft · not released · visible to QA and auditors only
            </p>
          )}
          <p className="text-[17px] leading-relaxed text-strong">{a.text}</p>
          {a.notices?.map((n) => (
            <p key={n} className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-text">{n}</p>
          ))}
          {citations.length > 0 && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-faint">Sources</span>
              <ul className="flex flex-col gap-1.5">
                {citations.map((c) => (
                  <li key={c.n} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-semibold text-faint">[{c.n}]</span>
                    <CitationChip c={c} />
                    {c.title && <span className="text-muted">{c.title}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {run.review && <p className="text-sm text-muted">{run.review.signature}</p>}
      {run.outcome === "not_found" && (
        <p className="text-sm text-muted">
          Try naming the document (for example SOP-QA-012), or check that the question is about a programme you work on.
        </p>
      )}
      {run.outcome === "held" && <Reasons run={run} title="Why a person checks it first" />}
      {run.outcome === "refused" && <Reasons run={run} title="Why it can't be answered" sources={run.rule_sources} />}
    </div>
  );
}

function SourcesTab({ run }: { run: RunDetail }) {
  const citations = run.answer?.citations ?? [];
  if (citations.length) {
    return (
      <div className="flex flex-col gap-4">
        <Citations citations={citations} />
        <p className="text-xs text-faint">Only approved versions in force are quoted, and every quote was checked word for word.</p>
      </div>
    );
  }
  if (run.rule_sources.length) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-body">
          Nothing was searched: a fixed rule stopped the question first. These approved documents are what the rule rests on.
        </p>
        <Citations citations={run.rule_sources} />
      </div>
    );
  }
  return (
    <p className="text-sm text-muted">
      {run.outcome === "held" ? "The sources are shown together with the answer once QA has signed it." : "No document was quoted."}
    </p>
  );
}

function ChecksTab({ run, passed, counted }: { run: RunDetail; passed: number; counted: number }) {
  if (!run.checks.length) {
    return <p className="text-sm text-muted">No checks ran: the question was stopped before the AI drafted anything.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-body">
        <span className="font-semibold text-strong">{passed} of {counted}</span> checks passed. Every check is fixed code
        with no AI inside, rule set <Mono>{run.ruleset.version}</Mono>.
      </p>
      <CheckList checks={run.checks} />
      {run.checks.some((c) => c.detail === null) && (
        <p className="text-xs text-faint">Details quote the draft, so only QA and auditors see them until it is released.</p>
      )}
    </div>
  );
}

function TraceTab({ run }: { run: RunDetail }) {
  return (
    <ol className="relative flex flex-col gap-4 border-l-2 border-line-soft pl-5">
      {run.trace.map((g) => {
        const plain = GATE_PLAIN[g.gate];
        return (
          <li key={g.n} className="relative">
            <span className="absolute -left-[27px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
              {g.n}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-strong">{plain?.title ?? g.gate}</p>
              <ByBadge by={g.by} model={g.llm?.model} />
              <span className="text-xs text-faint">{g.result}</span>
            </div>
            <p className="text-sm text-muted">{plain?.what}</p>
            <GateDetail gate={g} />
          </li>
        );
      })}
    </ol>
  );
}

function GateDetail({ gate: g }: { gate: Gate }) {
  const small = "mt-1 text-xs text-muted";
  switch (g.gate) {
    case "Screen":
      return (
        <div className={small}>
          {g.rules && g.rules.length > 0 && <p>Rule fired: {g.rules.map((r) => `${r.rule} ${r.title}`).join("; ")}</p>}
          {g.ai_intent && <p>AI classified it as <Mono>{g.ai_intent}</Mono>{g.ai_reason && `: ${g.ai_reason}`}</p>}
        </div>
      );
    case "Retrieve":
      return (
        <div className={`${small} flex flex-col gap-1`}>
          {g.passages && g.passages.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {g.passages.map((p, i) => <CitationChip key={i} c={p} />)}
            </div>
          )}
          {g.passages?.filter((p) => p.injection_flagged).map((p, i) => (
            <p key={`inj-${i}`} className="text-fail-text">
              {p.doc} §{p.section} contains text addressed to AI systems: treated as data, never as instructions.
            </p>
          ))}
          {g.excluded?.map((x, i) => <p key={i} className="text-wait-text">Filtered out: {x.document ? `${x.document} (${x.reason})` : x.reason}</p>)}
        </div>
      );
    case "Generate":
      return g.llm ? <p className={small}>{g.claims} claim(s) · {g.llm.input_tokens} in / {g.llm.output_tokens} out tokens · prompt <Mono>{g.prompt?.version}</Mono></p> : null;
    case "Validate":
      return g.summary ? <p className={small}>{g.summary.checks} checks · {g.summary.failed.length ? `failed: ${g.summary.failed.join(", ")}` : "none failed"}</p> : null;
    case "Record":
      return <p className={small}>Audit <Mono>#{g.audit_seq}</Mono> · <Mono>{g.audit_hash?.slice(0, 16)}…</Mono></p>;
    default:
      return null;
  }
}

function RecordTab({ run }: { run: RunDetail }) {
  const rows: [string, React.ReactNode][] = [
    ["Asked by", `${run.requested_by.name}${run.test ? " (automated test account)" : ""}`],
    ["When", formatTime(run.recorded_at)],
    ["Audit entry", <span key="a"><Mono>#{run.seq}</Mono> · <Mono>{run.hash.slice(0, 24)}…</Mono></span>],
    ["Rule set", <span key="r"><Mono>{run.ruleset.version}</Mono> · <Mono>{run.ruleset.fingerprint.slice(0, 12)}</Mono></span>],
    ["AI model", run.model ? <Mono key="m">{run.model}</Mono> : "Not called: decided by rules alone"],
    ["Tier", run.tier],
  ];
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-faint">{k}</dt>
            <dd className="text-strong">{v}</dd>
          </div>
        ))}
      </dl>
      {run.review && (
        <div className="rounded-xl bg-page p-4 text-sm">
          <p className="font-semibold text-strong">Electronic signature</p>
          <p className="mt-1 text-body">{run.review.signature}</p>
          {run.review.reason && <p className="text-muted">Reason: {run.review.reason}</p>}
          <p className="mt-1 text-xs text-faint">Signed content <Mono>{run.review.content_hash.slice(0, 16)}…</Mono>: if it changes, the answer is refused.</p>
        </div>
      )}
      <div>
        <p className="mb-2 text-sm font-semibold text-strong">History</p>
        <ol className="flex flex-col gap-2.5 border-l-2 border-line-soft pl-4">
          {run.history.map((h) => (
            <li key={h.seq} className="text-sm">
              <p className="text-xs text-faint"><Mono>#{h.seq}</Mono> · {formatTime(h.recorded_at)} · <Mono>{h.hash.slice(0, 10)}…</Mono></p>
              <p className="text-body">{h.text}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/runs/${run.seq}/evidence`} className="rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white hover:bg-ink-2">
          Inspection evidence pack
        </Link>
        <Pill tone="neutral">Every step above is in the tamper-evident audit trail</Pill>
      </div>
    </div>
  );
}
