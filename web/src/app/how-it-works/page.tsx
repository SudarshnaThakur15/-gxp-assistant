import Link from "next/link";
import { Suspense } from "react";

import { ByBadge, Card, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { getAssurance, settle } from "@/lib/api";

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader eyebrow="How a question is handled" title="Screen it, ground it, check it, tier it, record it, release it.">
        Every question passes the same seven gates in the same order. Only one of them is the AI writing a draft; the
        others are fixed rules. The numbers on each gate are live counts from the audit trail.
      </PageHeader>
      <Suspense fallback={<Skeleton lines={7} />}>
        <Gates />
      </Suspense>
    </>
  );
}

async function Gates() {
  const res = await settle(getAssurance());
  if (!res.data) return <ErrorNote>API unreachable: {res.error}</ErrorNote>;
  const c = res.data.stats.counts;
  const n = (key: string) => c[key] ?? 0;
  const gates = [
    {
      name: "Screen", by: "rules + AI", link: ["/assurance", "Screening rules"],
      what: "Fixed rules refuse prohibited requests first: batch release, deviation classification, root cause, CAPA choice and attempts to override the instructions. Only if no rule refuses does an AI classifier look, and it can only add a refusal, never remove one.",
      who: "Rules decide. The AI may only make it stricter.",
      live: `${n("runs")} questions screened · ${n("screen_refused_rules")} refused by a rule with no AI call · ${n("screen_refused_ai")} refused by the AI screen`,
    },
    {
      name: "Retrieve", by: "rules", link: ["/documents", "Document library"],
      what: "Hybrid search (meaning + keywords) over approved, in-force documents only. Documents the person may not see are filtered out before ranking, so they can never reach the AI. Weak matches mean “not found”, not a guess.",
      who: "Rules decide what the AI is allowed to read.",
      live: `${n("retrieved")} searches · ${n("permission_exclusions")} where another client's documents were filtered out · ${n("not_found")} “not found”`,
    },
    {
      name: "Generate", by: "AI", link: ["/runs", "Question runs"],
      what: "The AI writes the draft as claims on a fixed form: each claim cites one passage and copies a quote word for word. There is no free-text box: the answer shown is assembled by code from verified claims.",
      who: "The AI proposes. Nothing it writes is shown unchecked.",
      live: `${n("ai_drafts")} drafts · ${n("tokens").toLocaleString("en-GB")} tokens used in total · ${n("generation_error")} AI failure(s), each refused`,
    },
    {
      name: "Validate", by: "rules", link: ["/assurance", "The 11 checks and the lab"],
      what: "11 checks: citations exist and are in force, quotes are word for word and long enough, numbers and product forms match the source, no decision language, no repeated injected instructions, draft guidance labelled.",
      who: "Rules decide. A blocking failure refuses; a review failure holds.",
      live: `${n("validated")} drafts checked · ${n("stopped_by_checks")} refused by a blocking check`,
    },
    {
      name: "Tier", by: "rules", link: ["/assurance", "Tier rules"],
      what: "The consequence tier comes from the kind of task, never from the AI's confidence: T1 knowledge answers, T2 investigation or human-action content, T3 prohibited.",
      who: "Rules decide. The AI can raise the tier, never lower it.",
      live: `T1 ${n("tier_T1")} · T2 ${n("tier_T2")} · T3 ${n("tier_T3")} · failed safely ${n("tier_n/a")}`,
    },
    {
      name: "Record", by: "rules", link: ["/audit", "Audit trail"],
      what: "The whole run is written to the hash-chained audit trail and committed before anything is shown. If the write fails, nothing is released.",
      who: "Nobody: it always happens, first.",
      live: `${res.data.stats.audit.entries} audit entries · chain ${res.data.stats.audit.ok ? "intact, verified just now" : "BROKEN"}`,
    },
    {
      name: "Release", by: "rules", link: ["/reviews", "Review queue"],
      what: "Released by rules, held for a QA Manager's electronic signature, or refused, exactly as the tier and checks say. A held draft is never shown to the person who asked until it is signed.",
      who: "Rules release T1. People sign T2. T3 is always refused.",
      live: `Released ${n("decision_released")} · held ${n("decision_held_for_review")} · refused ${n("decision_refused")} · signed: approved ${n("review_approved")}, rejected ${n("review_rejected")}`,
    },
  ];

  return (
    <>
      <ol className="flex flex-col gap-3">
        {gates.map((g, i) => (
          <li key={g.name}>
            <Card>
              <div className="flex flex-col gap-2 md:flex-row md:gap-6">
                <div className="flex shrink-0 items-start gap-3 md:w-48">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{i + 1}</span>
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-strong">{g.name}</p>
                    <ByBadge by={g.by === "AI" ? "AI" : g.by} />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 text-sm">
                  <p className="text-strong">{g.what}</p>
                  <p className="text-muted"><span className="font-medium text-strong">Who decides:</span> {g.who}</p>
                  <p className="text-xs text-faint">Live: {g.live}</p>
                  <Link href={g.link[0]} className="text-xs font-medium text-strong underline underline-offset-2">{g.link[1]} →</Link>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <Card title="The one rule behind all seven">
        <p className="text-sm text-strong">
          The AI proposes. Fixed, written, tested rules decide. People sign. Anything the rules cannot verify is refused
          or held, never guessed.
        </p>
        <p className="mt-2 text-xs text-faint">
          Honesty note: this demo uses fictional documents and people, and a real AI model hosted by Groq, so questions
          and the retrieved passages are sent to that external service. A production deployment would run the model inside
          the client&apos;s own environment.
        </p>
      </Card>
    </>
  );
}
