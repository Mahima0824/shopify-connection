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
    <footer style={{ background: "var(--card)", borderTop: "1px solid var(--hairline)", padding: "64px 0 0" }}>
      <div className="container footer-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 32 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink)", fontWeight: 600 }}>
            ReconHub
          </div>
          <p style={{ color: "var(--body)", fontSize: 14, marginTop: 12, maxWidth: 280 }}>
            Reconciliation for Shopify ops. Scans, returns, and Tally in sync.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div style={{ color: "var(--ink)", fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{c.title}</div>
            {c.links.map((l) => (
              <Link key={l.label + l.href} to={l.href} style={{ display: "block", color: "var(--body)", fontWeight: 500, fontSize: 14, padding: "6px 0" }}>
                {l.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="container" style={{ marginTop: 48, borderTop: "1px solid var(--hairline)", paddingTop: 20, paddingBottom: 24, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>© 2026 ReconHub. All rights reserved.</span>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>Enterprise reconciliation for Shopify ops.</span>
      </div>
    </footer>
  );
}
