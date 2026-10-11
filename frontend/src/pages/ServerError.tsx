import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Badge } from "../components/primitives";
import {
  IconChevronLeft,
  IconRefresh,
  IconWarning,
  IconChart,
} from "../components/icons";

export default function ServerError() {
  const navigate = useNavigate();

  return (
    <div className="page-shell flex min-h-[75vh] flex-col items-center justify-center py-12 px-4 text-center">
      <div className="relative mx-auto flex w-full max-w-xl flex-col items-center">
        {/* Subtle decorative glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-12 size-64 rounded-full bg-destructive/10 blur-3xl dark:bg-destructive/20"
        />

        <Card className="relative w-full p-8 sm:p-12 border-border/80 bg-card/90 backdrop-blur-md shadow-xl text-center space-y-6">
          {/* Status Badge */}
          <div className="flex justify-center">
            <Badge
              variant="destructive"
              className="px-3.5 py-1 text-xs font-mono font-semibold flex items-center gap-1.5"
            >
              <IconWarning size={13} />
              <span>500 · Server Discrepancy</span>
            </Badge>
          </div>

          {/* Heading & Details */}
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-medium font-heading tracking-tight text-foreground">
              Internal Processing Error
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
              Our synchronization engine encountered an unexpected event while processing this financial ledger request. All underlying order data remains safe and encrypted.
            </p>
          </div>

          {/* Diagnostic Code */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/60 border border-border/70 font-mono text-xs text-muted-foreground">
            <span>Reference:</span>
            <span className="font-semibold text-foreground">ERR-500-SRV-LIV-092</span>
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
              <span>Retry Request</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={() => navigate("/dashboard")}
              className="gap-2"
            >
              <IconChevronLeft size={15} />
              <span>Return to Dashboard</span>
            </Button>
          </div>

          {/* System Telemetry Note */}
          <div className="pt-6 border-t border-border/70 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <IconChart size={14} className="text-status-success" />
            <span>Telemetry logging active · Engineering notified</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
