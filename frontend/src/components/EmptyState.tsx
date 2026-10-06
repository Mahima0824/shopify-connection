import React from "react";
import { Link } from "react-router-dom";

export type EmptyStateAction = { label: string; href: string };

export default function EmptyState({
  icon,
  title,
  body,
  primary,
  secondary,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  primary: EmptyStateAction;
  secondary?: EmptyStateAction;
}) {
  return (
    <div
      className="content-card"
      style={{ textAlign: "center", padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}
    >
      {icon && (
        <div
          aria-hidden="true"
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            background: "var(--neutral-bg)",
            border: "1px solid var(--hairline)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            marginBottom: "8px",
          }}
        >
          {icon}
        </div>
      )}
      <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--ink)", margin: 0 }}>{title}</h3>
      <p style={{ fontSize: "14px", color: "var(--muted)", margin: "0 0 16px", maxWidth: "420px" }}>{body}</p>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
        <Link to={primary.href} className="btn-primary">
          {primary.label}
        </Link>
        {secondary && (
          <Link to={secondary.href} className="btn-secondary">
            {secondary.label}
          </Link>
        )}
      </div>
    </div>
  );
}
