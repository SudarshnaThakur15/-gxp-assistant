import Link from "next/link";
import { Suspense } from "react";

import { Card, DocRefLink, ErrorNote, Mono, PageHeader, Quote, Skeleton, Stat } from "@/components/ui";
import { getQ9, settle, type Outcome } from "@/lib/api";
import { STATUS } from "@/lib/plain";

export default function Q9Page() {
  return (
    <>
      <PageHeader eyebrow="ICH Q9 alignment" title="How the assistant applies ICH Q9.">
        How the assistant applies the principles of ICH Q9(R1) Quality Risk Management. Every quote below is checked
        against the guideline in the document library when this page loads, and the counts are live from the audit trail.
      </PageHeader>
      <div className="rounded-card border border-line bg-white p-4 text-sm leading-relaxed text-body shadow-card">
        <span className="font-semibold text-strong">What this page is, and is not.</span> A map of how the assistant&apos;s
        fixed rules apply ICH Q9(R1), built from the rules it actually runs. It is not a compliance claim: QA would
        confirm it as part of validating the system for its intended use.
      </div>
      <Suspense fallback={<Skeleton lines={6} />}>
        <Alignment />
      </Suspense>
    </>
  );
}

const SHOWN: Outcome[] = ["released", "not_found", "held", "approved", "rejected", "refused"];

async function Alignment() {
  const res = await settle(getQ9());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { principles, tiers, tier_rules, grid, off_route } = res.data;
  const total = (tier: string) => SHOWN.reduce((n, o) => n + (grid[tier]?.[o] ?? 0), 0);
  const all = tiers.reduce((n, t) => n + total(t.tier), 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={all} label="Questions routed" caption="by tier, excluding test runs" />
        <Stat value={grid.T1?.released ?? 0} label="Tier 1: answered straight away" caption="with sources, every check passed" tone="ok" />
        <Stat value={(grid.T2?.held ?? 0) + (grid.T2?.approved ?? 0) + (grid.T2?.rejected ?? 0)} label="Tier 2: a person signs"
          caption="held for a QA Manager's e-signature" tone={grid.T2?.held ? "wait" : undefined} />
        <Stat value={off_route} label="Sent the wrong way" caption="shown although a person had to check it" tone={off_route ? "fail" : "ok"} />
      </div>

      <Card title="The principles, and how the assistant applies them">
        <ol className="flex flex-col divide-y divide-line-soft">
          {principles.map((p, i) => (
            <li key={i} className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <DocRefLink r={p.ref} />
                {p.ref.quote && p.ref.resolved && <Quote>{p.ref.quote}</Quote>}
              </div>
              <p className="text-[15px] leading-relaxed text-body">{p.how}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="One scale: the consequence tier">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-faint">
              <tr><th className="py-2 pr-4">Tier</th><th className="pr-4">Risk</th><th className="pr-4">What it covers</th>
                <th className="pr-4">Formality</th><th className="pr-4">Who has to look</th><th className="pr-4">Route</th><th>Now</th></tr>
            </thead>
            <tbody className="divide-y divide-line-soft align-top">
              {tiers.map((t) => (
                <tr key={t.tier}>
                  <td className="py-3 pr-4"><span className="rounded-md bg-ink px-2 py-1 font-mono text-xs font-semibold text-white">{t.tier}</span></td>
                  <td className="py-3 pr-4 font-semibold text-strong">{t.risk}</td>
                  <td className="py-3 pr-4 text-body">{t.what}</td>
                  <td className="py-3 pr-4 text-body">{t.formality}</td>
                  <td className="py-3 pr-4 text-body">{t.who}</td>
                  <td className="py-3 pr-4 text-body">{t.route}</td>
                  <td className="py-3 font-semibold text-strong">{total(t.tier)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Where every question ended up">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-center text-sm">
              <thead className="text-xs text-faint">
                <tr><th className="py-2 text-left">Tier</th>{SHOWN.map((o) => <th key={o} className="px-1 font-medium">{STATUS[o].title.split(" ").slice(0, 3).join(" ")}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {tiers.map((t) => (
                  <tr key={t.tier}>
                    <td className="py-2.5 text-left"><Mono className="font-semibold">{t.tier}</Mono></td>
                    {SHOWN.map((o) => {
                      const n = grid[t.tier]?.[o] ?? 0;
                      return <td key={o} className={n ? "font-semibold text-strong" : "text-faint"}>{n || "·"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-faint">
            Tier 2 answers that were &ldquo;not found&rdquo; had nothing to sign. A refusal at tier 1 or 2 means a blocking
            check stopped the draft. Open any of them under <Link href="/runs" className="text-brand-text hover:underline">questions</Link>.
          </p>
        </Card>
        <Card title="How the tier is set (never from the AI's confidence)">
          <ul className="divide-y divide-line-soft">
            {tier_rules.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <p><Mono className="font-semibold">{r.id}</Mono> <span className="text-strong">{r.rule}</span></p>
                <p className="text-xs text-faint">{r.outcome}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
