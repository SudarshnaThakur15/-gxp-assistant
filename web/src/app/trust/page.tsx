import Link from "next/link";
import { Suspense } from "react";

import { refreshPage } from "@/app/actions";
import { Card, ErrorNote, formatTime, Mono, PageHeader, RunLink, Skeleton } from "@/components/ui";
import { getTrust, settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function TrustPage() {
  return (
    <>
      <PageHeader eyebrow="Trust centre" title="What data leaves the system, and how each safeguard is checked.">
        Every safeguard below says how it is verified. The ones marked “checked live” were re-checked when this page
        loaded, inside a database transaction that is always rolled back.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={5} />}>
        <TrustContent />
      </Suspense>
    </>
  );
}

async function TrustContent() {
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const res = await settle(getTrust(persona.data.current.id));
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { counts: c, boundary: b, audit, safeguards, recent_calls } = res.data;
  const tiles: [number | string, string][] = [
    [c.ai_calls, "AI calls recorded (your runs)"],
    [c.tokens.toLocaleString("en-GB"), "tokens sent to and from the AI"],
    [c.external_services, "external service: the AI model host"],
    [c.refused + c.not_found, "refused or “not found” instead of a guess"],
    [c.held, "held for a person before use"],
    [audit.ok ? "Intact" : "Broken", `audit trail, ${audit.entries} entries`],
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([value, label]) => (
          <div key={label} className="rounded-card border border-line bg-white p-4 shadow-card">
            <p className="text-2xl font-bold tracking-tight text-strong">{value}</p>
            <p className="text-xs text-faint">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Data boundary">
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="font-medium text-strong">AI model: <Mono>{b.ai_model}</Mono> on {b.ai_provider}</dt>
              <dd className="text-muted">{b.ai_note}</dd>
            </div>
            <div>
              <dt className="font-medium text-strong">Search model: <Mono>{b.embedding_model}</Mono></dt>
              <dd className="text-muted">{b.embedding_note}</dd>
            </div>
            <div>
              <dt className="font-medium text-strong">Database: {b.database}</dt>
              <dd className="text-muted">Documents, permissions and the audit trail.</dd>
            </div>
            <div>
              <dt className="font-medium text-strong">Rule set: <Mono>{b.ruleset_version}</Mono></dt>
              <dd className="text-muted">Plain code with no AI inside, running in this system.</dd>
            </div>
          </dl>
          <p className="mt-4 rounded-xl bg-wait-bg px-3 py-2 text-xs text-wait-text">
            Honesty note: in this demo the AI model is hosted outside the system. A production deployment for a GMP
            client would run the model inside the client&apos;s own environment, so no document text leaves it.
          </p>
        </Card>
        <Card title="Audit trail integrity"
          aside={<form action={refreshPage}><button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">Re-check everything</button></form>}>
          <p className={`text-sm font-medium ${audit.ok ? "text-ok-text" : "text-fail-text"}`}>
            {audit.ok ? `✓ Chain intact: ${audit.entries} entries verified just now` : "✕ Chain broken"}
          </p>
          {audit.head_hash && <p className="mt-1 text-xs text-faint">Latest hash <Mono>{audit.head_hash}</Mono></p>}
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Link href="/audit" className="rounded-lg px-3 py-1.5 ring-1 ring-inset ring-line hover:bg-page">Browse and re-verify</Link>
            <a href="/audit/csv" className="rounded-lg px-3 py-1.5 ring-1 ring-inset ring-line hover:bg-page">Download the audit trail (CSV)</a>
          </div>
        </Card>
      </div>

      <Card title="Safeguards, and how each is verified">
        <ul className="divide-y divide-line-soft">
          {safeguards.map((s) => (
            <li key={s.name} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:gap-4">
              <span className={`h-fit w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                s.ok === true ? "bg-ok-bg text-ok-text ring-ok/30"
                  : s.ok === false ? "bg-fail-bg text-fail-text ring-fail/30"
                  : "bg-page text-body ring-line"}`}>
                {s.ok === true ? "Checked live ✓" : s.ok === false ? "FAILED live check" : "Tested"}
              </span>
              <div>
                <p className="font-medium text-strong">{s.name}</p>
                <p className="text-muted">{s.how}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Recent AI calls">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="py-2 pr-3 font-medium">Run</th><th className="py-2 pr-3 font-medium">What the AI did</th>
                <th className="py-2 pr-3 font-medium">What the rules did</th><th className="py-2 pr-3 font-medium">What a person did</th>
                <th className="py-2 font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft align-top">
              {recent_calls.map((r) => (
                <tr key={r.seq}>
                  <td className="py-2 pr-3">
                    <RunLink seq={r.seq}>{r.question}</RunLink>
                    <p className="text-xs text-faint"><Mono>#{r.seq}</Mono> · {r.asked_by} · {formatTime(r.recorded_at)}</p>
                  </td>
                  <td className="py-2 pr-3 text-xs text-body">{r.ai_did}{r.model && <p className="text-faint"><Mono>{r.model}</Mono></p>}</td>
                  <td className="py-2 pr-3 text-xs text-body">{r.rules_did}</td>
                  <td className="py-2 pr-3 text-xs text-body">{r.person_did}</td>
                  <td className="py-2 text-xs text-body">{r.tokens.toLocaleString("en-GB")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
