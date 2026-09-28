"use client";

import React from "react";
import Link from "next/link";
import { useState } from "react";

export default function TopNav() {
  const [open, setOpen] = useState(false);
  return (
    <header
      style={{
        height: 64,
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
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
            color: "#111",
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "#111",
              color: "#fff",
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
          style={{ gap: 20, fontSize: 14, fontWeight: 500 }}
        >
          <Link href="/#product" style={{ color: "#374151" }}>
            Product
          </Link>
          <Link href="/dashboard" style={{ color: "#374151" }}>
            Dashboard
          </Link>
          <Link href="/#pricing" style={{ color: "#374151" }}>
            Pricing
          </Link>
        </nav>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/login" style={{ fontSize: 14, fontWeight: 500, color: "#111" }}>
            Sign in
          </Link>
          <Link href="/dashboard" className="btn-primary">
            Sign up free
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
          style={{ padding: 16, background: "#fff", borderBottom: "1px solid #e5e7eb" }}
        >
          <Link href="/#product" style={{ display: "block", padding: "8px 0", color: "#374151" }}>
            Product
          </Link>
          <Link href="/dashboard" style={{ display: "block", padding: "8px 0", color: "#374151" }}>
            Dashboard
          </Link>
          <Link href="/#pricing" style={{ display: "block", padding: "8px 0", color: "#374151" }}>
            Pricing
          </Link>
          <Link href="/login" style={{ display: "block", padding: "8px 0", color: "#111" }}>
            Sign in
          </Link>
        </nav>
      )}
    </header>
  );
}
