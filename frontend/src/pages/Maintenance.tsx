import React from "react";
import { Link } from "react-router-dom";
import { Button, Card, Badge } from "../components/primitives";
import {
  IconClock,
  IconRefresh,
  IconTruck,
} from "../components/icons";

export default function Maintenance() {
  return (
    <div className="page-shell flex min-h-[75vh] flex-col items-center justify-center py-12 px-4 text-center">
      <div className="relative mx-auto flex w-full max-w-xl flex-col items-center">
        {/* Subtle decorative glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-12 size-64 rounded-full bg-amber-500/10 blur-3xl dark:bg-amber-500/20"
        />

        <Card className="relative w-full p-8 sm:p-12 border-border/80 bg-card/90 backdrop-blur-md shadow-xl text-center space-y-6">
          {/* Status Badge */}
          <div className="flex justify-center">
            <Badge
              variant="secondary"
              className="px-3.5 py-1 text-xs font-mono font-semibold text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10 flex items-center gap-1.5"
            >
              <IconClock size={13} />
              <span>503 · Platform Maintenance</span>
            </Badge>
          </div>

          {/* Heading & Details */}
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-medium font-heading tracking-tight text-foreground">
              Scheduled Platform Upgrade
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
              We are performing planned database maintenance, multi-courier SLA indexing, and bank settlement ledger optimization. Service will resume shortly.
            </p>
          </div>

          {/* Maintenance Progress & Safety Guarantee */}
          <div className="p-4 rounded-xl border border-border/80 bg-muted/30 text-left space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5 font-heading">
                <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                Database Reconciliation Routine
              </span>
              <span className="font-mono text-muted-foreground">In Progress</span>
            </div>
            {/* Subtle Progress Bar */}
            <div className="w-full h-1.5 rounded-full bg-border/80 overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full w-3/4 animate-pulse" />
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              All incoming Shopify orders are safely queued and will sync automatically upon system resumption. Zero data loss guaranteed.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              variant="default"
              size="default"
              onClick={() => window.location.reload()}
              className="gap-2"
            >
              <IconRefresh size={15} />
              <span>Check Status</span>
            </Button>

            <Button asChild variant="outline" size="default" className="gap-2">
              <Link to="/tracking">
                <IconTruck size={15} />
                <span>External Tracking</span>
              </Link>
            </Button>
          </div>

          {/* Support Contacts */}
          <div className="pt-6 border-t border-border/70 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Questions or urgent inquiries?</span>
            <span className="font-mono text-muted-foreground">support@reconhub.internal</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
