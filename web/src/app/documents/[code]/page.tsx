import Link from "next/link";
import { Suspense } from "react";

import { ErrorNote, Mono, PageHeader, sectionAnchor, Skeleton, StatusPill } from "@/components/ui";
import { getDocument, settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function DocumentPage(props: PageProps<"/documents/[code]">) {
  return (
    <>
      <Link href="/documents" className="text-sm text-zinc-600 hover:underline">← Document library</Link>
      <Suspense fallback={<Skeleton lines={5} />}>
        <Document params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Document({ params, searchParams }: {
  params: PageProps<"/documents/[code]">["params"];
  searchParams: PageProps<"/documents/[code]">["searchParams"];
}) {
  const code = decodeURIComponent((await params).code);
  const v = (await searchParams).v;
  const version = typeof v === "string" ? v : undefined;
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const res = await settle(getDocument(persona.data.current.id, code, version));
  if (!res.data) {
    return <ErrorNote>No document {code}{version ? ` v${version}` : ""} is visible to {persona.data.current.name}.</ErrorNote>;
  }
  const d = res.data;

  return (
    <>
      <PageHeader eyebrow={`${d.code} · version ${d.version}`} title={d.title} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
        <StatusPill status={d.status} regulatory={d.regulatory_status} />
        {d.effective_date && <span>Effective {d.effective_date}</span>}
        {d.owner && <span>· Owner: {d.owner}</span>}
        {d.record_state && <span>· Record {d.record_state}</span>}
        <span>· Source: {d.source_format}</span>
        {d.fingerprint && <span>· Fingerprint <Mono>{d.fingerprint.slice(0, 12)}</Mono></span>}
      </div>
      {d.status !== "effective" && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This version is {d.status}. It is kept for the record and is never quoted in an answer.
        </p>
      )}
      {d.required_qualifier && (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Every answer citing this document carries, by rule: “{d.required_qualifier}”
        </p>
      )}
      {d.versions.length > 1 && (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Versions">
          <span className="text-zinc-500">Versions:</span>
          {d.versions.map((ver) => (
            <Link key={ver.version} href={`/documents/${encodeURIComponent(d.code)}?v=${encodeURIComponent(ver.version)}`}
              aria-current={ver.version === d.version ? "page" : undefined}
              className={`rounded-full px-3 py-0.5 ring-1 ring-inset ${ver.version === d.version ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-700 ring-zinc-300"}`}>
              v{ver.version} · {ver.status === "effective" ? "in force" : ver.status}
            </Link>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3">
        {d.sections.map((s) => (
          <section key={s.path} id={sectionAnchor(s.path)}
            className="scroll-mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm target:border-amber-400 target:ring-2 target:ring-amber-200">
            <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-base font-semibold text-zinc-900">
              <a href={`#${sectionAnchor(s.path)}`} className="hover:underline">§ {s.path}</a>
              {s.page != null && <span className="text-xs font-normal text-zinc-500">page {s.page}</span>}
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">{s.text}</p>
          </section>
        ))}
      </div>
    </>
  );
}
