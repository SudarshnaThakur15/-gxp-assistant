"use client";

import { useState } from "react";

const HOURS_PER_FTE_MONTH = 140;

type Inputs = {
  questions: number;
  manualMinutes: number;
  releasedShare: number;
  heldShare: number;
  readMinutes: number;
  reviewMinutes: number;
  hourlyCost: number;
};

const FIELDS: { key: keyof Inputs; label: string; unit: string; max: number }[] = [
  { key: "questions", label: "Questions per month", unit: "", max: 20000 },
  { key: "manualMinutes", label: "Minutes to find and confirm an answer today", unit: "min", max: 240 },
  { key: "releasedShare", label: "Share released by rules", unit: "%", max: 100 },
  { key: "heldShare", label: "Share held for QA review", unit: "%", max: 100 },
  { key: "readMinutes", label: "Minutes to read an answer and its quotes", unit: "min", max: 60 },
  { key: "reviewMinutes", label: "Minutes for a QA review and signature", unit: "min", max: 120 },
  { key: "hourlyCost", label: "Cost of an hour of QA time", unit: "€", max: 1000 },
];

// Questions that are refused or "not found" are assumed to be handled the old way, by hand.
export function RoiCalculator({ releasedShare, heldShare }: { releasedShare: number; heldShare: number }) {
  const [v, setV] = useState<Inputs>({
    questions: 600, manualMinutes: 25, releasedShare, heldShare, readMinutes: 3, reviewMinutes: 6, hourlyCost: 75,
  });
  const released = v.releasedShare / 100;
  const held = Math.min(v.heldShare / 100, 1 - released);
  const manual = Math.max(1 - released - held, 0);
  const before = (v.questions * v.manualMinutes) / 60;
  const after = (v.questions * (released * v.readMinutes + held * (v.readMinutes + v.reviewMinutes) + manual * v.manualMinutes)) / 60;
  const saved = Math.max(before - after, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-body">{f.label}</span>
            <span className="flex items-center gap-1">
              <input type="number" min={0} max={f.max} value={v[f.key]}
                onChange={(e) => setV({ ...v, [f.key]: Math.min(Math.max(Number(e.target.value) || 0, 0), f.max) })}
                className="w-24 rounded-lg border border-line px-2 py-1 text-right" />
              <span className="w-6 text-xs text-faint">{f.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {[
            [`${Math.round(saved).toLocaleString("en-GB")} h`, "QA hours saved per month"],
            [`${before ? Math.round((saved / before) * 100) : 0}%`, "less time per question"],
            [(saved / HOURS_PER_FTE_MONTH).toFixed(1), "full-time people freed for other work"],
            [`€${Math.round(saved * v.hourlyCost).toLocaleString("en-GB")}`, "per month, at your hourly cost"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-xl bg-page p-3">
              <p className="text-xl font-bold text-strong">{value}</p>
              <p className="text-xs text-faint">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 text-xs text-muted">
          <Bar label="Today" hours={before} max={before} tone="bg-line-strong" />
          <Bar label="With the assistant" hours={after} max={before} tone="bg-ok" />
        </div>
        <p className="text-xs text-faint">
          {Math.round(v.questions * (held + manual)).toLocaleString("en-GB")} questions a month would still be read by a
          person before use (held) or handled by hand (refused or not found). A model, not a measurement: the shares
          come from this demo&apos;s runs; replace every number with the client&apos;s own.
        </p>
      </div>
    </div>
  );
}

function Bar({ label, hours, max, tone }: { label: string; hours: number; max: number; tone: string }) {
  return (
    <div>
      <p>{label}: {Math.round(hours).toLocaleString("en-GB")} h / month</p>
      <div className="h-3 rounded-full bg-sunken">
        <div className={`h-3 rounded-full ${tone}`} style={{ width: `${max ? Math.min((hours / max) * 100, 100) : 0}%` }} />
      </div>
    </div>
  );
}
