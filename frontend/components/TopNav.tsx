"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { APP_NAV_GROUPS } from "../lib/app-nav";

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + "/");
}

function isExact(pathname: string | null, href: string) {
  return pathname === href;
}

function isGroupActive(pathname: string | null, href?: string, children?: { href: string }[]) {
  if (href) return isActive(pathname, href);
  return (children ?? []).some((c) => isActive(pathname, c.href));
}

const pill = (active: boolean, extra?: React.CSSProperties): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
  padding: "8px 16px",
  borderRadius: 9999,
  color: active ? "var(--ink)" : "var(--muted)",
  background: active ? "var(--card)" : "transparent",
  whiteSpace: "nowrap",
  ...extra,
});

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pathname = usePathname();

  const closeDrop = () => setOpenDrop(null);

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
          {APP_NAV_GROUPS.map((g) => {
            const active = isGroupActive(pathname, g.href, g.children);
            if (g.href) {
              return (
                <Link
                  key={g.label}
                  href={g.href}
                  aria-current={active ? "page" : undefined}
                  style={pill(active)}
                >
                  {g.label}
                </Link>
              );
            }
            const dropOpen = openDrop === g.label;
            return (
              <div
                key={g.label}
                className={dropOpen ? "nav-drop open" : "nav-drop"}
                style={{ position: "relative" }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeDrop();
                }}
              >
                <button
                  type="button"
                  aria-expanded={dropOpen}
                  aria-haspopup="true"
                  onClick={() => setOpenDrop(dropOpen ? null : g.label)}
                  style={{
                    ...pill(active),
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "Inter, sans-serif",
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  {g.label}
                </button>
                <div
                  className="nav-drop-menu"
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    minWidth: 200,
                    background: "var(--card)",
                    border: "1px solid var(--hairline)",
                    borderRadius: 12,
                    padding: 4,
                    zIndex: 60,
                  }}
                >
                  {(g.children ?? []).map((c) => {
                    const childActive = isActive(pathname, c.href);
                    return (
                      <Link
                        key={c.href}
                        href={c.href}
                        aria-current={isExact(pathname, c.href) ? "page" : undefined}
                        onClick={closeDrop}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          minHeight: 44,
                          padding: "10px 16px",
                          borderRadius: 8,
                          fontSize: 14,
                          color: childActive ? "var(--ink)" : "var(--body)",
                          background: childActive ? "var(--surface)" : "transparent",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
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
          {APP_NAV_GROUPS.map((g) => {
            if (g.href) {
              const active = isActive(pathname, g.href);
              return (
                <Link
                  key={g.label}
                  href={g.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  style={{
                    display: "block",
                    minHeight: 44,
                    padding: "8px 16px",
                    borderRadius: 9999,
                    color: active ? "var(--ink)" : "var(--body)",
                    background: active ? "var(--card)" : "transparent",
                  }}
                >
                  {g.label}
                </Link>
              );
            }
            const isExpanded = expanded === g.label;
            const groupActive = isGroupActive(pathname, g.href, g.children);
            return (
              <div key={g.label}>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : g.label)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 16px",
                    borderRadius: 9999,
                    border: "none",
                    background: groupActive ? "var(--card)" : "transparent",
                    color: groupActive ? "var(--ink)" : "var(--body)",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                    minHeight: 44,
                  }}
                >
                  {g.label}
                </button>
                {isExpanded &&
                  (g.children ?? []).map((c) => {
                    const childActive = isActive(pathname, c.href);
                    return (
                      <Link
                        key={c.href}
                        href={c.href}
                        aria-current={isExact(pathname, c.href) ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          minHeight: 44,
                          padding: "8px 16px 8px 32px",
                          borderRadius: 9999,
                          color: childActive ? "var(--ink)" : "var(--body)",
                          background: childActive ? "var(--card)" : "transparent",
                        }}
                      >
                        {c.label}
                      </Link>
                    );
                  })}
              </div>
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
