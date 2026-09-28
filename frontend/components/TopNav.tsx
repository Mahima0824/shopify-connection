"use client";

import React from "react";
import Link from "next/link";
import { useState } from "react";

const centerLinks = [
  { label: "Product", href: "/#product" },
  { label: "Solutions", href: "/#solutions" },
  { label: "Resources", href: "/#resources" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Customers", href: "/#customers" },
];

export default function TopNav() {
  const [open, setOpen] = useState(false);
  return (
    <header
      style={{
        height: 64,
        background: "var(--canvas)",
        borderBottom: "1px solid var(--hairline)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "var(--ink)",
            fontWeight: 600,
          }}
        >
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
        </Link>
        <nav
          className="topnav-links"
          style={{
            gap: 20,
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {centerLinks.map((l) => (
            <Link key={l.label} href={l.href} style={{ color: "var(--body)" }}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/login" style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
            Sign in
          </Link>
          <Link href="/dashboard" className="btn-primary">
            Try free
          </Link>
          <button
            className="topnav-menu-btn"
            onClick={() => setOpen(!open)}
            aria-label="menu"
            aria-expanded={open}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}
          >
            ☰
          </button>
        </div>
      </div>
      {open && (
        <nav
          className="topnav-sheet"
          style={{
            padding: 16,
            background: "var(--canvas)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          {centerLinks.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              style={{ display: "block", padding: "8px 0", color: "var(--body)" }}
            >
              {l.label}
            </Link>
          ))}
          <Link href="/login" style={{ display: "block", padding: "8px 0", color: "var(--ink)" }}>
            Sign in
          </Link>
        </nav>
      )}
    </header>
  );
}
