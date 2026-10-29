import Link from "next/link";
import { Suspense } from "react";

import { DocRefLink, ErrorNote, PageHeader, Pill, Skeleton, Stat } from "@/components/ui";
import { getControls, settle, type ControlRow, type ControlStatus } from "@/lib/api";

export default function ControlsPage() {
  return (
    <>
      <PageHeader eyebrow="Controls and validation" title="Regulatory requirements and how the system meets them.">
        Regulations and guidelines against the company procedures and the system controls that meet them. Every clause
        links to the exact section in the document library, checked when this page loads. Gaps are listed at the top.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={6} />}>
        <Coverage />
      </Suspense>
    </>
  );
}

const STATUS: Record<ControlStatus, { label: string; tone: "ok" | "wait" | "fail" | "info" }> = {
  covered: { label: "Covered", tone: "ok" },
  partial: { label: "Partly covered", tone: "wait" },
  gap: { label: "Gap", tone: "fail" },
  by_design: { label: "Addressed by design", tone: "info" },
};
const ISSUERS: [ControlRow["issuer"], string][] = [
  ["EU", "EU GMP: Annex 11 and draft Annex 22"],
  ["ICH", "ICH guidelines"],
  ["FDA", "US FDA: 21 CFR Part 11"],
];

async function Coverage() {
  const res = await settle(getControls());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { rows, counts } = res.data;
  const gaps = rows.filter((r) => r.status === "gap");

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={counts.covered} label="Covered" caption="a procedure or control, with evidence" tone="ok" />
        <Stat value={counts.partial} label="Partly covered" caption="evidence exists, something is missing" tone={counts.partial ? "wait" : undefined} />
        <Stat value={counts.gap} label="Gaps" caption="not met by the demo" tone={counts.gap ? "fail" : undefined} />
        <Stat value={counts.by_design} label="Addressed by design" caption="met differently, explained" />
      </div>
      {gaps.length > 0 && (
        <div className="rounded-card border border-fail/30 bg-fail-bg/60 p-4 text-sm text-fail-text">
          <p className="font-semibold">{gaps.length} requirements have no control in this demo:</p>
          <ul className="mt-1 list-disc pl-5">{gaps.map((g) => <li key={g.reg.label}>{g.reg.label}: {g.note}</li>)}</ul>
        </div>
      )}
      {ISSUERS.map(([issuer, heading]) => (
        <section key={issuer} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{heading}</h2>
          <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-line-soft text-xs uppercase tracking-wide text-faint">
                <tr><th className="px-4 py-2.5">Requirement</th><th className="px-4">Company procedure</th>
                  <th className="px-4">System control</th><th className="px-4">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-line-soft align-top">
                {rows.filter((r) => r.issuer === issuer).map((r) => (
                  <tr key={r.reg.label}>
                    <td className="w-[30%] px-4 py-3">
                      <DocRefLink r={r.reg} />
                      <p className="text-muted">{r.requirement}</p>
                    </td>
                    <td className="px-4 py-3">
                      {r.company.length ? r.company.map((c) => <p key={c.label}><DocRefLink r={c} /></p>)
                        : <span className="text-faint">None</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.system.length ? <ul className="list-disc pl-4 text-body">{r.system.map((s) => <li key={s}>{s}</li>)}</ul>
                        : <span className="text-faint">None</span>}
                      {r.evidence && <Link href={r.evidence[1]} className="mt-1 inline-block text-xs font-medium text-brand-text hover:underline">Evidence: {r.evidence[0]} →</Link>}
                    </td>
                    <td className="w-[22%] px-4 py-3">
                      <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                      {r.note && <p className="mt-1.5 text-xs leading-snug text-muted">{r.note}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="text-xs text-faint">
        Assessed by the build team for this demo, not by QA. Draft Annex 22 is a consultation draft and may change.
      </p>
    </>
  );
}
