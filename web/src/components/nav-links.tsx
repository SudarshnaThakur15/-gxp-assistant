"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS = [
  {
    heading: "Work",
    links: [
      { href: "/", label: "Console" },
      { href: "/runs", label: "Question runs" },
      { href: "/reviews", label: "Review queue" },
    ],
  },
  {
    heading: "Evidence",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/assurance", label: "Assurance layer" },
      { href: "/documents", label: "Document library" },
      { href: "/audit", label: "Audit trail" },
      { href: "/status", label: "System status" },
    ],
  },
];

export function NavLinks() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav className="flex flex-col gap-5">
      {GROUPS.map((group) => (
        <div key={group.heading} className="flex flex-col gap-1">
          <p className="px-3 text-[0.7rem] font-semibold uppercase tracking-wider text-zinc-400">{group.heading}</p>
          {group.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active(link.href) ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                active(link.href) ? "bg-zinc-900 font-medium text-white" : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
