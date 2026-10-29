import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Sora } from "next/font/google";
import { Suspense } from "react";

import { Sidebar, SidebarFallback } from "@/components/sidebar";
import "./globals.css";

const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["600", "700", "800"] });
const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "GxP Knowledge Assistant",
  description: "Questions answered from approved GxP documents: the AI proposes, fixed rules decide, people sign",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sora.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Suspense fallback={<SidebarFallback />}>
            <Sidebar />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
              <p className="rounded-card border border-brand/60 bg-sunken/60 px-4 py-3 text-sm text-body print:hidden">
                <span className="font-semibold text-strong">You are looking at a demo.</span> The documents, organisation
                and people are fictional; the AI model is real. Answers are released, held or refused by fixed rules,
                never by the AI. Not a validated system.
              </p>
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
