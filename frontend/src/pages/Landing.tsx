import React from "react";
import { Link } from "react-router-dom";
import Reveal from "../components/Reveal";
import Footer from "../components/Footer";
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
import { IconTruck, IconTag, IconReceipt } from "../components/icons";

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
      <section className="bg-background py-20 lg:py-24">
        <div className="mx-auto grid w-full max-w-[1280px] items-center gap-12 px-6 min-[769px]:grid-cols-[7fr_5fr] max-[480px]:px-4">
          <Reveal>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Shopify reconciliation
            </p>
            <h1 className="font-bold tracking-tight text-foreground text-4xl sm:text-5xl lg:text-[56px] leading-[1.05] tracking-[-0.02em]">
              Reconciliation for Shopify ops
            </h1>
            <p className="mt-4 max-w-[520px] text-lg text-muted-foreground leading-relaxed">
              Connect Shopify orders, warehouse scans, returns, and Tally accounting in one operational ledger.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/dashboard" className={buttonVariants({ size: "lg" })}>
                Sign up free
              </Link>
              <Link to="/#product" className={buttonVariants({ variant: "outline", size: "lg" })}>
                See product
              </Link>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <Card className="p-6">
              <div className="flex gap-6 pb-4">
                {[
                  { value: "128k", label: "Synced" },
                  { value: "96k", label: "Scanned" },
                  { value: "99.9%", label: "Accuracy" },
                ].map((s) => (
                  <div key={s.label}>
                    <div className="tabular-nums font-semibold text-xl text-foreground">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerRows.map((r) => (
                      <TableRow key={r.order}>
                        <TableCell className="font-semibold">{r.order}</TableCell>
                        <TableCell>{r.status}</TableCell>
                        <TableCell className="tabular-nums text-right font-medium">{r.amount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4">
                <Badge variant="secondary" className="bg-success/15 text-foreground font-medium">
                  Sync status: healthy
                </Badge>
              </div>
            </Card>
          </Reveal>
        </div>
      </section>

      {/* Metric strip */}
      <section className="border-y border-border bg-card py-8">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap gap-12 px-6 max-[480px]:px-4">
          {metrics.map((m) => (
            <div key={m.label}>
              <div className="tabular-nums text-2xl sm:text-3xl font-bold text-foreground">{m.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{m.label}</div>
            </div>
          ))}
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
