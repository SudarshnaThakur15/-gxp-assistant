import { MobileMenu } from "@/components/mobile-menu";
import { NavLinks } from "@/components/nav-links";
import { PersonaSwitcher } from "@/components/persona-switcher";
import { getReviewCount, getTeamCount, settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";
import { AI_MODEL } from "@/lib/site";

const ROLE = {
  qa_analyst: { label: "QA Analyst", note: "Asks questions and sees only their own. A held answer reaches them after QA signs it." },
  qa_manager: { label: "QA Manager", note: "Reviews and e-signs held answers for the programmes they cover." },
  auditor: { label: "Auditor · read-only", note: "Sees every question, answer and audit entry. Cannot ask or sign." },
  team_member: { label: "Team member", note: "Answers questions the documents could not, for the teams they cover. Cannot ask or sign." },
};

function Brand() {
  return (
    <div>
      <p className="font-display text-lg font-extrabold leading-tight tracking-tight text-white">GxP Knowledge Assistant</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/60">Assurance demo</p>
    </div>
  );
}

const FOOTER = `Fictional documents and people. Real AI model (${AI_MODEL} on Groq). Not a validated system.`;

export async function Sidebar() {
  const { data, error } = await settle(getCurrentPersona());
  if (!data) {
    return (
      <aside className="bg-ink p-4 text-sm text-white lg:w-[264px] lg:shrink-0">
        <Brand />
        <p className="mt-4 rounded-lg bg-fail-bg p-3 text-fail-text">API unreachable: {error}</p>
      </aside>
    );
  }
  const { current, all } = data;
  const role = ROLE[current.role];
  const [count, teamCount] = await Promise.all([
    current.can_sign ? settle(getReviewCount(current.id)) : null,
    current.teams.length ? settle(getTeamCount(current.id)) : null,
  ]);
  const waiting = count?.data?.waiting ?? 0;

  const viewingAs = (
    <div className="flex flex-col gap-2.5 rounded-xl border border-ink-line p-3.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">Viewing as</p>
      <div>
        <p className="font-medium text-white">{current.name}</p>
        <p className="text-sm text-white/70">{role.label}</p>
      </div>
      <p className="text-[13px] leading-snug text-white/65">{role.note}</p>
      <p className="text-xs text-white/50">
        {current.teams.length ? `Answers for ${current.teams.map((x) => x.name).join(", ")}` : current.clients.join(" · ")}
      </p>
      <PersonaSwitcher key={current.id} personas={all} currentId={current.id} />
    </div>
  );
  const nav = <NavLinks role={current.role} waiting={waiting} teamWaiting={teamCount?.data?.waiting ?? 0} />;

  return (
    <aside className="bg-ink text-white print:hidden lg:sticky lg:top-0 lg:h-screen lg:w-[264px] lg:shrink-0 lg:overflow-y-auto">
      <MobileMenu brand={<Brand />} who={`${current.name} · ${role.label}`}>
        {viewingAs}
        {nav}
      </MobileMenu>
      <div className="hidden h-full flex-col gap-7 px-4 py-6 lg:flex">
        <Brand />
        {viewingAs}
        {nav}
        <p className="mt-auto text-xs leading-relaxed text-white/45">{FOOTER}</p>
      </div>
    </aside>
  );
}

export function SidebarFallback() {
  return <aside className="h-14 bg-ink lg:h-screen lg:w-[264px] lg:shrink-0" />;
}
