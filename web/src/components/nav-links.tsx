"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Persona } from "@/lib/api";
import { LinkPending } from "@/components/pending";

type Group = { heading: string; links: { href: string; label: string; badge?: number }[] };

// Each role sees only what it needs: segregation of duties shows in the menu too.
function groupsFor(role: Persona["role"], waiting: number): Group[] {
  const learn = { heading: "Learn", links: [{ href: "/how-it-works", label: "How it works" }] };
  if (role === "qa_analyst") {
    return [
      { heading: "Work", links: [
        { href: "/", label: "Ask" },
        { href: "/runs", label: "My questions" },
        { href: "/documents", label: "Documents" },
      ] },
      learn,
    ];
  }
  if (role === "qa_manager") {
    return [
      { heading: "Work", links: [
        { href: "/reviews", label: "Review inbox", badge: waiting },
        { href: "/", label: "Ask" },
        { href: "/runs", label: "Team questions" },
        { href: "/documents", label: "Documents" },
      ] },
      learn,
    ];
  }
  return [
    { heading: "Oversight", links: [
      { href: "/", label: "Overview" },
      { href: "/runs", label: "All questions" },
      { href: "/audit", label: "Audit trail" },
    ] },
    { heading: "Evidence", links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/assurance", label: "Assurance layer" },
      { href: "/trust", label: "Trust centre" },
      { href: "/proof", label: "Proof and value" },
      { href: "/documents", label: "Document library" },
    ] },
    { heading: "Setup", links: [
      { href: "/sources", label: "Document sources" },
      { href: "/status", label: "System status" },
    ] },
  ];
}

export function NavLinks({ role, waiting = 0 }: { role: Persona["role"]; waiting?: number }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav className="flex flex-col gap-6">
      {groupsFor(role, waiting).map((group) => (
        <div key={group.heading} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">{group.heading}</p>
          {group.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active(link.href) ? "page" : undefined}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-[15px] transition-colors duration-150 ${
                active(link.href) ? "bg-white/10 font-medium text-white" : "text-white/75 hover:bg-white/5 hover:text-white"
              }`}
            >
              <LinkPending />
              {link.label}
              {!!link.badge && (
                <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">{link.badge}</span>
              )}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
