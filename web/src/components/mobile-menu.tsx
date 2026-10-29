"use client";

import { useState } from "react";

// Phone and tablet: a top bar with a Menu button; the panel closes when a link in it is followed.
export function MobileMenu({ brand, who, children }: { brand: React.ReactNode; who: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        {brand}
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-white/70 sm:inline">{who}</span>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="rounded-lg border border-ink-line bg-white px-3.5 py-1.5 text-sm font-semibold text-ink"
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open && (
        <div
          className="flex flex-col gap-6 border-t border-ink-line px-4 pb-6 pt-4"
          onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
