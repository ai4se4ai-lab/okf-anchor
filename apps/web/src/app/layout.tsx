import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "OKF Anchor",
  description:
    "Publish, canonicalize, hash, graph, store and blockchain-anchor OKF v0.2 knowledge bundles as independently verifiable knowledge assets.",
};

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/assets", label: "Assets" },
  { href: "/mint", label: "Mint" },
  { href: "/verify", label: "Verify" },
  { href: "/query", label: "Query" },
  { href: "/servers", label: "Build servers" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4">
          <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 py-4 dark:border-slate-800">
            <Link href="/dashboard" className="text-lg font-semibold">
              OKF&nbsp;Anchor
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-slate-600 hover:text-slate-900 dark:text-slate-500 dark:hover:text-slate-100">
                  {n.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="flex-1 py-6">{children}</main>
          <footer className="border-t border-slate-200 py-4 text-xs text-slate-500 dark:border-slate-800">
            The blockchain is a trust and integrity anchor only — the OKF bundle remains authoritative.
          </footer>
        </div>
      </body>
    </html>
  );
}
