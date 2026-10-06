import React from "react";
import { Link } from "react-router-dom";
import Reveal from "../components/Reveal";
import Footer from "../components/Footer";
import HeroSection from "../components/HeroSection";
import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "../components/primitives";
import { IconTruck, IconTag, IconReceipt, IconAlert } from "../components/icons";

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
  {
    value: "128,400",
    label: "Orders Synced",
    subtext: "Automated from Shopify stores",
    badge: "+18.4% MoM",
    badgeVariant: "success" as const,
    icon: <IconTruck size={20} />,
  },
  {
    value: "96,210",
    label: "Parcels Scanned",
    subtext: "Dispatches & returns verified",
    badge: "99.2% on-time",
    badgeVariant: "secondary" as const,
    icon: <IconTag size={20} />,
  },
  {
    value: "12,840",
    label: "Exceptions Resolved",
    subtext: "Zero backlog before month-close",
    badge: "Auto-cleared",
    badgeVariant: "outline" as const,
    icon: <IconAlert size={20} />,
  },
  {
    value: "99.98%",
    label: "Export Accuracy",
    subtext: "Direct ledger vouchers in Tally",
    badge: "Tally Verified",
    badgeVariant: "success" as const,
    icon: <IconReceipt size={20} />,
  },
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
      {/* Brand Hero Section matching reference */}
      <HeroSection />

      {/* Metric strip - Modern B2B SaaS Performance Grid */}
      <section className="relative border-b border-border bg-muted/30 py-12 lg:py-16">
        <div className="mx-auto w-full max-w-[1280px] px-6 sm:px-8 max-[480px]:px-4">
          <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Platform Scale &amp; Performance
              </p>
              <h2 className="text-xl sm:text-2xl font-bold font-heading tracking-tight text-foreground mt-1">
                Real-time operational scale
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-sm">
              Continuous live sync across all connected Shopify storefronts, courier hubs, and accounting ledgers.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((m, i) => (
              <Reveal key={m.label} delay={i * 80}>
                <Card className="h-full p-6 flex flex-col justify-between transition-all duration-300 hover:shadow-md hover:border-primary/40 group">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/15 transition-transform duration-300 group-hover:scale-105">
                        {m.icon}
                      </span>
                      <Badge variant={m.badgeVariant} className="text-[11px] font-medium">
                        {m.badge}
                      </Badge>
                    </div>

                    <div className="mt-5">
                      <div className="tabular-nums font-heading font-bold text-3xl sm:text-[32px] tracking-tight text-foreground">
                        {m.value}
                      </div>
                      <div className="text-sm font-semibold text-foreground mt-1">
                        {m.label}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {m.subtext}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live telemetry
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">24/7 Sync</span>
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Features 3-up */}
      <section id="solutions" className="py-20 lg:py-24 bg-background">
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <h2 className="font-bold tracking-tight text-foreground text-3xl sm:text-4xl">Everything reconciled</h2>
            <p className="mt-3 text-base text-muted-foreground">Orders, scans, returns, and Tally vouchers stay in sync.</p>
          </Reveal>
          <div className="mt-8 grid grid-cols-1 gap-6 min-[769px]:grid-cols-2 min-[1025px]:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 100}>
                <Card className="h-full p-6">
                  <span className="inline-flex size-10 items-center justify-center rounded-xl bg-muted text-foreground">
                    {f.icon}
                  </span>
                  <h3 className="mt-4 mb-2 font-bold tracking-tight text-foreground text-lg">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Product band */}
      <section id="product" className="py-20 lg:py-24 bg-muted/40 border-y border-border">
        <div className="mx-auto grid w-full max-w-[1280px] items-center gap-10 px-6 min-[769px]:grid-cols-[7fr_5fr] max-[480px]:px-4">
          <Reveal>
            <Card className="p-6">
              <div className="flex items-center justify-between border-b border-border py-3 text-sm">
                <span className="font-semibold text-foreground">Missing return scan — #2091</span>
                <Badge variant="destructive" className="font-medium">High severity</Badge>
              </div>
              <div className="flex items-center justify-between py-3 text-sm">
                <span className="font-semibold text-foreground">Duplicate dispatch — #2088</span>
                <Badge variant="secondary" className="bg-warning/15 text-foreground font-medium">Medium severity</Badge>
              </div>
            </Card>
          </Reveal>
          <Reveal delay={120}>
            <h2 className="font-bold tracking-tight text-foreground text-3xl sm:text-4xl">Exceptions, resolved</h2>
            <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
              Every mismatch between Shopify, scans, and Tally surfaces in one queue with severity, history, and one-click resolution.
            </p>
            <div className="mt-6">
              <Link to="/exceptions" className={buttonVariants({ size: "lg" })}>
                View exceptions
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Workflow band */}
      <section id="resources" className="py-20 lg:py-24 bg-background">
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <h2 className="font-bold tracking-tight text-foreground text-3xl sm:text-4xl">How it works</h2>
          </Reveal>
          <div className="mt-8 grid grid-cols-1 gap-6 min-[769px]:grid-cols-2 min-[1025px]:grid-cols-3">
            {[
              { n: "1", title: "Connect", body: "Link Shopify and Tally; orders flow into one ledger automatically." },
              { n: "2", title: "Scan", body: "Validate every dispatch and return at the station with a fast scan flow." },
              { n: "3", title: "Close", body: "Resolve exceptions and close month-end in hours, not days." },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <Card className="h-full p-6">
                  <span className="tabular-nums inline-flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
                    {s.n}
                  </span>
                  <h3 className="mt-4 mb-2 font-bold tracking-tight text-foreground text-lg">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="customers" className="py-20 lg:py-24 bg-muted/40 border-y border-border">
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <h2 className="font-bold tracking-tight text-foreground text-3xl sm:text-4xl">Loved by operators</h2>
          </Reveal>
          <div className="mt-8 grid grid-cols-1 gap-6 min-[769px]:grid-cols-2 min-[1025px]:grid-cols-3">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <Card className="h-full p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-full bg-muted font-bold text-xs text-foreground">
                      {t.initials}
                    </span>
                    <span className="font-semibold text-foreground text-sm">{t.name}</span>
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground italic leading-relaxed">"{t.quote}"</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing 3-up */}
      <section id="pricing" className="py-20 lg:py-24 bg-background">
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <h2 className="font-bold tracking-tight text-foreground text-3xl sm:text-4xl">Pricing</h2>
            <p className="mt-3 text-base text-muted-foreground">Start free, upgrade when ops grow.</p>
          </Reveal>
          <div className="mt-8 grid grid-cols-1 gap-6 min-[769px]:grid-cols-2 min-[1025px]:grid-cols-3">
            {tiers.map((p) => (
              <Reveal key={p.name} delay={0}>
                <Card
                  className={`h-full p-6 relative flex flex-col justify-between ${
                    p.featured ? "border-2 border-primary ring-1 ring-primary/20 shadow-md" : ""
                  }`}
                >
                  <div>
                    {p.featured && (
                      <Badge variant="secondary" className="mb-3 bg-accent text-accent-foreground font-semibold">
                        Most popular
                      </Badge>
                    )}
                    <div className="font-bold tracking-tight text-foreground text-xl">{p.name}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{p.blurb}</p>
                    <ul className="mt-6 flex flex-col gap-2.5">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-sm text-foreground">
                          <span className="size-1.5 rounded-full bg-primary" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-8 pt-4 border-t border-border">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{p.price}</span>
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="py-20 lg:py-24 bg-muted/40">
        <div className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4">
          <Reveal>
            <Card className="p-12 sm:p-16 text-center bg-card border-border">
              <h2 className="font-bold tracking-tight text-foreground text-3xl sm:text-4xl">Start reconciling today</h2>
              <p className="mt-3 text-base text-muted-foreground">Connect Shopify and close your first exceptions in minutes.</p>
              <div className="mt-6">
                <Link to="/dashboard" className={buttonVariants({ size: "lg" })}>
                  Sign up free
                </Link>
              </div>
            </Card>
          </Reveal>
        </div>
      </section>

      <Footer />
    </>
  );
}
