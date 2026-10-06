import React from "react";
import { Link } from "react-router-dom";

const cols: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Orders", href: "/orders" },
      { label: "Exceptions", href: "/exceptions" },
    ],
  },
  {
    title: "Scanning",
    links: [
      { label: "Dispatch scan", href: "/scan/dispatch" },
      { label: "Return scan", href: "/scan/return" },
      { label: "Parcels", href: "/orders" },
    ],
  },
  {
    title: "Finance",
    links: [
      { label: "Statements", href: "/statements" },
      { label: "Reports", href: "/reports/monthly" },
      { label: "Tally settings", href: "/settings/tally" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Pricing", href: "/#pricing" },
      { label: "Sign in", href: "/login" },
      { label: "Try free", href: "/dashboard" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-border bg-card pt-16 text-card-foreground">
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-8 px-6 sm:grid-cols-2 md:grid-cols-[2fr_repeat(4,1fr)] max-[480px]:px-4">
        <div>
          <div className="flex items-center gap-2.5 font-semibold text-foreground text-base">
            ReconHub
          </div>
          <p className="mt-3 max-w-[280px] text-sm text-muted-foreground leading-relaxed">
            Reconciliation for Shopify ops. Scans, returns, and Tally in sync.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div className="mb-3 text-sm font-semibold text-foreground">{c.title}</div>
            <div className="flex flex-col gap-1.5">
              {c.links.map((l) => (
                <Link
                  key={l.label + l.href}
                  to={l.href}
                  className="block text-sm font-medium text-muted-foreground transition-colors hover:text-foreground py-0.5"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-12 flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-5 max-[480px]:px-4">
        <span className="text-xs text-muted-foreground">© 2026 ReconHub. All rights reserved.</span>
        <span className="text-xs text-muted-foreground">Enterprise reconciliation for Shopify ops.</span>
      </div>
    </footer>
  );
}
