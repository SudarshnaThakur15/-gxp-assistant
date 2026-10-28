import { Suspense } from "react";

import { refreshPage } from "@/app/actions";
import { ByBadge, Card, ErrorNote, Mono, PageHeader, Skeleton } from "@/components/ui";
import { getAssurance, getLab, settle, type LabCase } from "@/lib/api";

export default function AssurancePage() {
  return (
    <>
      <PageHeader eyebrow="Assurance layer" title="The AI proposes. Fixed, tested rules decide.">
        Everything on this page is plain code with no AI inside: the same input always gives the same result, so it can
        be tested and validated like any other software. The counts are live from the audit trail, and the lab below
        runs deliberately bad drafts through the real rules every time this page loads.
      </PageHeader>
      <ol className="grid gap-3 md:grid-cols-4">
        {[
          ["1", "The AI drafts", "Claims, each citing one source with a word-for-word quote. No free text."],
          ["2", "Fixed rules check it", "11 checks on every claim, its quote, its source and its wording."],
          ["3", "A failure stops it", "A blocking failure refuses the answer; a review failure holds it for QA."],
          ["4", "The result is recorded", "In the hash-chained audit trail, before anything is shown."],
        ].map(([n, title, text]) => (
          <li key={n} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-zinc-400">Step {n}</p>
            <p className="font-semibold text-zinc-900">{title}</p>
            <p className="text-sm text-zinc-600">{text}</p>
          </li>
        ))}
      </ol>
      <Suspense fallback={<Skeleton lines={4} />}>
        <Rules />
      </Suspense>
      <Suspense fallback={<Skeleton lines={4} />}>
        <LabSection />
      </Suspense>
    </>
  );
}

function SeverityTag({ severity }: { severity: "hard" | "review" }) {
  return (
    <span className={`rounded px-1.5 text-[0.7rem] font-medium uppercase tracking-wide ${
      severity === "hard" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
      {severity === "hard" ? "blocking: refuse" : "review: hold"}
    </span>
  );
}

async function Rules() {
  const res = await settle(getAssurance());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { ruleset, screen_rules, checks, tier_rules, stats } = res.data;
  const c = stats.counts;
  const tiles: [number | string, string][] = [
    [c.runs ?? 0, "questions recorded"],
    [c.screen_refused_rules ?? 0, "refused by a screening rule, before any AI call"],
    [c.validated ?? 0, "AI drafts checked by the 11 rules"],
    [c.stopped_by_checks ?? 0, "drafts refused by a blocking check"],
    [c.decision_held_for_review ?? 0, "answers held for a QA signature"],
    [stats.audit.ok ? "Intact" : "Broken", `audit trail, ${stats.audit.entries} entries verified now`],
  ];

  return (
    <>
      <Card title="Rule set" aside={<ByBadge by="rules" />}>
        <p className="text-sm text-zinc-800">
          Version <Mono className="font-semibold">{ruleset.version}</Mono> · fingerprint <Mono>{ruleset.fingerprint}</Mono>
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          The fingerprint is a SHA-256 of every pattern, threshold, check and severity. If anyone changes a rule, it
          changes, even if they forget to change the version. Every recorded run stores both, so any answer can be replayed
          against the exact rules that produced it.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([value, label]) => (
          <div key={label} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-2xl font-bold tracking-tight text-zinc-900">{value}</p>
            <p className="text-xs text-zinc-500">{label}</p>
          </div>
        ))}
      </div>
      <p className="-mt-3 text-xs text-zinc-500">
        Live from the audit trail. Runs by rule-set version:{" "}
        {Object.entries(stats.rulesets).map(([v, n]) => `${v} (${n})`).join(", ")}. Older runs were checked by the
        rules in force at the time.
      </p>

      <Card title="Gate 4: the 11 checks on every AI draft">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr><th className="py-2 pr-3 font-medium">Check</th><th className="py-2 pr-3 font-medium">What it guarantees</th>
                <th className="py-2 pr-3 font-medium">If it fails</th><th className="py-2 font-medium">Failures recorded</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 align-top">
              {checks.map((ch) => (
                <tr key={ch.id}>
                  <td className="py-2 pr-3"><Mono className="font-semibold">{ch.id}</Mono></td>
                  <td className="py-2 pr-3"><p className="text-zinc-900">{ch.title}</p><p className="text-xs text-zinc-500">{ch.note}</p></td>
                  <td className="py-2 pr-3"><SeverityTag severity={ch.severity} /></td>
                  <td className="py-2 text-zinc-700">{stats.failed_checks[ch.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Gate 1: screening rules (before any AI call)">
          <ul className="divide-y divide-zinc-100">
            {screen_rules.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <p><Mono className="font-semibold">{r.id}</Mono> <span className="text-zinc-900">{r.title}</span></p>
                <p className="text-xs text-zinc-500">{r.note}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Gate 5: tier rules (never the AI's confidence)">
          <ul className="divide-y divide-zinc-100">
            {tier_rules.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <p><Mono className="font-semibold">{r.id}</Mono> <span className="text-zinc-900">{r.rule}</span></p>
                <p className="text-xs text-zinc-500">→ {r.outcome}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

const OUTCOME_TEXT: Record<string, string> = {
  refused: "Refused", held_for_review: "Held for review", released: "Released by rules", "not refused": "Allowed through",
};

async function LabSection() {
  const res = await settle(getLab());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const lab = res.data;
  const allGood = lab.passed === lab.total;

  return (
    <Card
      title="Assurance lab: bad drafts, run live through the rules"
      aside={
        <form action={refreshPage}>
          <button className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">Run every case again</button>
        </form>
      }
    >
      <p className={`mb-3 rounded-xl px-4 py-2 text-sm font-medium ${allGood ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
        {lab.passed} of {lab.total} handled as expected, against rule set <Mono>{lab.ruleset_version}</Mono>, just now.
      </p>
      <p className="mb-3 text-xs text-zinc-500">
        Each case is a fake AI draft or question with a known flaw, built on fixed test passages modelled on the
        documents. No AI is called, so the lab costs nothing and gives the same result every time. The same cases run
        in the automated tests.
      </p>
      <ul className="flex flex-col gap-3">
        {lab.cases.map((c) => <LabRow key={c.id} c={c} />)}
      </ul>
    </Card>
  );
}

function LabRow({ c }: { c: LabCase }) {
  return (
    <li className="rounded-xl border border-zinc-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={c.as_expected ? "font-bold text-emerald-700" : "font-bold text-rose-700"}>{c.as_expected ? "✓" : "✕"}</span>
        <Mono className="font-semibold">{c.id}</Mono>
        <span className="font-medium text-zinc-900">{c.name}</span>
        <span className="text-xs text-zinc-500">{c.kind}</span>
      </div>
      <div className="mt-1 flex flex-col gap-1 pl-6 text-xs text-zinc-600">
        <p>Question: “{c.question}”</p>
        {c.claims.map((cl, i) => (
          <p key={i}>Draft claim: “{cl.text}” · quote “{cl.quote}” from <Mono>{cl.source}</Mono></p>
        ))}
        <p>
          Expected <span className="font-medium text-zinc-800">{OUTCOME_TEXT[c.expected] ?? c.expected}</span>
          {c.expected_trigger && <> by <Mono>{c.expected_trigger}</Mono></>} · got{" "}
          <span className="font-medium text-zinc-800">{OUTCOME_TEXT[c.actual] ?? c.actual}</span>
          {c.triggered.length > 0 && <> · rules that fired: <Mono>{c.triggered.join(", ")}</Mono></>}
        </p>
        {c.notices.map((n) => <p key={n} className="text-sky-800">Label added by rule: “{n}”</p>)}
      </div>
    </li>
  );
}
