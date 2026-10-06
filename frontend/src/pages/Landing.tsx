import React from "react";
import { Link } from "react-router-dom";
import Reveal from "../components/Reveal";
import Footer from "../components/Footer";
import { IconTruck, IconTag, IconReceipt } from "../components/icons";

const sectionPad = { padding: "96px 0" };

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 12,
  padding: 24,
  color: "var(--ink)",
};

const h2Style: React.CSSProperties = { fontSize: 32, margin: 0 };
const bodyStyle: React.CSSProperties = { color: "var(--body)", fontSize: 16, marginTop: 16 };

const features = [
  {
    icon: <IconTruck size={20} />,
    title: "Sync",
    body: "Order #1042 — Tally voucher synced.",
  },
  {
    icon: <IconTag size={20} />,
    title: "Scan",
    body: "Validate every dispatch and return at the station with a fast scan flow.",
  },
  {
    icon: <IconReceipt size={20} />,
    title: "Reconcile",
    body: "2 open exceptions — mismatches flagged before they hit accounting.",
  },
];

const metrics = [
  { value: "128,400", label: "Orders synced" },
  { value: "96,210", label: "Parcels scanned" },
  { value: "12,840", label: "Exceptions resolved" },
  { value: "99.98%", label: "Export accuracy" },
];

const ledgerRows = [
  { order: "#1042", status: "Synced", amount: "4,250" },
  { order: "#1041", status: "Synced", amount: "1,980" },
  { order: "#1040", status: "Pending", amount: "3,120" },
  { order: "#1039", status: "Synced", amount: "2,460" },
];

const tiers = [
  { name: "Starter", blurb: "For a single Shopify store getting scans in order.", price: "Free", features: ["1 store", "Dispatch scans", "Email support"], featured: false },
  { name: "Growth", blurb: "For growing ops with returns and Tally sync.", price: "Most popular", features: ["3 stores", "Returns flow", "Tally sync"], featured: true },
  { name: "Enterprise", blurb: "For multi-store ops with audit and SSO.", price: "Custom", features: ["Unlimited stores", "SSO + audit", "Dedicated CSM"], featured: false },
];

const testimonials = [
  { name: "Ops lead", initials: "OL", quote: "Returns finally match Tally." },
  { name: "Warehouse mgr", initials: "WM", quote: "Scans catch errors same-day." },
  { name: "Accountant", initials: "AC", quote: "Month-end closes in hours." },
];

export default function Landing() {
  return (
    <>
      {/* Hero 2-col */}
      <section style={{ background: "var(--canvas)" }}>
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4 grid items-center gap-8 min-[769px]:grid-cols-[7fr_5fr]" style={{ paddingTop: 96, paddingBottom: 96 }}>
          <Reveal>
            <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 16px" }}>
              Shopify reconciliation
            </p>
            <h1 className="font-bold tracking-tight text-[var(--ink)]" style={{ margin: 0, fontSize: 56, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
              Reconciliation for Shopify ops
            </h1>
            <p style={{ color: "var(--body)", fontSize: 18, marginTop: 16, maxWidth: 520 }}>
              Connect Shopify orders, warehouse scans, returns, and Tally accounting in one operational ledger.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <Link to="/dashboard" className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full">
                Sign up free
              </Link>
              <Link to="/#product" className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-2.5 text-sm font-medium border border-[var(--hairline)] bg-white text-[var(--ink)] max-[480px]:w-full">
                See product
              </Link>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5" style={{ padding: 24 }}>
              <div style={{ display: "flex", gap: 24 }}>
                {[
                  { value: "128k", label: "Synced" },
                  { value: "96k", label: "Scanned" },
                  { value: "99.9%", label: "Accuracy" },
                ].map((s) => (
                  <div key={s.label}>
                    <div className="tabular-nums" style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{s.value}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <table className="w-full border-separate border-spacing-0 [&_thead_th]:border-b [&_thead_th]:border-[var(--hairline)] [&_thead_th]:bg-[var(--surface)] [&_thead_th]:px-4 [&_thead_th]:py-3.5 [&_thead_th]:text-left [&_thead_th]:align-middle [&_thead_th]:text-xs [&_thead_th]:font-semibold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.05em] [&_thead_th]:text-[var(--muted)] [&_td]:border-b [&_td]:border-[var(--hairline)] [&_td]:p-4 [&_td]:align-middle [&_td]:text-sm [&_td]:text-[var(--ink)] [&_tbody_tr:hover]:bg-[var(--surface)]" style={{ marginTop: 16 }}>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((r) => (
                    <tr key={r.order}>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{r.order}</td>
                      <td style={{ color: "var(--body)" }}>{r.status}</td>
                      <td className="tabular-nums" style={{ textAlign: "right" }}>{r.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 16 }}>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-[var(--ink)] bg-[var(--success-bg)] text-[var(--ink)]">Sync status: healthy</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Metric strip */}
      <section style={{ borderTop: "1px solid var(--hairline)", borderBottom: "1px solid var(--hairline)", background: "var(--canvas)" }}>
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexWrap: "wrap", gap: 48, paddingTop: 32, paddingBottom: 32 }}>
          {metrics.map((m) => (
            <div key={m.label}>
              <div className="tabular-nums" style={{ fontSize: 28, fontWeight: 600, color: "var(--ink)" }}>{m.value}</div>
              <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features 3-up */}
      <section id="solutions" style={sectionPad}>
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <h2 className="font-bold tracking-tight text-[var(--ink)]" style={h2Style}>Everything reconciled</h2>
            <p style={bodyStyle}>Orders, scans, returns, and Tally vouchers stay in sync.</p>
          </Reveal>
          <div className="grid grid-cols-1 gap-6 min-[769px]:grid-cols-2 min-[1025px]:grid-cols-3" style={{ marginTop: 32 }}>
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 100}>
                <div style={cardStyle}>
                  <span style={{ width: 40, height: 40, borderRadius: 8, background: "var(--neutral-bg)", color: "var(--ink)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    {f.icon}
                  </span>
                  <h3 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: 18, margin: "16px 0 8px" }}>{f.title}</h3>
                  <p style={{ margin: 0, fontSize: 14, color: "var(--body)" }}>{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Product band */}
      <section id="product" style={{ ...sectionPad, background: "var(--surface)" }}>
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4 grid items-center gap-8 min-[769px]:grid-cols-[7fr_5fr]">
          <Reveal>
            <div className="rounded-xl border border-[var(--hairline)] bg-white text-[var(--ink)] p-6 max-[768px]:p-5">
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--hairline)", fontSize: 14 }}>
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>Missing return scan — #2091</span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-[var(--ink)]">High severity</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontSize: 14 }}>
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>Duplicate dispatch — #2088</span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-[var(--ink)]">Medium severity</span>
              </div>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <h2 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: 40, margin: 0 }}>Exceptions, resolved</h2>
            <p style={{ color: "var(--body)", fontSize: 18, marginTop: 16 }}>
              Every mismatch between Shopify, scans, and Tally surfaces in one queue with severity, history, and one-click resolution.
            </p>
            <div style={{ marginTop: 24 }}>
              <Link to="/exceptions" className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full">
                View exceptions
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Workflow band */}
      <section id="resources" style={sectionPad}>
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <h2 className="font-bold tracking-tight text-[var(--ink)]" style={h2Style}>How it works</h2>
          </Reveal>
          <div className="grid grid-cols-1 gap-6 min-[769px]:grid-cols-2 min-[1025px]:grid-cols-3" style={{ marginTop: 32 }}>
            {[
              { n: "1", title: "Connect", body: "Link Shopify and Tally; orders flow into one ledger automatically." },
              { n: "2", title: "Scan", body: "Validate every dispatch and return at the station with a fast scan flow." },
              { n: "3", title: "Close", body: "Resolve exceptions and close month-end in hours, not days." },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <div style={cardStyle}>
                  <span className="tabular-nums" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--neutral-bg)", color: "var(--ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600 }}>
                    {s.n}
                  </span>
                  <h3 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: 18, margin: "16px 0 8px" }}>{s.title}</h3>
                  <p style={{ margin: 0, fontSize: 14, color: "var(--body)" }}>{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="customers" style={sectionPad}>
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <h2 className="font-bold tracking-tight text-[var(--ink)]" style={h2Style}>Loved by operators</h2>
          </Reveal>
          <div className="grid grid-cols-1 gap-6 min-[769px]:grid-cols-2 min-[1025px]:grid-cols-3" style={{ marginTop: 32 }}>
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <div style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--neutral-bg)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13 }}>
                      {t.initials}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{t.name}</span>
                  </div>
                  <p style={{ marginTop: 12, marginBottom: 0, fontSize: 14, color: "var(--body)" }}>{t.quote}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing 3-up */}
      <section id="pricing" style={{ ...sectionPad, background: "var(--surface)" }}>
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <h2 className="font-bold tracking-tight text-[var(--ink)]" style={h2Style}>Pricing</h2>
            <p style={bodyStyle}>Start free, upgrade when ops grow.</p>
          </Reveal>
          <div className="grid grid-cols-1 gap-6 min-[769px]:grid-cols-2 min-[1025px]:grid-cols-3" style={{ marginTop: 32 }}>
            {tiers.map((p) => (
              <Reveal key={p.name} delay={0}>
                <div
                  style={
                    p.featured
                      ? { ...cardStyle, border: "2px solid var(--accent)" }
                      : cardStyle
                  }
                >
                  {p.featured && (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium bg-[var(--neutral-bg)] text-[var(--ink)]" style={{ background: "var(--neutral-bg)", marginBottom: 12 }}>Most popular</span>
                  )}
                  <div className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</div>
                  <p style={{ fontSize: 14, color: "var(--muted)" }}>{p.blurb}</p>
                  <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 8 }}>
                    {p.features.map((f) => (
                      <li key={f} style={{ fontSize: 13, color: "var(--ink)" }}>
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

      {/* CTA band */}
      <section style={sectionPad}>
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 12, padding: 80, textAlign: "center" }}>
              <h2 className="font-bold tracking-tight text-[var(--ink)]" style={{ fontSize: 32, margin: 0 }}>Start reconciling today</h2>
              <p style={{ color: "var(--body)", fontSize: 16, marginTop: 12 }}>Connect Shopify and close your first exceptions in minutes.</p>
              <div style={{ marginTop: 20 }}>
                <Link to="/dashboard" className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-[var(--accent)] text-[var(--on-accent)] active:translate-y-px max-[480px]:w-full">
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
