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

type Group = { key: string; title: string; note: string; docs: DocumentSummary[] };

// Whose documents they are: each client's own records, NorthBridge's shared procedures, public regulations.
function groupsOf(docs: DocumentSummary[]): Group[] {
  const byType = (a: DocumentSummary, b: DocumentSummary) =>
    (TYPE_LABEL[a.doc_type] ?? a.doc_type).localeCompare(TYPE_LABEL[b.doc_type] ?? b.doc_type) || a.code.localeCompare(b.code);
  const clients = [...new Set(docs.filter((d) => d.client_name).map((d) => d.client_name as string))].sort();
  return [
    ...clients.map((name) => ({
      key: name, title: name, note: "Client-confidential: only people assigned to this client can see or search these.",
      docs: docs.filter((d) => d.client_name === name).sort(byType),
    })),
    { key: "shared", title: "NorthBridge procedures and policy", note: "Shared by every programme at site NB-1.",
      docs: docs.filter((d) => !d.client_name && !d.public).sort(byType) },
    { key: "public", title: "Public regulations and guidelines", note: "Official published texts.",
      docs: docs.filter((d) => d.public).sort(byType) },
  ].filter((g) => g.docs.length);
}

async function DocumentTable() {
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  const res = await settle(getDocuments(me.id));
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const groups = groupsOf(res.data);
  const older = res.data.reduce((n, d) => n + d.versions.length - 1, 0);

  return (
    <>
      <div className="flex flex-col gap-1 rounded-card border border-line bg-white px-5 py-4 shadow-card">
        <p className="text-[15px] text-strong">
          <span className="font-semibold">{res.data.length} documents</span> visible to {me.name}:{" "}
          {groups.map((g) => `${g.docs.length} ${g.key === "public" ? "public regulations" : g.key === "shared" ? "shared" : g.title}`).join(" · ")}
          {older > 0 && ` · plus ${older} older version${older === 1 ? "" : "s"} kept for the record`}
        </p>
        <p className="text-sm text-muted">
          {me.clients.length > 1
            ? `${me.name} covers ${me.clients.join(" and ")}, so both clients' documents are listed, each in its own section.`
            : `${me.name} works on ${me.clients[0]} only. Other clients' documents are not listed and cannot be searched.`}
        </p>
      </div>
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          <div>
            <h2 className="text-xl font-semibold">{g.title} <span className="text-base font-normal text-faint">({g.docs.length})</span></h2>
            <p className="text-sm text-muted">{g.note}</p>
          </div>
          <DocTable docs={g.docs} />
        </section>
      ))}
    </>
  );
}

function DocTable({ docs }: { docs: DocumentSummary[] }) {
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
          {docs.map((d) => (
            <tr key={d.code}>
              <td className="px-4 py-3">
                <Link href={`/documents/${encodeURIComponent(d.code)}`} className="font-medium text-strong hover:underline">{d.title}</Link>
                <p><Mono className="text-faint">{d.code}</Mono></p>
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
