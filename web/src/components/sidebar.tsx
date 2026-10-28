import { NavLinks } from "@/components/nav-links";
import { PersonaSwitcher } from "@/components/persona-switcher";
import { settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";
import { AI_MODEL } from "@/lib/site";

const ROLE_NOTE = {
  qa_analyst: "Asks questions. Sees only their own runs; a held answer reaches them after a QA Manager signs it.",
  qa_manager: "Reviews and e-signs held answers, and sees the runs of every programme they cover.",
};

function Brand() {
  return (
    <div>
      <p className="text-base font-bold tracking-tight text-zinc-900">GxP Knowledge Assistant</p>
      <p className="text-xs text-zinc-500">Assurance demo · AI proposes, rules decide, people sign</p>
    </div>
  );
}

const FOOTER = `Synthetic documents and people. Real AI model (${AI_MODEL} on Groq). Not a validated system.`;

async function ViewingAs() {
  const { data, error } = await settle(getCurrentPersona());
  if (!data) {
    return <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">API unreachable: {error}</p>;
  }
  const { current, all } = data;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-zinc-400">Viewing as</p>
      <div>
        <p className="text-sm font-semibold text-zinc-900">{current.name}</p>
        <p className="text-xs text-zinc-600">{current.title}</p>
      </div>
      <p className="text-xs text-zinc-600">{ROLE_NOTE[current.role]}</p>
      <p className="text-xs text-zinc-500">
        {current.organisation} · {current.clients.join(", ")}
        {current.can_sign && " · can e-sign"}
      </p>
      <PersonaSwitcher key={current.id} personas={all} currentId={current.id} />
    </div>
  );
}

export async function Sidebar() {
  const viewingAs = await ViewingAs();
  return (
    <aside className="border-b border-zinc-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
      {/* Phone and tablet: brand + a menu that opens */}
      <details className="group px-4 py-3 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <Brand />
          <span className="rounded-lg border border-zinc-300 px-2.5 py-1 text-sm text-zinc-700">Menu</span>
        </summary>
        <div className="mt-4 flex flex-col gap-5 pb-2">
          {viewingAs}
          <NavLinks />
        </div>
      </details>
      {/* Desktop: always open */}
      <div className="hidden h-full flex-col gap-6 p-5 lg:flex">
        <Brand />
        {viewingAs}
        <NavLinks />
        <p className="mt-auto text-xs text-zinc-400">{FOOTER}</p>
      </div>
    </aside>
  );
}

export function SidebarFallback() {
  return <aside className="h-16 border-b border-zinc-200 bg-white lg:h-screen lg:w-72 lg:border-b-0 lg:border-r" />;
}
