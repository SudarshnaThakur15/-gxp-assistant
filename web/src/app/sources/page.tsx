import Link from "next/link";
import { Suspense } from "react";

import { Card, ErrorNote, formatTime, Mono, PageHeader, Skeleton } from "@/components/ui";
import { getSources, settle } from "@/lib/api";

export default function SourcesPage() {
  return (
    <>
      <PageHeader eyebrow="Document sources" title="Where the knowledge comes from, and what was turned away.">
        In this demo the documents arrive by file import, not a live connection to a document management system. Every
        import checks each file&apos;s metadata first: anything incomplete is rejected and listed here, never quietly
        loaded.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={3} />}>
        <SourceCards />
      </Suspense>
    </>
  );
}

const SOURCES = [
  { format: "markdown", name: "Controlled QMS documents", path: "corpus/northbridge",
    what: "SOPs, the AI-use policy, specifications, deviation and CAPA records and quality agreements of a fictional CDMO, written for this demo. Some belong to one client only." },
  { format: "pdf", name: "Public regulations and guidelines", path: "corpus/public",
    what: "Official EU GMP and ICH texts as published (including the Annex 22 consultation draft), parsed page by page so citations carry page numbers." },
  { format: "docx", name: "Document management system export", path: "corpus/northbridge/dms-export",
    what: "Word files with a metadata sidecar, the way a real DMS exports them. A file with incomplete metadata (for example no status) is rejected." },
];

async function SourceCards() {
  const res = await settle(getSources());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const { documents, last_run: run } = res.data;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        {SOURCES.map((s) => {
          const rows = documents.filter((d) => d.format === s.format);
          const total = rows.reduce((n, d) => n + d.count, 0);
          return (
            <Card key={s.format} title={s.name}
              aside={<span className="rounded-full bg-page px-2 py-0.5 text-xs text-body ring-1 ring-inset ring-line">File import · demo</span>}>
              <p className="text-sm text-body">{s.what}</p>
              <p className="mt-2 text-xs text-faint"><Mono>{s.path}</Mono> · {s.format}</p>
              <p className="mt-3 text-2xl font-bold text-strong">{total}</p>
              <p className="text-xs text-faint">document version(s)</p>
              <ul className="mt-2 text-xs text-muted">
                {rows.map((d) => (
                  <li key={`${d.client}-${d.status}`}>
                    {d.count} {d.status}{d.client ? `, ${d.client} only` : d.tenant === "public" ? ", public" : ", shared"}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      <Card title="Last import"
        aside={<Link href="/documents" className="text-sm text-muted hover:underline">Document library →</Link>}>
        {run ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-body">
              {formatTime(run.recorded_at)} · audit <Mono>#{run.audit_seq}</Mono> · {run.unchanged} unchanged ·{" "}
              {run.ingested.length} new · {run.metadata_updated.length} metadata updated · {run.withdrawn.length} withdrawn
            </p>
            {run.rejected.length > 0 && (
              <div className="rounded-xl border border-wait/40 bg-wait-bg p-3">
                <p className="text-sm font-medium text-wait-text">Rejected ({run.rejected.length}): not loaded until fixed</p>
                <ul className="mt-1 text-xs text-wait-text">
                  {run.rejected.map((r) => <li key={r.source}><Mono>{r.source}</Mono>: {r.problems.join(", ")}</li>)}
                </ul>
              </div>
            )}
            <p className="text-xs text-faint">
              Re-run with <Mono>uv run python -m app.ingest</Mono>. Unchanged files are skipped by fingerprint; a document
              removed from its source is withdrawn, never left searchable.
            </p>
          </div>
        ) : (
          <p className="text-sm text-faint">No import has been recorded yet.</p>
        )}
      </Card>
    </>
  );
}
