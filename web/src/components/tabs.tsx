"use client";

import { useId, useState } from "react";

export type TabItem = { id: string; label: string; count?: number; content: React.ReactNode };

export function Tabs({ items, initial }: { items: TabItem[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? items[0]?.id);
  const base = useId();
  const current = items.find((t) => t.id === active) ?? items[0];

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label="Answer details"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-line-soft px-1 [scrollbar-width:none]">
        {items.map((t) => {
          const selected = t.id === current.id;
          return (
            <button
              key={t.id}
              id={`${base}-${t.id}-tab`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${base}-${t.id}-panel`}
              onClick={() => setActive(t.id)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                selected ? "border-brand font-semibold text-strong" : "border-transparent text-muted hover:text-strong"
              }`}
            >
              {t.label}
              {t.count != null && (
                <span className={`rounded-full px-1.5 text-[11px] font-semibold ${selected ? "bg-brand-soft text-brand-text" : "bg-sunken text-faint"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div id={`${base}-${current.id}-panel`} role="tabpanel" aria-labelledby={`${base}-${current.id}-tab`} className="pt-5">
        <div key={current.id} className="motion-safe:animate-fade-in">{current.content}</div>
      </div>
    </div>
  );
}
