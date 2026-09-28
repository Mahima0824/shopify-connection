import React from "react";
import Link from "next/link";

const stations = [
  { href: "/scan/dispatch", title: "Dispatch", desc: "Scan parcels out for delivery" },
  { href: "/scan/return", title: "Returns", desc: "Scan customer returns & RTO intake" },
  { href: "/scan/rto", title: "RTO", desc: "Record courier RTO events" },
];

export default function ScanHubPage() {
  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px" }}>
      <div>
        <h1 className="display" style={{ fontSize: "32px" }}>Scan Hub</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          Choose a warehouse scanning station. All stations support handheld scanners, phone cameras, and manual entry.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
        {stations.map((s) => (
          <Link key={s.href} href={s.href} style={{ textDecoration: "none" }}>
            <div className="content-card" style={{ padding: "32px 24px", textAlign: "center" }}>
              <h2 style={{ fontSize: "22px", marginBottom: "8px" }}>{s.title}</h2>
              <p style={{ color: "var(--muted)", fontSize: "14px" }}>{s.desc}</p>
            </div>
          </Link>
        ))}
      </div>
      <p style={{ color: "var(--muted)", fontSize: "13px" }}>
        Note: camera scanning requires HTTPS or localhost and a rear-facing camera for best results.
      </p>
    </div>
  );
}
