import Link from "next/link";
import { Suspense } from "react";

import { ErrorNote, Mono, PageHeader, Skeleton, StatusPill } from "@/components/ui";
import { getDocuments, settle, type DocumentSummary } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function DocumentsPage() {
  return (
    <>
      <PageHeader eyebrow="Document library" title="Controlled documents and their versions.">
        The controlled documents you may see, with every version. Superseded versions stay here for the record but
        are never quoted. Another client&apos;s documents are not listed at all.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={4} />}>
        <DocumentTable />
      </Suspense>
    </>
  );
}

const TYPE_LABEL: Record<string, string> = {
  sop: "SOP", policy: "Policy", specification: "Specification", guideline: "Regulation / guideline",
  deviation: "Deviation record", capa: "CAPA record", quality_agreement: "Quality agreement",
};

async function DocumentTable() {
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const res = await settle(getDocuments(persona.data.current.id));
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const docs = [...res.data].sort((a, b) => (TYPE_LABEL[a.doc_type] ?? a.doc_type).localeCompare(TYPE_LABEL[b.doc_type] ?? b.doc_type) || a.code.localeCompare(b.code));

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-line text-xs uppercase tracking-wide text-faint">
          <tr>
            <th className="px-4 py-3 font-medium">Document</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Version</th>
            <th className="px-4 py-3 font-medium">Effective</th>
            <th className="px-4 py-3 font-medium">Owner</th>
            <th className="px-4 py-3 font-medium">Sections</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft align-top">
          {docs.map((d: DocumentSummary) => (
            <tr key={d.code}>
              <td className="px-4 py-3">
                <Link href={`/documents/${encodeURIComponent(d.code)}`} className="font-medium text-strong hover:underline">{d.title}</Link>
                <p><Mono className="text-faint">{d.code}</Mono>{d.client_id && <span className="ml-2 text-xs text-faint">client: {d.client_id}</span>}</p>
              </td>
              <td className="px-4 py-3 text-xs text-muted">{TYPE_LABEL[d.doc_type] ?? d.doc_type}{d.record_state && ` · ${d.record_state}`}</td>
              <td className="px-4 py-3">
                <Mono>{d.version}</Mono>
                {d.versions.length > 1 && <p className="text-xs text-faint">{d.versions.length - 1} other version(s)</p>}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{d.effective_date ?? "–"}</td>
              <td className="px-4 py-3 text-xs text-muted">{d.owner ?? "–"}</td>
              <td className="px-4 py-3 text-xs text-muted">{d.sections}</td>
              <td className="px-4 py-3"><StatusPill status={d.status} regulatory={d.regulatory_status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
