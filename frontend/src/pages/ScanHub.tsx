import React from "react";
import { Link } from "react-router-dom";
import { Card, Badge, buttonVariants } from "../components/primitives";
import { IconTruck, IconBox, IconRefund, IconSpark } from "../components/icons";
import { cn } from "@/lib/utils";

const stations = [
  {
    href: "/scan/dispatch",
    title: "Dispatch Station",
    tag: "Outbound",
    badgeVariant: "default" as const,
    desc: "Scan parcels out for delivery, verify courier AWB assignments, and trigger fulfillment sync.",
    icon: IconTruck,
    shortcut: "D",
    action: "Open Dispatch &rarr;",
  },
  {
    href: "/scan/return",
    title: "Customer Returns",
    tag: "Inbound",
    badgeVariant: "secondary" as const,
    desc: "Scan customer returns, inspect item condition, and flag refund authorization workflows.",
    icon: IconRefund,
    shortcut: "R",
    action: "Open Returns &rarr;",
  },
  {
    href: "/scan/rto",
    title: "RTO Intake",
    tag: "Carrier Return",
    badgeVariant: "outline" as const,
    desc: "Record courier RTO non-delivery return events, log parcel state, and reverse in-transit tracking.",
    icon: IconBox,
    shortcut: "T",
    action: "Open RTO Intake &rarr;",
  },
];

export default function ScanHubPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-8 bg-background px-6 py-6 max-[480px]:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold text-2xl sm:text-3xl tracking-tight text-foreground">
              Scan Hub
            </h1>
            <Badge variant="secondary" className="text-xs">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
              Scanner Ready
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Choose a warehouse scanning station. All stations support handheld USB/Bluetooth scanners, mobile cameras, and manual keyboard entry.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono">
            Focus shortcut: <kbd className="font-semibold text-foreground bg-muted px-1 py-0.5 rounded ml-1">/</kbd>
          </Badge>
        </div>
      </div>

      {/* 3 Station Cards Grid */}
      <div className="grid grid-cols-1 gap-6 min-[1025px]:grid-cols-3">
        {stations.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} to={s.href} className="group block focus-visible:outline-none">
              <Card className="h-full flex flex-col justify-between p-7 transition-all duration-300 group-hover:border-primary/50 group-hover:shadow-lg group-hover:-translate-y-1 relative overflow-hidden">
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex size-13 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 transition-transform duration-300 group-hover:scale-105">
                      <Icon size={26} />
                    </div>
                    <Badge variant={s.badgeVariant} className="text-xs font-semibold">
                      {s.tag}
                    </Badge>
                  </div>

                  <h2 className="text-xl font-heading font-bold tracking-tight text-foreground mb-2 group-hover:text-primary transition-colors">
                    {s.title}
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {s.desc}
                  </p>
                </div>

                <div className="mt-8 pt-4 border-t border-border flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary font-heading">
                    {s.action}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    Code128 • ZXing
                  </span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Operational Note Footer */}
      <Card className="p-4 bg-muted/30 border-border/70 flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="text-primary shrink-0">
            <IconSpark size={16} />
          </span>
          <span>
            Camera scanning requires HTTPS or localhost and a rear-facing camera for optimal Code128 reading. Handheld USB/Bluetooth scanners work plug-and-play across all stations.
          </span>
        </div>
      </Card>
    </div>
  );
}
