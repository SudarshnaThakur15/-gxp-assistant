import Link from "next/link";
import { Suspense } from "react";

import { DocText, ErrorNote, Mono, sectionAnchor, Skeleton, StatusPill } from "@/components/ui";
import { getDocument, settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function DocumentPage(props: PageProps<"/documents/[code]">) {
  return (
    <>
      <Link href="/documents" className="text-sm text-muted hover:underline">← Document library</Link>
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
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <Mono className="font-semibold text-brand-text">{d.code}</Mono>
          <span>Version {d.version}</span>
          {d.effective_date && <span>Effective {d.effective_date}</span>}
          {d.owner && <span>Owner: {d.owner}</span>}
          <StatusPill status={d.status} regulatory={d.regulatory_status} />
        </div>
        <h1 className="text-3xl font-extrabold leading-tight">{d.title}</h1>
        <p className="text-sm text-faint">
          {d.regulatory_status ? "Official published text" : "Fictional document for the demonstration"} · source {d.source_format}
          {d.record_state && ` · record ${d.record_state}`}
          {d.fingerprint && <> · fingerprint <Mono>{d.fingerprint.slice(0, 12)}</Mono></>}
        </p>
      </header>
      {d.status !== "effective" && (
        <p className="rounded-xl border border-wait/40 bg-wait-bg px-4 py-3 text-sm text-wait-text">
          This version is {d.status}. It is kept for the record and is never quoted in an answer.
        </p>
      )}
      {d.required_qualifier && (
        <p className="rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand-text">
          Every answer citing this document carries, by rule: “{d.required_qualifier}”
        </p>
      )}
      {d.versions.length > 1 && (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Versions">
          <span className="text-faint">Versions:</span>
          {d.versions.map((ver) => (
            <Link key={ver.version} href={`/documents/${encodeURIComponent(d.code)}?v=${encodeURIComponent(ver.version)}`}
              aria-current={ver.version === d.version ? "page" : undefined}
              className={`rounded-full px-3 py-0.5 ring-1 ring-inset ${ver.version === d.version ? "bg-ink text-white ring-ink" : "bg-white text-body ring-line"}`}>
              v{ver.version} · {ver.status === "effective" ? "in force" : ver.status}
            </Link>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3">
        {d.sections.map((s) => (
          <section key={s.path} id={sectionAnchor(s.path)}
            className="scroll-mt-6 rounded-card border border-line bg-white p-5 shadow-card target:border-brand target:ring-2 target:ring-brand/30">
            <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-lg font-semibold">
              <a href={`#${sectionAnchor(s.path)}`} className="flex items-baseline gap-2 hover:underline">
                {/^\d+(\.\d+)*\s/.test(s.path) ? (
                  <>
                    <Mono className="text-[0.95rem] font-medium text-brand-text">§{s.path.split(" ")[0]}</Mono>
                    {s.path.split(" ").slice(1).join(" ")}
                  </>
                ) : s.path}
              </a>
              {s.page != null && <span className="text-xs font-normal text-faint">page {s.page}</span>}
            </h2>
            <DocText text={s.text} />
          </section>
        ))}
      </div>
    </>
  );
}
