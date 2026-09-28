"use client";

import React from "react";
import Link from "next/link";
import ClayScene from "./ClayScene";

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
    <footer style={{ background: "var(--soft)", padding: "80px 0 0" }}>
      <div className="container footer-grid" style={{ display: "grid", gap: 32 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink)", fontWeight: 600 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "var(--brand-ochre)",
                color: "var(--ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
              }}
            >
              R
            </span>
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
              <Link key={l.label + l.href} href={l.href} style={{ display: "block", color: "var(--body)", fontWeight: 500, fontSize: 14, padding: "6px 0" }}>
                {l.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="container" style={{ marginTop: 48 }}>
        <ClayScene variant="horizon" />
      </div>
    </footer>
  );
}
