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
        background: "#f8f9fa",
        borderRadius: 9999,
        padding: 6,
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
            padding: "8px 14px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            color: active === i.href ? "#111" : "#6b7280",
            background: active === i.href ? "#fff" : "transparent",
            boxShadow: active === i.href ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
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
