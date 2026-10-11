import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Badge } from "../components/primitives";
import {
  IconBox,
  IconChevronLeft,
  IconCoin,
  IconReturn,
  IconSearch,
  IconTruck,
  IconWarning,
} from "../components/icons";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="page-shell flex min-h-[75vh] flex-col items-center justify-center py-12 px-4 text-center">
      <div className="relative mx-auto flex w-full max-w-xl flex-col items-center">
        {/* Subtle decorative glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-12 size-64 rounded-full bg-primary/10 blur-3xl dark:bg-primary/20"
        />

        <Card className="relative w-full p-8 sm:p-12 border-border/80 bg-card/90 backdrop-blur-md shadow-xl text-center space-y-6">
          {/* Status Badge */}
          <div className="flex justify-center">
            <Badge
              variant="outline"
              className="px-3.5 py-1 text-xs font-mono font-semibold text-primary border-primary/30 bg-primary/5 flex items-center gap-1.5"
            >
              <IconWarning size={13} />
              <span>404 · Page Not Located</span>
            </Badge>
          </div>

          {/* Heading & Details */}
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-medium font-heading tracking-tight text-foreground">
              Lost in Pipeline
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
              The requested address or record could not be found. It may have been moved, archived, or never existed in the store ledger.
            </p>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={() => navigate(-1)}
              className="gap-2"
            >
              <IconChevronLeft size={15} />
              <span>Go Back</span>
            </Button>

            <Button asChild size="default" className="gap-2">
              <Link to="/orders">
                <IconBox size={15} />
                <span>Orders Directory</span>
              </Link>
            </Button>
          </div>

          {/* Quick Helpful Directory Links */}
          <div className="pt-6 border-t border-border/70 space-y-3">
            <span className="text-[11px] font-bold font-heading uppercase tracking-wider text-muted-foreground block">
              Quick Navigation
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <Link
                to="/dashboard"
                className="p-2.5 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted text-foreground font-medium flex items-center justify-center gap-1.5 transition"
              >
                <IconSearch size={13} className="text-primary" />
                <span>Dashboard</span>
              </Link>
              <Link
                to="/tracking"
                className="p-2.5 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted text-foreground font-medium flex items-center justify-center gap-1.5 transition"
              >
                <IconTruck size={13} className="text-primary" />
                <span>Live Tracking</span>
              </Link>
              <Link
                to="/cod-remittance"
                className="p-2.5 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted text-foreground font-medium flex items-center justify-center gap-1.5 transition col-span-2 sm:col-span-1"
              >
                <IconCoin size={13} className="text-primary" />
                <span>COD Remittance</span>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
