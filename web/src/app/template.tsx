// Re-mounts on every navigation, so each new page fades in instead of snapping.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6 motion-safe:animate-fade-in">{children}</div>;
}
