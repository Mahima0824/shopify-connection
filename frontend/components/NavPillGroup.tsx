"use client";

import React from "react";
import Link from "next/link";

export default function NavPillGroup({
  items,
  active,
}: {
  items: { label: string; href: string }[];
  active: string;
}) {
  return (
    <div
      style={{
        background: "transparent",
        display: "inline-flex",
        gap: 4,
        maxWidth: "100%",
        overflowX: "auto",
      }}
    >
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={active === i.href ? "pill-active" : ""}
          style={{
            padding: "8px 16px",
            borderRadius: 9999,
            fontSize: 14,
            fontWeight: 500,
            color: active === i.href ? "var(--ink)" : "var(--muted)",
            background: active === i.href ? "var(--card)" : "transparent",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
