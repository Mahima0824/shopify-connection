"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  // Hide sidebar on login page
  if (pathname === "/login") return null;

  const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: "📊" },
    { label: "Orders Directory", href: "/orders", icon: "📦" },
    { label: "Dispatch Scanner", href: "/scan/dispatch", icon: "🏷️" },
    { label: "Returns Station", href: "/scan/return", icon: "🔄" },
    { label: "Exceptions Queue", href: "/exceptions", icon: "⚠️" },
    { label: "Tally Integration", href: "/settings/tally", icon: "⚙️" },
  ];

  const handleLogout = () => {
    localStorage.removeItem("token");
    router.push("/login");
  };

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px", padding: "0 8px" }}>
        <div style={{
          width: "40px",
          height: "40px",
          borderRadius: "10px",
          background: "var(--accent-gradient)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "20px",
          boxShadow: "0 4px 12px rgba(99, 102, 241, 0.4)"
        }}>
          ⚡
        </div>
        <div>
          <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, lineHeight: 1.2 }}>ReconHub</h2>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Shopify Ledger</span>
        </div>
      </div>

      {/* Nav Links */}
      <nav style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px 16px",
                borderRadius: "10px",
                color: isActive ? "#ffffff" : "var(--text-muted)",
                background: isActive ? "rgba(99, 102, 241, 0.2)" : "transparent",
                border: isActive ? "1px solid rgba(99, 102, 241, 0.4)" : "1px solid transparent",
                fontWeight: isActive ? 600 : 500,
                fontSize: "14px",
                transition: "all 0.2s ease"
              }}
            >
              <span style={{ fontSize: "16px" }}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User / Logout Footer */}
      <div style={{ paddingTop: "16px", borderTop: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "12px" }}>
        <button
          onClick={handleLogout}
          className="btn-secondary"
          style={{ width: "100%", justifyContent: "center" }}
        >
          🚪 Log Out
        </button>
      </div>
    </aside>
  );
}
