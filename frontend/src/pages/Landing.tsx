import React from "react";
import { Link } from "react-router-dom";
import Reveal from "../components/Reveal";
import Footer from "../components/Footer";
import HeroSection from "../components/HeroSection";
import {
  Badge,
  Card,
  buttonVariants,
} from "../components/primitives";
import { IconTruck, IconTag, IconReceipt, IconAlert } from "../components/icons";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: <IconTruck size={22} />,
    title: "Real-time Order & Voucher Sync",
    badge: "Automated",
    body: "Every Shopify order converts automatically into a balanced sales voucher and customer ledger in Tally ERP9 / Prime.",
    highlight: "Order #1042 — Tally voucher synced (₹4,250)",
  },
  {
    icon: <IconTag size={22} />,
    title: "High-Speed Station Scanning",
    badge: "Zero Latency",
    body: "Validate every dispatch, carrier AWB, and customer return at warehouse stations with audio cues and instant barcode checks.",
    highlight: "AWB #SP-99214 — Dispatched via ShipSagar",
  },
  {
    icon: <IconReceipt size={22} />,
    title: "Automated Exception Resolution",
    badge: "Smart Audit",
    body: "Flag remittance variances, duplicate parcels, and pending returns before they impact financial close. Clear issues in 1 click.",
    highlight: "2 open exceptions flagged • Zero balance drift",
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

const tiers = [
  {
    name: "Starter",
    blurb: "For a single Shopify store getting scans and shipments in order.",
    price: "Free",
    period: "forever",
    features: [
      "1 store connected",
      "Dispatch barcode scans",
      "ShipSagar & India Post tracking",
      "Email support & documentation",
    ],
    featured: false,
    cta: "Sign up free",
  },
  {
    name: "Growth",
    blurb: "For growing ops with returns, exception routing, and Tally sync.",
    price: "Most popular",
    period: "flexible billing",
    features: [
      "3 stores connected",
      "Full returns & RTO scan flow",
      "Direct Tally XML sync",
      "Exception clearance alerts",
      "Priority email & WhatsApp support",
    ],
    featured: true,
    cta: "Start 14-day free trial",
  },
  {
    name: "Enterprise",
    blurb: "For multi-store ops with audit trails, custom ERPs, and SSO.",
    price: "Custom",
    period: "tailored billing",
    features: [
      "Unlimited stores & stations",
      "SSO & immutable audit logs",
      "Custom ERP integration (SAP, Oracle)",
      "Dedicated CSM & 99.99% SLA",
    ],
    featured: false,
    cta: "Contact Ops",
  },
];

const testimonials = [
  {
    name: "Priya Sharma",
    role: "Head of Operations • D2C Apparel",
    initials: "PS",
    quote: "Returns finally match Tally without three days of spreadsheet cross-checking. The station scan flow caught 40+ duplicate labels in the first month alone.",
    stat: "65,000 orders/mo",
  },
  {
    name: "Vikram Patel",
    role: "Warehouse Director • Electronics Hub",
    initials: "VP",
    quote: "Our packers love the barcode scanner interface. It's lightning fast, beeps on correct scans, and halts whenever a duplicate AWB is scanned.",
    stat: "99.98% scan accuracy",
  },
  {
    name: "Ananya Roy",
    role: "Financial Controller & CA",
    initials: "AR",
    quote: "Month-end close used to take 5 days. With ReconHub's direct Tally XML voucher export, our books reconcile in less than two hours.",
    stat: "Month-close in 2 hrs",
  },
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

      {/* Features 3-up (Solutions) */}
      <section id="solutions" className="py-20 lg:py-24 bg-background border-b border-border">
        <div className="mx-auto w-full max-w-[1280px] px-6 sm:px-8 max-[480px]:px-4">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <Reveal>
              <Badge variant="secondary" className="mb-3 px-3 py-1 text-xs uppercase tracking-wider font-semibold">
                Reconciliation Engine
              </Badge>
              <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-bold font-heading tracking-tight text-foreground leading-[1.12]">
                Everything reconciled without spreadsheets
              </h2>
              <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
                Connect Shopify storefronts, warehouse dispatch scans, courier returns, and Tally accounting into one seamless operational loop.
              </p>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 100}>
                <Card className="h-full p-7 flex flex-col justify-between transition-all duration-300 hover:shadow-lg hover:border-primary/40 group">
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-6">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 transition-transform duration-300 group-hover:scale-105">
                        {f.icon}
                      </span>
                      <Badge variant="outline" className="text-xs font-medium">
                        {f.badge}
                      </Badge>
                    </div>
                    <h3 className="text-xl font-bold font-heading tracking-tight text-foreground mb-2.5">
                      {f.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {f.body}
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-border/70 bg-muted/30 -mx-7 -mb-7 p-4 px-7 rounded-b-xl">
                    <span className="text-xs font-mono text-foreground/80 flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-primary" />
                      {f.highlight}
                    </span>
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Product band */}
      <section id="product" className="py-20 lg:py-28 bg-muted/20 border-b border-border">
        <div className="mx-auto grid w-full max-w-[1280px] items-center gap-12 px-6 sm:px-8 lg:grid-cols-[6fr_6fr] max-[480px]:px-4">
          {/* Left: Exception Queue & Resolution UI Simulator */}
          <Reveal>
            <Card className="p-6 sm:p-7 shadow-lg border-border/90 bg-card overflow-hidden">
              <div className="flex items-center justify-between pb-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive font-bold text-xs">
                    !
                  </span>
                  <div>
                    <h3 className="font-heading font-bold text-sm text-foreground">
                      Exception Resolution Queue
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Automated discrepancy flags • Real-time
                    </p>
                  </div>
                </div>
                <Badge variant="destructive" className="font-semibold text-xs">
                  2 Open Flags
                </Badge>
              </div>

              <div className="mt-4 flex flex-col gap-3.5">
                {/* Exception 1 */}
                <div className="p-4 rounded-xl border border-destructive/20 bg-destructive/5 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-foreground">
                      Missing return scan — #2091
                    </span>
                    <Badge variant="destructive" className="text-[11px] font-medium">
                      High severity
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Courier tracking shows delivered to warehouse 3 days ago. Station intake scan pending.
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      AWB: IP9931821IN
                    </span>
                    <Link
                      to="/scan/return"
                      className={cn(buttonVariants({ size: "xs" }), "h-7 px-3 text-xs")}
                    >
                      Intake Scan
                    </Link>
                  </div>
                </div>

                {/* Exception 2 */}
                <div className="p-4 rounded-xl border border-warning/20 bg-warning/5 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-foreground">
                      Duplicate dispatch — #2088
                    </span>
                    <Badge variant="secondary" className="bg-warning/15 text-foreground text-[11px] font-medium">
                      Medium severity
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Parcel already marked dispatched on packing table 2. Secondary barcode scan blocked.
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      Prevented ₹2,450 double-ship
                    </span>
                    <Link
                      to="/exceptions"
                      className={cn(buttonVariants({ variant: "outline", size: "xs" }), "h-7 px-3 text-xs")}
                    >
                      Review
                    </Link>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  Auto-reconciliation active
                </span>
                <span className="font-mono text-[11px]">Audit: Immutable</span>
              </div>
            </Card>
          </Reveal>

          {/* Right: Description & Action */}
          <Reveal delay={120}>
            <div className="flex flex-col justify-center">
              <Badge variant="secondary" className="mb-3 px-3 py-1 text-xs uppercase tracking-wider font-semibold w-fit">
                Exception Clearance
              </Badge>
              <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-bold font-heading tracking-tight text-foreground leading-[1.12]">
                Zero ledger discrepancies before month-end
              </h2>
              <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
                Every mismatch between Shopify checkouts, warehouse station scans, and Tally vouchers surfaces in one queue with severity rankings, operator timestamps, and 1-click resolution.
              </p>

              <div className="mt-6 flex flex-col gap-3">
                {[
                  "Instant duplicate dispatch detection halts double-shipping at the packing station",
                  "Automated return scan reconciliation matches courier AWB with warehouse intake",
                  "Direct Tally XML reversal vouchers created when orders are cancelled or returned",
                ].map((pt) => (
                  <div key={pt} className="flex items-start gap-2.5 text-sm text-foreground">
                    <span className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">
                      ✓
                    </span>
                    <span>{pt}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap gap-3.5">
                <Link to="/exceptions" className={buttonVariants({ size: "lg" })}>
                  View exceptions queue &rarr;
                </Link>
                <Link to="/scan" className={buttonVariants({ variant: "outline", size: "lg" })}>
                  Open Scan Hub
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Workflow band (Resources) */}
      <section id="resources" className="py-20 lg:py-24 bg-background border-b border-border">
        <div className="mx-auto w-full max-w-[1280px] px-6 sm:px-8 max-[480px]:px-4">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <Reveal>
              <Badge variant="secondary" className="mb-3 px-3 py-1 text-xs uppercase tracking-wider font-semibold">
                Simple 3-Step Workflow
              </Badge>
              <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-bold font-heading tracking-tight text-foreground leading-[1.12]">
                How ReconHub works
              </h2>
              <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
                From customer checkout to verified Tally balance sheet in three connected steps.
              </p>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                n: "01",
                title: "Connect & Ingest",
                badge: "OAuth 2.0",
                body: "Link your Shopify store, ShipSagar API, and Tally export destination. Historical and live orders ingest automatically.",
                sub: "Sub-second webhook listeners",
              },
              {
                n: "02",
                title: "Scan & Validate",
                badge: "Zero Errors",
                body: "Staff scan tracking barcodes at warehouse dispatch and return stations. System halts duplicates and validates weights.",
                sub: "Audio telemetry + instant beep",
              },
              {
                n: "03",
                title: "Reconcile & Close",
                badge: "Audit Ready",
                body: "Reconcile courier COD & remittance against bank statements. Generate balanced Tally vouchers and close month-end in hours.",
                sub: "1-Click XML export",
              },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <Card className="h-full p-7 flex flex-col justify-between transition-all duration-300 hover:shadow-lg hover:border-primary/40 relative group">
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <span className="size-11 rounded-2xl bg-primary/10 text-primary font-bold font-heading text-base flex items-center justify-center border border-primary/20">
                        {s.n}
                      </span>
                      <Badge variant="secondary" className="text-xs font-semibold">
                        {s.badge}
                      </Badge>
                    </div>
                    <h3 className="text-xl font-bold font-heading tracking-tight text-foreground mb-2.5">
                      {s.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {s.body}
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono text-primary font-medium">{s.sub}</span>
                    <span className="size-1.5 rounded-full bg-primary" />
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials (Customers) */}
      <section id="customers" className="py-20 lg:py-24 bg-muted/20 border-b border-border">
        <div className="mx-auto w-full max-w-[1280px] px-6 sm:px-8 max-[480px]:px-4">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <Reveal>
              <Badge variant="secondary" className="mb-3 px-3 py-1 text-xs uppercase tracking-wider font-semibold">
                Real Merchant Impact
              </Badge>
              <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-bold font-heading tracking-tight text-foreground leading-[1.12]">
                Loved by operations &amp; finance teams
              </h2>
              <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
                See how high-growth Shopify merchants eliminated reconciliation headaches and duplicate shipping.
              </p>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <Card className="h-full p-7 flex flex-col justify-between transition-all duration-300 hover:shadow-lg hover:border-primary/40 group">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex text-amber-500 text-sm tracking-widest" aria-label="5 stars">
                        ★★★★★
                      </div>
                      <Badge variant="outline" className="text-[11px] font-mono">
                        {t.stat}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed italic mb-6">
                      "{t.quote}"
                    </p>
                  </div>

                  <div className="pt-4 border-t border-border flex items-center gap-3.5">
                    <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs border border-primary/20">
                      {t.initials}
                    </span>
                    <div>
                      <div className="font-bold text-foreground text-sm font-heading">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.role}</div>
                    </div>
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing 3-up */}
      <section id="pricing" className="py-20 lg:py-24 bg-background border-b border-border">
        <div className="mx-auto w-full max-w-[1280px] px-6 sm:px-8 max-[480px]:px-4">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <Reveal>
              <Badge variant="secondary" className="mb-3 px-3 py-1 text-xs uppercase tracking-wider font-semibold">
                Simple Pricing
              </Badge>
              <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-bold font-heading tracking-tight text-foreground leading-[1.12]">
                Transparent plans for every scale
              </h2>
              <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
                Start free, scale as your shipment volume grows. No hidden transaction surcharges.
              </p>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 items-stretch">
            {tiers.map((p) => (
              <Reveal key={p.name} delay={0}>
                <Card
                  className={`h-full p-8 flex flex-col justify-between transition-all duration-300 ${
                    p.featured
                      ? "border-2 border-primary ring-2 ring-primary/20 shadow-xl bg-card relative"
                      : "hover:shadow-md hover:border-border/90"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xl font-bold font-heading text-foreground">{p.name}</span>
                      {p.featured && (
                        <Badge variant="default" className="bg-primary text-primary-foreground font-semibold text-xs">
                          Most popular
                        </Badge>
                      )}
                    </div>

                    <div className="mb-4">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-4xl font-bold font-heading tracking-tight text-foreground">{p.price}</span>
                        <span className="text-xs text-muted-foreground font-medium">/ {p.period}</span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{p.blurb}</p>
                    </div>

                    <div className="mt-6 pt-6 border-t border-border">
                      <span className="text-xs font-semibold uppercase tracking-wider text-foreground block mb-3">
                        What's included:
                      </span>
                      <ul className="flex flex-col gap-2.5">
                        {p.features.map((f) => (
                          <li key={f} className="flex items-center gap-2.5 text-xs sm:text-sm text-foreground/90">
                            <span className="size-4 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-bold">
                              ✓
                            </span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-8 pt-6 border-t border-border">
                    <Link
                      to="/dashboard"
                      className={cn(
                        buttonVariants({
                          variant: p.featured ? "default" : "outline",
                          size: "lg",
                        }),
                        "w-full font-semibold",
                        p.featured && "shadow-md",
                      )}
                    >
                      {p.cta}
                    </Link>
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="py-20 lg:py-24 bg-muted/20">
        <div className="mx-auto w-full max-w-[1280px] px-6 sm:px-8 max-[480px]:px-4">
          <Reveal>
            <Card className="p-10 sm:p-16 text-center bg-card border-border shadow-xl relative overflow-hidden">
              <div
                className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 size-96 rounded-full bg-primary/10 blur-[100px]"
                aria-hidden="true"
              />
              <div className="relative z-10 max-w-2xl mx-auto">
                <Badge variant="secondary" className="mb-4 px-3 py-1 text-xs uppercase tracking-wider font-semibold">
                  Instant Setup
                </Badge>
                <h2 className="text-3xl sm:text-4xl lg:text-[44px] font-bold font-heading tracking-tight text-foreground leading-[1.12]">
                  Start reconciling orders today
                </h2>
                <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
                  Connect your Shopify store in minutes, catch duplicate dispatch scans immediately, and close your month-end accounting on time.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                  <Link to="/dashboard" className={cn(buttonVariants({ size: "lg" }), "px-8 shadow-md")}>
                    Sign up free &rarr;
                  </Link>
                  <Link to="/orders" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-8")}>
                    View Live Orders Table
                  </Link>
                </div>
                <div className="mt-8 pt-6 border-t border-border/60 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-primary" /> Free forever starter plan
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-primary" /> Works with Tally Prime &amp; ERP9
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-primary" /> No credit card required
                  </span>
                </div>
              </div>
            </Card>
          </Reveal>
        </div>
      </section>

      <Footer />
    </>
  );
}
