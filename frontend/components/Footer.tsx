"use client";

import React from "react";
import Link from "next/link";

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
      { label: "Sign up free", href: "/dashboard" },
    ],
  },
];

export default function Footer() {
  return (
    <footer style={{ background: "#101010", padding: "64px 0" }}>
      <div className="container footer-grid" style={{ display: "grid", gap: 32 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff", fontWeight: 600 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#fff",
                color: "#101010",
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
          <p style={{ color: "#a1a1aa", fontSize: 14, marginTop: 12, maxWidth: 280 }}>
            Reconciliation for Shopify ops. Scans, returns, and Tally in sync.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{c.title}</div>
            {c.links.map((l) => (
              <Link key={l.label + l.href} href={l.href} style={{ display: "block", color: "#a1a1aa", fontSize: 14, padding: "6px 0" }}>
                {l.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
}
