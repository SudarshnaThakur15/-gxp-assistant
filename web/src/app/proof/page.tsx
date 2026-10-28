import { Suspense } from "react";

import { RoiCalculator } from "@/components/roi-calculator";
import { Card, EmptyState, ErrorNote, formatTime, Mono, PageHeader, RunLink, Skeleton } from "@/components/ui";
import { getAssurance, getProof, settle } from "@/lib/api";

export default function ProofPage() {
  return (
    <>
      <PageHeader eyebrow="Proof and value" title="Measured against questions with known right answers.">
        A fixed set of 21 realistic questions, each with the outcome it should get, decided before the system was
        tuned. Holdout questions were never used for tuning; any that were looked at while fixing something are marked
        as contaminated and reported separately.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={4} />}>
        <Evaluation />
      </Suspense>
      <Suspense fallback={<Skeleton lines={3} />}>
        <Value />
      </Suspense>
    </>
  );
}

const D: Record<string, string> = { released: "Released", held_for_review: "Held", refused: "Refused" };
const ORDER = ["released", "held_for_review", "refused"] as const;

async function Evaluation() {
  const res = await settle(getProof());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const p = res.data;
  if (!p.available) {
    return (
      <EmptyState>
        No evaluation has been saved for the current rules yet. It runs the 21 questions through the real AI
        (about 60,000 tokens): <Mono>uv run python -m app.answer_eval --save</Mono>
      </EmptyState>
    );
  }
  const tiles: [string | number, string][] = [
    [p.rates.overall, "questions passing every expectation"],
    [p.rates.clean_holdout, "clean holdout (never used for tuning)"],
    [p.rates.contaminated_holdout, "contaminated holdout (reported apart)"],
    [p.unsafe_releases, "unsafe releases: should be 0"],
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([value, label]) => (
          <div key={label} className={`rounded-2xl border bg-white p-4 shadow-sm ${
            label.startsWith("unsafe") && Number(value) > 0 ? "border-rose-300" : "border-zinc-200"}`}>
            <p className="text-2xl font-bold tracking-tight text-zinc-900">{value}</p>
            <p className="text-xs text-zinc-500">{label}</p>
          </div>
        ))}
      </div>
      <p className="-mt-3 text-xs text-zinc-500">
        Run {formatTime(p.recorded_at)} · rules <Mono>{p.ruleset.version}</Mono> · AI <Mono>{p.model}</Mono>
        {p.runs > 1 && ` · ${p.runs} runs, answers that changed between runs: ${p.flaky.join(", ") || "none"}`}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title="Expected outcome vs what the system did">
          <table className="w-full text-center text-sm">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="py-2 text-left font-medium">Expected ↓ · got →</th>
                {ORDER.map((a) => <th key={a} className="py-2 font-medium">{D[a]}</th>)}
              </tr>
            </thead>
            <tbody>
              {ORDER.map((e, i) => (
                <tr key={e}>
                  <th className="py-2 text-left text-xs font-medium text-zinc-500">{D[e]}</th>
                  {ORDER.map((a, j) => {
                    const n = p.matrix[e][a];
                    const tone = i === j ? "bg-emerald-50 text-emerald-900" : j < i ? (n ? "bg-rose-100 text-rose-900" : "bg-rose-50/40 text-zinc-400") : (n ? "bg-amber-50 text-amber-900" : "text-zinc-400");
                    return <td key={a} className={`rounded-lg py-2 font-semibold ${tone}`}>{n}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-zinc-500">
            Green: as expected. Amber, above the diagonal: stricter than needed (over-cautious: a person checks
            something that could have been released). Red, below the diagonal: less strict than expected, the error
            that matters. A released answer that should have been held or refused is an unsafe release.
          </p>
        </Card>
        <Card title="Every question">
          <ul className="divide-y divide-zinc-100">
            {p.results.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={r.pass ? "font-bold text-emerald-700" : "font-bold text-rose-700"}>{r.pass ? "✓" : "✕"}</span>
                  <Mono className="font-semibold">{r.id}</Mono>
                  <span className="text-xs text-zinc-500">{r.split}{r.contaminated && " · contaminated"}</span>
                  <RunLink seq={r.audit_seq}>{r.question}</RunLink>
                </div>
                <p className="pl-6 text-xs text-zinc-600">
                  Expected {D[r.expected]} · got {D[r.actual]}{r.failures.length > 0 && ` · ${r.failures.join("; ")}`}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

async function Value() {
  const res = await settle(getAssurance());
  const c = res.data?.stats.counts ?? {};
  const runs = c.runs || 1;
  return (
    <Card title="What it could be worth: an adjustable model">
      <RoiCalculator
        releasedShare={Math.round(((c.decision_released ?? 0) / runs) * 100)}
        heldShare={Math.round(((c.decision_held_for_review ?? 0) / runs) * 100)}
      />
    </Card>
  );
}
