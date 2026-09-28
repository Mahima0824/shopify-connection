import React from "react";
import Link from "next/link";
import Reveal from "../components/Reveal";
import ClayScene from "../components/ClayScene";
import Footer from "../components/Footer";

const sectionPad = { padding: "96px 0" };
const whiteChip = {
  background: "var(--on-primary)",
  color: "var(--ink)",
  borderRadius: 12,
  padding: "12px 16px",
  fontSize: 14,
};

export default function Home() {
  return (
    <>
      {/* Hero band 7/5 cream */}
      <section style={{ background: "var(--canvas)" }}>
        <div className="container hero-grid" style={{ paddingTop: 96, paddingBottom: 96 }}>
          <Reveal>
            <h1 className="display display-xl" style={{ margin: 0 }}>
              Reconciliation for Shopify ops
            </h1>
            <p style={{ color: "var(--body)", fontSize: 18, marginTop: 16, maxWidth: 520 }}>
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
              className="hero-illustration-card"
              style={{ background: "var(--soft)", border: "1px solid var(--hairline)", borderRadius: 24, padding: 20 }}
            >
              <ClayScene variant="mountains" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Trust strip hairline divider */}
      <Reveal>
        <div style={{ borderTop: "1px solid var(--hairline)", borderBottom: "1px solid var(--hairline)", background: "var(--canvas)" }}>
          <div className="container" style={{ display: "flex", gap: 32, paddingTop: 20, paddingBottom: 20, color: "var(--muted)", fontSize: 14 }}>
            <span>Shopify</span>
            <span>Warehouse scans</span>
            <span>Returns</span>
            <span>Tally ERP</span>
          </div>
        </div>
      </Reveal>

      {/* Features 3-up: pink Sync / teal Scan / lavender Reconcile */}
      <section id="solutions" style={sectionPad}>
        <div className="container">
          <Reveal>
            <h2 className="display" style={{ fontSize: 32, margin: 0 }}>Everything reconciled</h2>
          </Reveal>
          <div className="grid-3" style={{ marginTop: 32 }}>
            <Reveal delay={0}>
              <div className="feature-card-pink">
                <h3 className="display" style={{ fontSize: 18, margin: "0 0 8px" }}>Sync</h3>
                <div style={whiteChip}>
                  <span style={{ fontWeight: 600 }}>Order #1042</span> — Tally voucher synced.
                </div>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="feature-card-teal">
                <h3 className="display" style={{ fontSize: 18, margin: "0 0 8px" }}>Scan</h3>
                <div style={whiteChip}>
                  <label style={{ fontSize: 13, fontWeight: 500 }}>Scan barcode</label>
                  <input className="input-control" placeholder="Scan or enter barcode" readOnly value="" aria-label="scan input" style={{ marginTop: 8 }} />
                  <div style={{ marginTop: 12 }}>
                    <button type="button" className="btn-on-color">Confirm</button>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="feature-card-lavender">
                <h3 className="display" style={{ fontSize: 18, margin: "0 0 8px" }}>Reconcile</h3>
                <div style={whiteChip}>
                  <span style={{ fontWeight: 600 }}>2 open exceptions</span> — mismatches flagged before they hit accounting.
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Product band: cream card + side copy */}
      <section id="product" style={{ ...sectionPad, background: "var(--canvas)" }}>
        <div className="container hero-grid">
          <Reveal>
            <div className="content-card">
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--hairline)", fontSize: 14 }}>
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>Missing return scan — #2091</span>
                <span className="badge-pill">High severity</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontSize: 14 }}>
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>Duplicate dispatch — #2088</span>
                <span className="badge-pill">Medium severity</span>
              </div>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <h2 className="display" style={{ fontSize: 40, margin: 0 }}>Exceptions, resolved</h2>
            <p style={{ color: "var(--body)", fontSize: 18, marginTop: 16 }}>
              Every mismatch between Shopify, scans, and Tally surfaces in one queue with severity, history, and one-click resolution.
            </p>
            <div style={{ marginTop: 24 }}>
              <Link href="/exceptions" className="btn-primary">
                View exceptions
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* How it works 3-up: peach / ochre / cream */}
      <section id="resources" style={sectionPad}>
        <div className="container">
          <Reveal>
            <h2 className="display" style={{ fontSize: 32, margin: 0 }}>How it works</h2>
          </Reveal>
          <div className="grid-3" style={{ marginTop: 32 }}>
            <Reveal delay={0}>
              <div className="feature-card-peach">
                <h3 className="display" style={{ fontSize: 18, margin: "0 0 8px" }}>1. Connect</h3>
                <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>Link Shopify and Tally; orders flow into one ledger automatically.</p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="feature-card-ochre">
                <h3 className="display" style={{ fontSize: 18, margin: "0 0 8px" }}>2. Scan</h3>
                <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>Validate every dispatch and return at the station with a 44px scan flow.</p>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="feature-card-cream">
                <h3 className="display" style={{ fontSize: 18, margin: "0 0 8px" }}>3. Close</h3>
                <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>Resolve exceptions and close month-end in hours, not days.</p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Testimonials 3-up cream cards, 36px pastel avatars */}
      <section id="customers" style={sectionPad}>
        <div className="container">
          <Reveal>
            <h2 className="display" style={{ fontSize: 32, margin: 0 }}>Loved by operators</h2>
          </Reveal>
          <div className="grid-3" style={{ marginTop: 32 }}>
            {[
              { name: "Ops lead", avatarBg: "var(--brand-peach)", quote: "Returns finally match Tally." },
              { name: "Warehouse mgr", avatarBg: "var(--brand-mint)", quote: "Scans catch errors same-day." },
              { name: "Accountant", avatarBg: "var(--brand-lavender)", quote: "Month-end closes in hours." },
            ].map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <div className="feature-card-cream">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 36, height: 36, borderRadius: "50%", background: t.avatarBg, color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>
                      {t.name[0]}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{t.name}</span>
                  </div>
                  <p style={{ marginTop: 12, marginBottom: 0, fontSize: 14, color: "var(--ink)" }}>{t.quote}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing: white tiers + featured teal tier */}
      <section id="pricing" style={{ ...sectionPad, background: "var(--canvas)" }}>
        <div className="container">
          <Reveal>
            <h2 className="display" style={{ fontSize: 32, margin: 0 }}>Pricing</h2>
          </Reveal>
          <div className="grid-4 pricing-grid" style={{ marginTop: 32 }}>
            {[
              { name: "Starter", blurb: "Starter plan for Shopify ops.", features: ["1 store", "Dispatch scans", "Email support"], featured: false },
              { name: "Growth", blurb: "Growth plan for Shopify ops.", features: ["3 stores", "Returns flow", "Tally sync"], featured: false },
              { name: "Teams", blurb: "Featured plan for growing ops.", features: ["10 stores", "Exceptions queue", "Priority support"], featured: true },
              { name: "Enterprise", blurb: "Enterprise plan for Shopify ops.", features: ["Unlimited stores", "SSO + audit", "Dedicated CSM"], featured: false },
            ].map((p) => (
              <Reveal key={p.name} delay={0}>
                <div
                  className={p.featured ? "feature-card-teal" : undefined}
                  style={
                    p.featured
                      ? undefined
                      : { background: "var(--on-primary)", border: "1px solid var(--hairline)", borderRadius: 24, padding: 32, color: "var(--ink)" }
                  }
                >
                  <div className="display" style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</div>
                  <p style={p.featured ? { ...whiteChip, fontSize: 14 } : { fontSize: 14, color: "var(--muted)" }}>{p.blurb}</p>
                  <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 8 }}>
                    {p.features.map((f) => (
                      <li
                        key={f}
                        style={
                          p.featured
                            ? { ...whiteChip, fontSize: 13 }
                            : { fontSize: 13, color: "var(--ink)" }
                        }
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA illustrated band: soft 24px, 80px padding + mascot + primary CTA */}
      <section style={sectionPad}>
        <div className="container">
          <Reveal>
            <div className="cta-band-illustrated" style={{ background: "var(--soft)", border: "1px solid var(--hairline)", borderRadius: 24, padding: 80, textAlign: "center" }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "var(--brand-ochre)",
                  color: "var(--ink)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                R
              </span>
              <h2 className="display" style={{ fontSize: 32, margin: "16px 0 0" }}>Start reconciling today</h2>
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
