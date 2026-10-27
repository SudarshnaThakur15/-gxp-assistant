import { Suspense } from "react";
import { connection } from "next/server";

import { getDbHealth, settle, verifyAudit } from "@/lib/api";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GxP Knowledge Assistant</h1>
        <p className="text-sm text-zinc-500">System status</p>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">Checking database…</p>}>
        <DbStatus />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-zinc-500">Verifying audit trail…</p>}>
        <AuditStatus />
      </Suspense>
    </main>
  );
}

function Alert({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  const styles =
    tone === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
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
    <dl className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-4 py-2 text-sm">
          <dt className="text-zinc-500">{label}</dt>
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
