import { Suspense } from "react";
import { connection } from "next/server";

import { PageHeader } from "@/components/ui";
import { getDbHealth, settle, verifyAudit } from "@/lib/api";

export default function StatusPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader eyebrow="System status" title="Database and audit trail, checked live.">
        Every value below is measured when this page loads.
      </PageHeader>
      <Suspense fallback={<p className="text-sm text-faint">Checking database…</p>}>
        <DbStatus />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-faint">Verifying audit trail…</p>}>
        <AuditStatus />
      </Suspense>
    </div>
  );
}

function Alert({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  const styles =
    tone === "ok"
      ? "border-ok/40 bg-ok-bg text-ok-text"
      : "border-red-300 bg-red-50 text-red-700";
  return <p className={`rounded-lg border px-4 py-2 text-sm ${styles}`}>{children}</p>;
}

async function DbStatus() {
  await connection();
  const { data: db, error } = await settle(getDbHealth());
  if (!db) {
    return <Alert tone="error">API unreachable: {error}</Alert>;
  }

  const rows: [string, string][] = [
    ["Database", `${db.database} (Postgres ${db.server_version})`],
    ["Connection", db.pooled ? "Pooled" : "Direct"],
    ["pgvector", db.pgvector ?? "not installed"],
    ["Vector distance check", db.vector_distance_check?.toString() ?? "n/a"],
    ["Write/read round trip", db.write_read_roundtrip ? "passed" : "failed"],
    ["Latency", `${db.latency_ms} ms`],
  ];
  return (
    <dl className="divide-y divide-line-soft rounded-card border border-line bg-white">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-4 py-2 text-sm">
          <dt className="text-faint">{label}</dt>
          <dd className="font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

async function AuditStatus() {
  await connection();
  const { data: audit, error } = await settle(verifyAudit());
  if (!audit) {
    return <Alert tone="error">API unreachable: {error}</Alert>;
  }

  return audit.ok ? (
    <Alert tone="ok">
      Audit trail intact: {audit.entries} entries, head{" "}
      <span className="font-mono">{audit.head_hash?.slice(0, 16)}…</span>
    </Alert>
  ) : (
    <Alert tone="error">
      Audit trail broken at entry #{audit.broken_at}: {audit.reason}
    </Alert>
  );
}
