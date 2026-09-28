import React from "react";
import Link from "next/link";
import Reveal from "../components/Reveal";
import Footer from "../components/Footer";

const sectionPad = { padding: "96px 0" };

export default function Home() {
  return (
    <>
      {/* Hero band 7/5 */}
      <section style={{ background: "#fff" }}>
        <div className="container hero-grid" style={{ display: "grid", gridTemplateColumns: "7fr 5fr", gap: 48, alignItems: "center", paddingTop: 96, paddingBottom: 96 }}>
          <Reveal>
            <h1 className="display display-xl" style={{ fontSize: 48, lineHeight: 1.1, margin: 0 }}>
              Reconciliation for Shopify ops
            </h1>
            <p style={{ color: "#374151", fontSize: 18, marginTop: 16, maxWidth: 520 }}>
              Connect Shopify orders, warehouse scans, returns, and Tally accounting in one operational ledger.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <Link href="/dashboard" className="btn-primary">
                Sign up free
              </Link>
              <Link href="/#product" className="btn-secondary">
                See product
              </Link>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div
              className="hero-app-mockup-card"
              style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 20 }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f3f4f6" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Order #1042</span>
                <span className="badge-pill">Tally synced</span>
              </div>
              <Reveal delay={200}>
                <div style={{ marginTop: 16 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>Scan barcode</label>
                  <input className="input-control" placeholder="Scan or enter barcode" readOnly value="" aria-label="scan input" style={{ marginTop: 8 }} />
                </div>
              </Reveal>
              <Reveal delay={280}>
                <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center" }}>
                  <button type="button" className="btn-primary">Confirm</button>
                  <span className="badge-pill">Tally badge</span>
                </div>
              </Reveal>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Trust strip hairline divider */}
      <Reveal>
        <div style={{ borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb", background: "#fff" }}>
          <div className="container" style={{ display: "flex", gap: 32, paddingTop: 20, paddingBottom: 20, color: "#6b7280", fontSize: 14 }}>
            <span>Shopify</span>
            <span>Warehouse scans</span>
            <span>Returns</span>
            <span>Tally ERP</span>
          </div>
        </div>
      </Reveal>

      {/* Features 3-up gray cards */}
      <section style={sectionPad}>
        <div className="container">
          <Reveal>
            <h2 className="display" style={{ fontSize: 32, margin: 0 }}>Everything reconciled</h2>
          </Reveal>
          <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginTop: 32 }}>
            <Reveal delay={0}>
              <div className="feature-card">
                <h3 className="display" style={{ fontSize: 18, margin: "0 0 8px" }}>Sync</h3>
                <p style={{ margin: 0, fontSize: 14 }}>Shopify orders flow into one ledger with Tally vouchers attached.</p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="feature-card">
                <h3 className="display" style={{ fontSize: 18, margin: "0 0 8px" }}>Scan</h3>
                <p style={{ margin: 0, fontSize: 14 }}>Dispatch and return scans validate every parcel at the station.</p>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="feature-card">
                <h3 className="display" style={{ fontSize: 18, margin: "0 0 8px" }}>Reconcile</h3>
                <p style={{ margin: 0, fontSize: 14 }}>Exceptions surface mismatches before they hit accounting.</p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Product mockup exceptions fragment */}
      <section id="product" style={{ ...sectionPad, background: "#f8f9fa" }}>
        <div className="container">
          <Reveal>
            <h2 className="display" style={{ fontSize: 32, margin: 0 }}>Exceptions, resolved</h2>
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginTop: 32 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f3f4f6", fontSize: 14 }}>
                <span style={{ color: "#111", fontWeight: 600 }}>Missing return scan — #2091</span>
                <span className="badge-pill">High severity</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontSize: 14 }}>
                <span style={{ color: "#111", fontWeight: 600 }}>Duplicate dispatch — #2088</span>
                <span className="badge-pill">Medium severity</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Testimonials 3-up pastel avatars */}
      <section style={sectionPad}>
        <div className="container">
          <Reveal>
            <h2 className="display" style={{ fontSize: 32, margin: 0 }}>Loved by operators</h2>
          </Reveal>
          <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginTop: 32 }}>
            {[
              { name: "Ops lead", color: "#fb923c", quote: "Returns finally match Tally." },
              { name: "Warehouse mgr", color: "#ec4899", quote: "Scans catch errors same-day." },
              { name: "Accountant", color: "#8b5cf6", quote: "Month-end closes in hours." },
            ].map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <div className="feature-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 36, height: 36, borderRadius: "50%", background: t.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>
                      {t.name[0]}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{t.name}</span>
                  </div>
                  <p style={{ marginTop: 12, fontSize: 14 }}>{t.quote}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing 4-up with featured dark Teams card */}
      <section id="pricing" style={{ ...sectionPad, background: "#f8f9fa" }}>
        <div className="container">
          <Reveal>
            <h2 className="display" style={{ fontSize: 32, margin: 0 }}>Pricing</h2>
          </Reveal>
          <div className="grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20, marginTop: 32 }}>
            {["Starter", "Growth", "Teams", "Enterprise"].map((p) => (
              <Reveal key={p} delay={0}>
                <div
                  style={
                    p === "Teams"
                      ? { background: "#101010", color: "#fff", borderRadius: 12, padding: 24 }
                      : { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24 }
                  }
                >
                  <div style={{ fontSize: 16, fontWeight: 600, color: p === "Teams" ? "#fff" : "#111" }}>{p}</div>
                  <p style={{ fontSize: 14, color: p === "Teams" ? "#a1a1aa" : "#6b7280" }}>
                    {p === "Teams" ? "Featured plan for growing ops." : `${p} plan for Shopify ops.`}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA gray 48px centered */}
      <section style={sectionPad}>
        <div className="container">
          <Reveal>
            <div className="cta-band-light" style={{ background: "#f5f5f5", border: "1px solid #e5e7eb", borderRadius: 48, padding: 48, textAlign: "center" }}>
              <h2 className="display" style={{ fontSize: 32, margin: 0 }}>Start reconciling today</h2>
              <div style={{ marginTop: 20 }}>
                <Link href="/dashboard" className="btn-primary">
                  Sign up free
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <Footer />
    </>
  );
}
