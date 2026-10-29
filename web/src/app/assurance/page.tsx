import { Suspense } from "react";

import { refreshPage } from "@/app/actions";
import { ByBadge, Card, ErrorNote, Mono, PageHeader, Skeleton } from "@/components/ui";
import { getAssurance, getLab, settle, type LabCase } from "@/lib/api";

export default function AssurancePage() {
  return (
    <>
      <PageHeader eyebrow="Rules and checks" title="The checks every answer has to pass.">
        Everything on this page is ordinary code, not AI. The same input always gives the same result, so it can be
        tested and validated like any other software. The counts are live from the audit trail, and the lab below
        runs deliberately bad drafts through the real rules every time this page loads.
      </PageHeader>
      <ol className="grid gap-3 md:grid-cols-4">
        {[
          ["1", "The AI drafts", "Claims, each citing one source with a word-for-word quote. No free text."],
          ["2", "The checks run", "11 checks on every claim, its quote, its source and its wording."],
          ["3", "A failure stops it", "A blocking failure refuses the answer; a review failure holds it for QA."],
          ["4", "The result is recorded", "In the hash-chained audit trail, before anything is shown."],
        ].map(([n, title, text]) => (
          <li key={n} className="rounded-card border border-line bg-white p-4 shadow-card">
            <p className="text-xs font-semibold text-faint">Step {n}</p>
            <p className="font-semibold text-strong">{title}</p>
            <p className="text-sm text-muted">{text}</p>
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
      severity === "hard" ? "bg-fail-bg text-fail-text" : "bg-wait-bg text-wait-text"}`}>
      {severity === "hard" ? "blocking: refuse" : "review: hold"}
    </span>
  );
}

async function Rules() {
  const res = await settle(getAssurance());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { ruleset, screen_rules, checks, tier_rules, pack_checks, stats } = res.data;
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
        <p className="text-sm text-strong">
          Version <Mono className="font-semibold">{ruleset.version}</Mono> · fingerprint <Mono>{ruleset.fingerprint}</Mono>
        </p>
        <p className="mt-1 text-xs text-faint">
          The fingerprint is a SHA-256 of every pattern, threshold, check and severity. If anyone changes a rule, it
          changes, even if they forget to change the version. Every recorded run stores both, so any answer can be replayed
          against the exact rules that produced it.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([value, label]) => (
          <div key={label} className="rounded-card border border-line bg-white p-4 shadow-card">
            <p className="text-2xl font-bold tracking-tight text-strong">{value}</p>
            <p className="text-xs text-faint">{label}</p>
          </div>
        ))}
      </div>
      <p className="-mt-3 text-xs text-faint">
        Live from the audit trail. Runs by rule-set version:{" "}
        {Object.entries(stats.rulesets).map(([v, n]) => `${v} (${n})`).join(", ")}. Older runs were checked by the
        rules in force at the time.
      </p>

      <Card title="The 11 checks on every draft">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-faint">
              <tr><th className="py-2 pr-3 font-medium">Check</th><th className="py-2 pr-3 font-medium">What it guarantees</th>
                <th className="py-2 pr-3 font-medium">If it fails</th><th className="py-2 font-medium">Failures recorded</th></tr>
            </thead>
            <tbody className="divide-y divide-line-soft align-top">
              {checks.map((ch) => (
                <tr key={ch.id}>
                  <td className="py-2 pr-3"><Mono className="font-semibold">{ch.id}</Mono></td>
                  <td className="py-2 pr-3"><p className="text-strong">{ch.title}</p><p className="text-xs text-faint">{ch.note}</p></td>
                  <td className="py-2 pr-3"><SeverityTag severity={ch.severity} /></td>
                  <td className="py-2 text-body">{stats.failed_checks[ch.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Requests the assistant turns down (before any AI is used)">
          <ul className="divide-y divide-line-soft">
            {screen_rules.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <p><Mono className="font-semibold">{r.id}</Mono> <span className="text-strong">{r.title}</span></p>
                <p className="text-xs text-faint">{r.note}</p>
                {r.sources && r.sources.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted">Rests on <Mono>{r.sources.join(" · ")}</Mono></p>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="When QA has to check an answer">
          <ul className="divide-y divide-line-soft">
            {tier_rules.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <p><Mono className="font-semibold">{r.id}</Mono> <span className="text-strong">{r.rule}</span></p>
                <p className="text-xs text-faint">→ {r.outcome}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Extra checks on investigation packs">
        <p className="mb-2 text-sm text-muted">
          For an open deviation the assistant may prepare a pack for the investigator, but never decide the root cause,
          the classification or the CAPA. These checks run on every pack, on top of the 11 above.
        </p>
        <ul className="divide-y divide-line-soft">
          {pack_checks.map((c) => (
            <li key={c.id} className="flex flex-col gap-0.5 py-2 text-sm">
              <p><Mono className="font-semibold">{c.id}</Mono> <span className="text-strong">{c.title}</span> <SeverityTag severity={c.severity} /></p>
              <p className="text-xs text-faint">{c.note}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

const OUTCOME_TEXT: Record<string, string> = {
  refused: "Not answered", held_for_review: "Waiting for QA", released: "Answered", "not refused": "Allowed",
};

async function LabSection() {
  const res = await settle(getLab());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const lab = res.data;
  const allGood = lab.passed === lab.total;

  return (
    <Card
      title="Test bench: deliberately wrong drafts, checked live"
      aside={
        <form action={refreshPage}>
          <button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">Run every case again</button>
        </form>
      }
    >
      <p className={`mb-3 rounded-xl px-4 py-2 text-sm font-medium ${allGood ? "bg-ok-bg text-ok-text" : "bg-fail-bg text-fail-text"}`}>
        {lab.passed} of {lab.total} handled as expected, against rule set <Mono>{lab.ruleset_version}</Mono>, just now.
      </p>
      <p className="mb-3 text-xs text-faint">
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
    <li className="rounded-xl border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={c.as_expected ? "font-bold text-ok-text" : "font-bold text-fail-text"}>{c.as_expected ? "✓" : "✕"}</span>
        <Mono className="font-semibold">{c.id}</Mono>
        <span className="font-medium text-strong">{c.name}</span>
        <span className="text-xs text-faint">{c.kind}</span>
      </div>
      <div className="mt-1 flex flex-col gap-1 pl-6 text-xs text-muted">
        <p>Question: “{c.question}”</p>
        {c.claims.map((cl, i) => (
          <p key={i}>Draft claim: “{cl.text}” · quote “{cl.quote}” from <Mono>{cl.source}</Mono></p>
        ))}
        <p>
          Expected <span className="font-medium text-strong">{OUTCOME_TEXT[c.expected] ?? c.expected}</span>
          {c.expected_trigger && <> by <Mono>{c.expected_trigger}</Mono></>} · got{" "}
          <span className="font-medium text-strong">{OUTCOME_TEXT[c.actual] ?? c.actual}</span>
          {c.triggered.length > 0 && <> · rules that fired: <Mono>{c.triggered.join(", ")}</Mono></>}
        </p>
        {c.notices.map((n) => <p key={n} className="text-brand-text">Label added by rule: “{n}”</p>)}
      </div>
    </li>
  );
}
