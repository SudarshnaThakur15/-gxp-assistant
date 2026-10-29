import { TopBar } from "@/components/pending";

// Shown at once while a page loads: the outline of a page instead of a frozen screen.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-label="Loading">
      <TopBar />
      <div className="flex flex-col gap-3">
        <div className="h-3 w-28 rounded bg-sunken" />
        <div className="h-9 w-2/3 rounded-lg bg-sunken" />
        <div className="h-4 w-1/2 rounded bg-sunken" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-card bg-sunken" />)}
      </div>
      <div className="h-64 rounded-card bg-sunken" />
    </div>
  );
}
