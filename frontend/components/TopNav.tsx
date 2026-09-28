"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { APP_NAV_ITEMS } from "../lib/app-nav";

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + "/");
}

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
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
            color: "var(--ink)",
            fontWeight: 600,
            fontSize: 18,
          }}
        >
          ReconHub
        </Link>
        <nav
          className="topnav-links"
          aria-label="Primary"
          style={{
            gap: 4,
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {APP_NAV_ITEMS.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                style={{
                  padding: "8px 16px",
                  borderRadius: 9999,
                  color: active ? "var(--ink)" : "var(--muted)",
                  background: active ? "var(--card)" : "transparent",
                  whiteSpace: "nowrap",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/login" style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
            Sign in
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
          aria-label="Mobile"
          style={{
            padding: 16,
            background: "var(--canvas)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          {APP_NAV_ITEMS.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                style={{
                  display: "block",
                  padding: "8px 16px",
                  borderRadius: 9999,
                  color: active ? "var(--ink)" : "var(--body)",
                  background: active ? "var(--card)" : "transparent",
                }}
              >
                {l.label}
              </Link>
            );
          })}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            style={{ display: "block", padding: "8px 16px", color: "var(--ink)" }}
          >
            Sign in
          </Link>
        </nav>
      )}
    </header>
  );
}
