import Link from "next/link";

import type { Check, Citation, Outcome, DocRef } from "@/lib/api";
import { CHECK_PLAIN, SHORT, STATUS, type Tone } from "@/lib/plain";
import { LinkPending } from "@/components/pending";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-text">{children}</p>;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="max-w-3xl text-3xl font-extrabold leading-[1.08] sm:text-4xl">{title}</h1>
      {children && <p className="max-w-2xl text-[15px] leading-relaxed text-muted">{children}</p>}
    </header>
  );
}

export function Card({ title, aside, children, className = "" }: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-card border border-line bg-white p-5 shadow-card sm:p-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export const TONE_PILL: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-text",
  wait: "bg-wait-bg text-wait-text",
  fail: "bg-fail-bg text-fail-text",
  info: "bg-brand-soft text-brand-text",
};

export function Pill({ tone, children, className = "" }: { tone: Tone | "neutral"; children: React.ReactNode; className?: string }) {
  const cls = tone === "neutral" ? "bg-sunken text-muted" : TONE_PILL[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls} ${className}`}>{children}</span>;
}

export function OutcomePill({ outcome, label }: { outcome: Outcome; label?: string }) {
  return <Pill tone={STATUS[outcome].tone}>{label ?? SHORT[outcome]}</Pill>;
}

// Map a public decision (from POST /ask) onto an outcome.
export function decisionOutcome(decision: string, answerType: string): Outcome {
  if (decision === "held_for_review") return "held";
  if (decision === "refused") return "refused";
  return answerType === "not_found" ? "not_found" : "released";
}

export function TierChip({ tier }: { tier: string }) {
  const title: Record<string, string> = {
    T1: "Tier 1: answered straight away",
    T2: "Tier 2: needs a QA review and signature",
    T3: "Tier 3: a decision for people, not answered",
  };
  return (
    <span title={title[tier] ?? "No tier: the request failed safely"}
      className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-xs font-semibold text-muted">
      {tier}
    </span>
  );
}

// Every step says who decided it: the AI, or fixed rules with no AI inside.
export function ByBadge({ by, model }: { by: string; model?: string | null }) {
  if (by === "AI") {
    return <Pill tone="wait" className="uppercase tracking-wide">AI{model ? ` · ${model}` : ""}</Pill>;
  }
  if (by.includes("AI")) return <Pill tone="neutral">Rules and AI</Pill>;
  return <Pill tone="neutral">Rules only</Pill>;
}

export function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.8rem] ${className}`}>{children}</span>;
}

export function citationRef(c: Pick<Citation, "doc" | "version" | "section">) {
  return `${c.doc} v${c.version} §${c.section}`;
}

// Anchor for a section on the document page, so citations land on the exact paragraph.
export function sectionAnchor(section: string) {
  return `s-${section.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function citationHref(c: Pick<Citation, "doc" | "version" | "section">) {
  return `/documents/${encodeURIComponent(c.doc)}?v=${encodeURIComponent(c.version)}#${sectionAnchor(c.section)}`;
}

export function CitationChip({ c }: { c: Pick<Citation, "doc" | "version" | "section"> }) {
  return (
    <Link href={citationHref(c)}
      className="rounded-md bg-brand-soft px-1.5 py-0.5 font-mono text-[0.8rem] font-medium text-brand-text transition-colors hover:bg-brand-tint">
      {citationRef(c)}
    </Link>
  );
}

// A clause of a controlled document, resolved against the library when the page loaded.
export function DocRefLink({ r }: { r: DocRef }) {
  if (r.external) {
    return <a href={r.external} target="_blank" rel="noreferrer" className="font-medium text-brand-text hover:underline">{r.label} ↗</a>;
  }
  if (!r.resolved || !r.version) {
    return <span className="text-fail-text" title="This reference no longer resolves to an in-force section">{r.label} (not found)</span>;
  }
  return (
    <Link href={citationHref({ doc: r.doc, version: r.version, section: r.section })} className="font-medium text-brand-text hover:underline">
      {r.label}
    </Link>
  );
}

export function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="rounded-r-md border-l-[3px] border-brand bg-page px-3 py-2 text-sm leading-relaxed text-body">
      “{children}”
    </blockquote>
  );
}

export function Citations({ citations }: { citations: Citation[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {citations.map((c) => (
        <li key={c.n} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11px] font-semibold text-white">{c.n}</span>
            <CitationChip c={c} />
            {c.title && <span className="text-body">{c.title}</span>}
            {c.page != null && <span className="text-xs text-faint">page {c.page}</span>}
          </div>
          {c.quotes.map((quote) => <Quote key={quote}>{quote}</Quote>)}
        </li>
      ))}
    </ol>
  );
}

const CHECK_ICON: Record<Check["status"], { icon: string; cls: string; label: string }> = {
  pass: { icon: "✓", cls: "bg-ok-bg text-ok-text", label: "passed" },
  fail: { icon: "✕", cls: "bg-fail-bg text-fail-text", label: "failed" },
  fixed: { icon: "✎", cls: "bg-brand-soft text-brand-text", label: "fixed by a rule" },
  skip: { icon: "–", cls: "bg-sunken text-faint", label: "not applicable" },
};

export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-line-soft">
      {checks.map((c) => {
        const s = CHECK_ICON[c.status];
        return (
          <li key={c.id} className="flex gap-3 py-2.5 text-sm">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.cls}`} aria-label={s.label}>{s.icon}</span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-strong">{CHECK_PLAIN[c.id] ?? c.title}</p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-faint">
                <Mono>{c.id}</Mono>
                <span>{c.severity === "hard" ? "blocking: a failure refuses the answer" : "review: a failure holds it for QA"}</span>
                {c.status === "fixed" && <span className="text-brand-text">fixed by a rule</span>}
              </p>
              {c.detail && <p className="break-words text-xs text-muted">{c.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-dashed border-line bg-white/60 px-5 py-8 text-center text-sm text-muted">{children}</div>;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-card border border-fail/30 bg-fail-bg px-4 py-3 text-sm text-fail-text">{children}</p>;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-16 rounded-card bg-sunken" />
      ))}
    </div>
  );
}

export function RunLink({ seq, children }: { seq: number; children: React.ReactNode }) {
  return (
    <Link href={`/runs/${seq}`} className="font-medium text-strong underline-offset-2 hover:text-brand-text hover:underline">
      <LinkPending />
      {children}
    </Link>
  );
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}

// Document status: in force, superseded, or draft guidance from a regulator.
export function StatusPill({ status, regulatory }: { status: string; regulatory?: string | null }) {
  if (regulatory === "consultation_draft") return <Pill tone="info">Draft guidance</Pill>;
  if (status === "effective") return <Pill tone="ok">In force</Pill>;
  return <Pill tone="neutral">{status.charAt(0).toUpperCase() + status.slice(1)}</Pill>;
}

export function Stat({ value, label, caption, tone }: { value: React.ReactNode; label: string; caption?: string; tone?: Tone }) {
  const highlight = tone === "wait" ? "border-wait/40 bg-wait-bg/50" : "border-line bg-white";
  return (
    <div className={`flex flex-col gap-0.5 rounded-card border p-4 shadow-card ${highlight}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`font-display text-3xl font-extrabold ${tone === "ok" ? "text-ok-text" : "text-strong"}`}>{value}</p>
      {caption && <p className="text-xs text-faint">{caption}</p>}
    </div>
  );
}

// Document text as written in the controlled source: bold, bullet lists and tables, nothing else.
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-strong">{part.slice(2, -2)}</strong> : part);
}

export function DocText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="list-disc pl-5">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    if (table.length) {
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-line-soft">
              {table.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className={`py-1.5 pr-4 ${i === 0 ? "font-semibold text-strong" : ""}`}>{inline(cell)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>,
      );
    }
    list = []; table = [];
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^[-*]\s+/.test(t)) { if (table.length) flush(); list.push(t.replace(/^[-*]\s+/, "")); }
    else if (t.startsWith("|")) {
      if (list.length) flush();
      if (!/^\|[\s:|-]+\|$/.test(t)) table.push(t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    } else { flush(); if (t) blocks.push(<p key={blocks.length}>{inline(t)}</p>); }
  }
  flush();
  return <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-body">{blocks}</div>;
}
