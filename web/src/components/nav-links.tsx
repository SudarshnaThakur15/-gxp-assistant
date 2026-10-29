"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Persona } from "@/lib/api";
import { LinkPending } from "@/components/pending";

type Group = { heading: string; links: { href: string; label: string; badge?: number }[] };

// Each role sees only what it needs: segregation of duties shows in the menu too.
// Headings and names follow the AiVACO assurance platform: Work, Evidence, Setup.
function groupsFor(role: Persona["role"], waiting: number, teamWaiting: number): Group[] {
  const howItWorks = { href: "/how-it-works", label: "How a question is handled" };
  const library = { href: "/documents", label: "Document library" };
  const teamInput = { href: "/team-input", label: "Team input", badge: teamWaiting };
  if (role === "qa_analyst") {
    return [
      { heading: "Work", links: [{ href: "/", label: "Ask" }, { href: "/runs", label: "My questions" }, teamInput] },
      { heading: "Evidence", links: [howItWorks, library, { href: "/q9", label: "ICH Q9 alignment" }] },
    ];
  }
  if (role === "qa_manager") {
    return [
      { heading: "Work", links: [
        { href: "/reviews", label: "Review inbox", badge: waiting },
        { href: "/", label: "Ask" },
        { href: "/runs", label: "Team questions" },
        teamInput,
      ] },
      { heading: "Evidence", links: [
        howItWorks, library,
        { href: "/controls", label: "Controls and validation" },
        { href: "/q9", label: "ICH Q9 alignment" },
        { href: "/assurance", label: "Rules and checks" },
      ] },
    ];
  }
  if (role === "team_member") {
    return [
      { heading: "Work", links: [teamInput] },
      { heading: "Evidence", links: [howItWorks, library] },
    ];
  }
  return [
    { heading: "Work", links: [
      { href: "/", label: "Auditor console" },
      { href: "/runs", label: "All questions" },
      teamInput,
    ] },
    { heading: "Evidence", links: [
      howItWorks, library,
      { href: "/controls", label: "Controls and validation" },
      { href: "/proof", label: "Proof and value" },
      { href: "/q9", label: "ICH Q9 alignment" },
      { href: "/assurance", label: "Rules and checks" },
      { href: "/trust", label: "Trust centre" },
      { href: "/audit", label: "Audit trail" },
    ] },
    { heading: "Setup", links: [
      { href: "/sources", label: "Connected systems" },
      { href: "/risk", label: "Platform risk (FMEA)" },
      { href: "/status", label: "System status" },
    ] },
  ];
}

export function NavLinks({ role, waiting = 0, teamWaiting = 0 }: {
  role: Persona["role"]; waiting?: number; teamWaiting?: number;
}) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/c/") : pathname.startsWith(href));
  return (
    <nav className="flex flex-col gap-6">
      {groupsFor(role, waiting, teamWaiting).map((group) => (
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
