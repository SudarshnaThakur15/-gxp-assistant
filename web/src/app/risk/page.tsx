import Link from "next/link";
import { Suspense } from "react";

import { ErrorNote, Mono, PageHeader, Skeleton, Stat } from "@/components/ui";
import { getPlatformRisk, settle } from "@/lib/api";

export default function RiskPage() {
  return (
    <>
      <PageHeader eyebrow="Platform risk (FMEA)" title="Risk assessment of the assistant itself.">
        A failure mode and effects analysis of the assistant itself, following ICH Q9(R1). Each risk is scored for
        severity, occurrence and detection from 1 to 5; the risk priority number (RPN) is their product. Severity never
        changes. A risk comes down only through a named measure, and measures that are rules show how often they have
        caught something.
      </PageHeader>
      <div className="rounded-card border border-wait/40 bg-wait-bg/50 p-4 text-sm leading-relaxed text-body">
        <span className="font-semibold text-strong">Status: draft for QA review.</span> Scored by the build team on
        29 October 2026. In production, accepting the residual risk would be an electronic signature by the Head of
        Quality Assurance; nobody has accepted it yet.
      </div>
      <Suspense fallback={<Skeleton lines={6} />}>
        <Register />
      </Suspense>
    </>
  );
}

function Rpn({ value }: { value: number }) {
  const cls = value >= 40 ? "bg-fail-bg text-fail-text" : value >= 15 ? "bg-wait-bg text-wait-text" : "bg-ok-bg text-ok-text";
  return <span className={`inline-block min-w-9 rounded-md px-1.5 py-0.5 text-center font-mono text-xs font-semibold ${cls}`}>{value}</span>;
}

async function Register() {
  const res = await settle(getPlatformRisk());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { id, risks } = res.data;
  const top = [...risks].sort((a, b) => b.after.rpn - a.after.rpn)[0];
  const high = risks.filter((r) => r.before.rpn >= 40).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={risks.length} label="Failure modes" caption={`risk assessment ${id}`} />
        <Stat value={high} label="High before measures" caption="RPN 40 or more" tone={high ? "wait" : undefined} />
        <Stat value={risks.filter((r) => r.after.rpn >= 40).length} label="High after measures" caption="RPN 40 or more" tone="ok" />
        <Stat value={top.after.rpn} label="Highest residual" caption={`${top.id}: ${top.failure}`} />
      </div>
      <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-line-soft text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="px-4 py-2.5">#</th><th className="px-2">Failure mode and effect</th><th className="px-2 text-center">S</th>
              <th className="px-2 text-center">Before<br /><span className="normal-case">O × D → RPN</span></th>
              <th className="px-2">Measures</th>
              <th className="px-4 text-center">After<br /><span className="normal-case">O × D → RPN</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft align-top">
            {risks.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3"><Mono className="font-semibold">{r.id}</Mono></td>
                <td className="w-[28%] px-2 py-3">
                  <p className="text-xs text-faint">{r.component}</p>
                  <p className="font-medium text-strong">{r.failure}</p>
                  <p className="text-muted">Effect: {r.effect}</p>
                </td>
                <td className="px-2 py-3 text-center font-semibold">{r.severity}</td>
                <td className="whitespace-nowrap px-2 py-3 text-center">{r.before.o} × {r.before.d} → <Rpn value={r.before.rpn} /></td>
                <td className="px-2 py-3">
                  <ul className="flex flex-col gap-1">
                    {r.measures.map((m) => (
                      <li key={m.title} className="leading-snug">
                        {m.rule ? (
                          <><Link href="/assurance" className="font-mono text-xs font-semibold text-brand-text hover:underline">{m.rule}</Link>{" "}
                            <span className="text-body">{m.title}</span>
                            {m.caught ? <span className="text-xs text-faint"> · caught {m.caught}×</span> : null}</>
                        ) : <span className="text-body">{m.title}</span>}
                      </li>
                    ))}
                  </ul>
                  {r.note && <p className="mt-1.5 text-xs text-wait-text">{r.note}</p>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-center">{r.after.o} × {r.after.d} → <Rpn value={r.after.rpn} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-faint">
        RPN bands: 40 or more high, 15 to 39 medium, below 15 low. &ldquo;Caught&rdquo; counts every recorded question,
        including automated test runs, in which that rule stopped or held something.
      </p>
    </>
  );
}
