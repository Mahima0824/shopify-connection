import React from "react";
import "./globals.css";
import TopNav from "../components/TopNav";

export const metadata = {
  title: "ReconHub — Shopify Order & Accounting Reconciliation",
  description: "Operational reconciliation engine connecting Shopify, warehouse scans, returns, and Tally ERP/Prime.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        <main style={{ paddingTop: 24 }}>{children}</main>
      </body>
    </html>
  );
}
