import React from "react";
import { Link } from "react-router-dom";

const stations = [
  { href: "/scan/dispatch", title: "Dispatch", desc: "Scan parcels out for delivery" },
  { href: "/scan/return", title: "Returns", desc: "Scan customer returns & RTO intake" },
  { href: "/scan/rto", title: "RTO", desc: "Record courier RTO events" },
];

export default function ScanHubPage() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--background)" }}>
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Scan Hub</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>
          Choose a warehouse scanning station. All stations support handheld scanners, phone cameras, and manual entry.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 min-[769px]:grid-cols-2 min-[1025px]:grid-cols-3">
        {stations.map((s) => (
          <Link key={s.href} to={s.href} style={{ textDecoration: "none" }}>
            <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ padding: "32px 24px", textAlign: "center" }}>
              <h2 style={{ fontSize: "22px", marginBottom: "8px" }}>{s.title}</h2>
              <p style={{ color: "var(--muted-foreground)", fontSize: "14px" }}>{s.desc}</p>
            </div>
          </Link>
        ))}
      </div>
      <p style={{ color: "var(--muted-foreground)", fontSize: "13px" }}>
        Note: camera scanning requires HTTPS or localhost and a rear-facing camera for best results.
      </p>
    </div>
  );
}
