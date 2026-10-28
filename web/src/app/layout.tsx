import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import { Sidebar, SidebarFallback } from "@/components/sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GxP Knowledge Assistant",
  description: "Questions answered from approved GxP documents: the AI proposes, fixed rules decide, people sign",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Suspense fallback={<SidebarFallback />}>
            <Sidebar />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-8">
              Demo: the documents, organisation and people are fictional; the AI model is real. Answers are
              released, held or refused by fixed rules, never by the AI. Not a validated system.
            </p>
            <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
