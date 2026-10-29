"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()}
      className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white print:hidden">
      Print or save as PDF
    </button>
  );
}
