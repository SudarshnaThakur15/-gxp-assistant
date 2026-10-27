import { Suspense } from "react";
import { connection } from "next/server";

import { getDbHealth } from "@/lib/api";

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
    </main>
  );
}

async function DbStatus() {
  await connection();

  try {
    const db = await getDbHealth();
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
  } catch (error) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
        API unreachable: {(error as Error).message}
      </p>
    );
  }
}
