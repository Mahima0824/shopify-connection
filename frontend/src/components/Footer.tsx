import React from "react";
import { Link } from "react-router-dom";

const cols: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Platform",
    links: [
      { label: "Executive Dashboard", href: "/dashboard" },
      { label: "Orders Directory", href: "/orders" },
      { label: "Exceptions & NDR", href: "/exceptions" },
      { label: "Tracking Telemetry", href: "/tracking" },
    ],
  },
  {
    title: "Operations",
    links: [
      { label: "Scan Hub Station", href: "/scan" },
      { label: "Warehouse Dispatch", href: "/scan/dispatch" },
      { label: "Customer Returns", href: "/scan/return" },
      { label: "RTO Management", href: "/scan/rto" },
      { label: "Outstanding SLA", href: "/shipments/outstanding" },
    ],
  },
  {
    title: "Accounting",
    links: [
      { label: "Settlement Statements", href: "/statements" },
      { label: "Bank Reconciliation", href: "/statements#reconciliation" },
      { label: "General Ledger", href: "/finance/ledger" },
      { label: "Month-End Close", href: "/finance/close" },
      { label: "P&L / GST Reports", href: "/reports/monthly" },
    ],
  },
  {
    title: "Integrations",
    links: [
      { label: "Tally Prime ERP", href: "/settings/tally" },
      { label: "Carrier Adapters", href: "/settings/carriers" },
      { label: "SLA Thresholds", href: "/settings/sla" },
      { label: "Cost Configuration", href: "/settings/costs" },
      { label: "Sign in", href: "/login" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-border/80 bg-background/95 backdrop-blur-sm pt-14 pb-8 text-foreground transition-colors">
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-10 px-6 sm:grid-cols-2 md:grid-cols-[2fr_repeat(4,1fr)] max-[480px]:px-4">
        {/* Brand Column */}
        <div className="flex flex-col gap-3">
          <Link
            to="/"
            className="flex items-center gap-2.5 font-heading font-extrabold text-xl tracking-tight text-foreground hover:opacity-90 transition-opacity"
          >
            <span className="size-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shadow-xs font-heading">
              R
            </span>
            <span>ReconHub</span>
          </Link>
          <p className="max-w-[300px] text-sm text-muted-foreground leading-relaxed">
            Autonomous operational ledger, physical barcode scan tracking, and idempotent Tally ERP reconciliation for high-volume Shopify brands.
          </p>
          <div className="mt-2 flex items-center gap-2 rounded-full border border-border/80 bg-muted/40 px-3 py-1 w-fit shadow-xs">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-muted-foreground">
              Live Pipeline Active · Tally 2.0
            </span>
          </div>
        </div>

        {/* Link Columns */}
        {cols.map((c) => (
          <div key={c.title} className="flex flex-col gap-3">
            <h3 className="font-heading font-semibold text-xs tracking-wider uppercase text-foreground">
              {c.title}
            </h3>
            <ul className="flex flex-col gap-2">
              {c.links.map((l) => (
                <li key={l.label + l.href}>
                  <Link
                    to={l.href}
                    className="block text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Bottom Bar */}
      <div className="mx-auto mt-12 flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-4 border-t border-border/80 px-6 pt-6 text-xs text-muted-foreground max-[480px]:px-4">
        <div className="flex flex-wrap items-center gap-4">
          <span>© 2026 ReconHub. All rights reserved.</span>
          <span>·</span>
          <span>Enterprise Financial Ledger</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="rounded-md border border-border/80 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            GST &amp; Tally Prime Compatible
          </span>
        </div>
      </div>
    </footer>
  );
}
