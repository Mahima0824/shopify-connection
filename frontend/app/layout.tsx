import React from "react";
import "./globals.css";
import Navbar from "../components/Navbar";

export const metadata = {
  title: "ReconHub — Shopify Order & Accounting Reconciliation",
  description: "Operational reconciliation engine connecting Shopify, warehouse scans, returns, and Tally ERP/Prime.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          <Navbar />
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
