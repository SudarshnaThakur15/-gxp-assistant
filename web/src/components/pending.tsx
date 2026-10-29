"use client";

import { useLinkStatus } from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const noop = () => () => {};

// Rendered at the end of <body>, so nothing on the page (sticky panels, the sidebar) can sit above it.
export function Overlay({ children }: { children: React.ReactNode }) {
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  return inBrowser ? createPortal(children, document.body) : children;
}

// A thin moving bar along the top of the window: "something is loading". Fixed, so it never shifts layout.
export function TopBar() {
  return (
    <Overlay>
      <div role="progressbar" aria-label="Loading" className="fixed inset-x-0 top-0 z-50 h-[3px] overflow-hidden bg-brand/15">
        <div className="h-full w-1/3 bg-brand motion-safe:animate-progress" />
      </div>
    </Overlay>
  );
}

// Put inside any <Link>: shows the top bar while that link's page is loading.
export function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <TopBar /> : null;
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span aria-hidden className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}
