import React from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription } from "../components/primitives";
import { IconTruck, IconBox, IconRefund } from "../components/icons";

const stations = [
  {
    href: "/scan/dispatch",
    title: "Dispatch Station",
    desc: "Scan parcels out for delivery, verify courier AWB assignments, and trigger fulfillment sync",
    icon: IconTruck,
  },
  {
    href: "/scan/return",
    title: "Customer Returns",
    desc: "Scan customer returns, inspect item condition, and flag refund authorization workflows",
    icon: IconRefund,
  },
  {
    href: "/scan/rto",
    title: "RTO Intake",
    desc: "Record courier RTO non-delivery return events, log parcel state, and reverse in-transit tracking",
    icon: IconBox,
  },
];

export default function ScanHubPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 bg-background px-6 py-6 max-[480px]:px-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Scan Hub</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a warehouse scanning station. All stations support handheld USB/Bluetooth scanners, mobile cameras, and manual keyboard entry.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 min-[1025px]:grid-cols-3">
        {stations.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} to={s.href} className="group transition-transform hover:-translate-y-1">
              <Card className="h-full flex flex-col items-center justify-center p-6 text-center transition-all group-hover:border-primary/50 group-hover:bg-muted/20 group-hover:shadow-md">
                <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon size={24} />
                </div>
                <h2 className="text-lg font-bold tracking-tight text-foreground mb-2">{s.title}</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </Card>
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Note: camera scanning requires HTTPS or localhost and a rear-facing camera for optimal Code128 reading.
      </p>
    </div>
  );
}
