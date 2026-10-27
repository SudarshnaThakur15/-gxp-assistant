import { PersonaSwitcher } from "@/components/persona-switcher";
import { settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export async function Header() {
  const { data: persona } = await settle(getCurrentPersona());
  if (!persona) {
    return (
      <header className="border-b border-zinc-200 px-4 py-3 text-sm text-red-700 dark:border-zinc-800">
        API unreachable: personas unavailable
      </header>
    );
  }
  const { current, all } = persona;

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{current.organisation}</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
            Demo · synthetic data
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-500">
            Access: {current.clients.join(", ")}
            {current.can_sign && " · can e-sign"}
          </span>
          <PersonaSwitcher key={current.id} personas={all} currentId={current.id} />
        </div>
      </div>
    </header>
  );
}

export function HeaderFallback() {
  return <header className="h-[57px] border-b border-zinc-200 dark:border-zinc-800" />;
}
