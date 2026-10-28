import Link from "next/link";

import type { Check, Citation, Outcome } from "@/lib/api";

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{eyebrow}</p>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">{title}</h1>
      {children && <p className="max-w-3xl text-sm text-zinc-600">{children}</p>}
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
    <section className={`rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm ${className}`}>
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-zinc-900">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

const OUTCOME_TONE: Record<Outcome, string> = {
  released: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  not_found: "bg-sky-50 text-sky-800 ring-sky-200",
  held: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-800 ring-rose-200",
  refused: "bg-rose-50 text-rose-800 ring-rose-200",
};

export function OutcomePill({ outcome, label }: { outcome: Outcome; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${OUTCOME_TONE[outcome]}`}>
      {label}
    </span>
  );
}

// Map a public decision (from POST /ask) onto the outcome colours.
export function decisionOutcome(decision: string, answerType: string): Outcome {
  if (decision === "held_for_review") return "held";
  if (decision === "refused") return "refused";
  return answerType === "not_found" ? "not_found" : "released";
}

export function TierChip({ tier }: { tier: string }) {
  const title: Record<string, string> = {
    T1: "T1: knowledge answer, released by rules",
    T2: "T2: needs QA review and e-signature",
    T3: "T3: prohibited decision, refused",
  };
  return (
    <span title={title[tier] ?? "No tier: the request failed safely"}
      className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-zinc-700">
      {tier}
    </span>
  );
}

// Every step says who decided it: the AI, or fixed rules with no AI inside.
export function ByBadge({ by, model }: { by: string; model?: string | null }) {
  if (by === "AI") {
    return (
      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-inset ring-violet-200">
        AI{model ? ` · ${model}` : ""}
      </span>
    );
  }
  if (by.includes("AI")) {
    return (
      <span className="rounded-full bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200">
        Rules + AI (stricter wins)
      </span>
    );
  }
  return (
    <span className="rounded-full bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200">
      Rules · no AI
    </span>
  );
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
    <Link href={citationHref(c)} className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.8rem] text-zinc-800 hover:bg-zinc-200 hover:underline">
      {citationRef(c)}
    </Link>
  );
}

export function Citations({ citations }: { citations: Citation[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {citations.map((c) => (
        <li key={c.n} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-zinc-500">[{c.n}]</span>
            <CitationChip c={c} />
            {c.page != null && <span className="text-xs text-zinc-500">page {c.page}</span>}
          </div>
          {c.quotes.map((quote) => (
            <blockquote key={quote} className="border-l-4 border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              “{quote}”
            </blockquote>
          ))}
        </li>
      ))}
    </ol>
  );
}

const CHECK_ICON: Record<Check["status"], { icon: string; tone: string; label: string }> = {
  pass: { icon: "✓", tone: "text-emerald-700", label: "passed" },
  fail: { icon: "✕", tone: "text-rose-700", label: "failed" },
  fixed: { icon: "✎", tone: "text-sky-700", label: "fixed by rule" },
  skip: { icon: "–", tone: "text-zinc-400", label: "not applicable" },
};

export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-zinc-100">
      {checks.map((c) => {
        const s = CHECK_ICON[c.status];
        return (
          <li key={c.id} className="flex gap-3 py-2 text-sm">
            <span className={`w-4 shrink-0 font-bold ${s.tone}`} aria-label={s.label}>{s.icon}</span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <Mono className="font-semibold text-zinc-800">{c.id}</Mono>
                <span className="text-zinc-800">{c.title}</span>
                <span className={`rounded px-1.5 text-[0.7rem] font-medium uppercase tracking-wide ${
                  c.severity === "hard" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                  {c.severity === "hard" ? "blocking" : "review"}
                </span>
              </div>
              {c.detail && <p className="break-words text-xs text-zinc-500">{c.detail}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">{children}</p>;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{children}</p>;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-16 rounded-2xl bg-zinc-200/70" />
      ))}
    </div>
  );
}

export function RunLink({ seq, children }: { seq: number; children: React.ReactNode }) {
  return (
    <Link href={`/runs/${seq}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
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
  if (regulatory === "consultation_draft") {
    return <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-200">Draft guidance</span>;
  }
  const tone = status === "effective"
    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : "bg-zinc-100 text-zinc-600 ring-zinc-200";
  const label = status === "effective" ? "In force" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>{label}</span>;
}
