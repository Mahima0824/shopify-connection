import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import SeverityBadge from "../components/SeverityBadge";
import { IconAlert } from "../components/icons";
import {
  Badge,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "../components/primitives";

type Issue = {
  id: string;
  order_id: string;
  order_name: string | null;
  issue_code: string;
  severity: string;
  issue_message: string;
  resolved: boolean;
  detected_at: string | null;
};

export default function ExceptionsPage() {
  const [items, setItems] = useState<Issue[]>([]);
  const [status, setStatus] = useState("OPEN");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [resolving, setResolving] = useState<Issue | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token") ?? undefined;
      const q = new URLSearchParams({ status, ...(severity ? { severity } : {}), ...(category ? { category } : {}) });
      const data = await api<{ items: Issue[] }>(`/api/v1/reconciliation/issues?${q}`, {}, token);
      setItems(data.items ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status, severity, category]);

  async function doResolve() {
    if (!reason.trim()) return;
    try {
      const token = localStorage.getItem("token") ?? undefined;
      await api(
        `/api/v1/reconciliation/issues/${resolving!.id}/resolve`,
        { method: "POST", body: JSON.stringify({ reason: reason.trim() }) },
        token
      );
      setResolving(null);
      setReason("");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl sm:text-3xl font-bold font-heading tracking-tight text-foreground">
              Mismatch Exceptions Queue
            </h1>
            <Badge variant="destructive" className="text-xs">
              Audit Clearance
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and audit system-detected operational discrepancies between Shopify, physical scans, and returns
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono">
            {items.length} {status.toLowerCase()} issue{items.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      {/* Filter Tabs Bar */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        {/* Status Filter Tabs */}
        <div className="flex gap-2">
          {(["OPEN", "RESOLVED", "ALL"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className="text-xs font-semibold px-3.5 h-8"
            >
              {s}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* Severity Select Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SEVERITY:</label>
            <select
              className="h-9 w-36 rounded-lg border border-input bg-background/90 px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 shadow-xs"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              aria-label="Severity"
            >
              <option value="">All Severities</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          </div>

          {/* Category Select Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CATEGORY:</label>
            <select
              className="h-9 w-36 rounded-lg border border-input bg-background/90 px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 shadow-xs"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Category"
            >
              <option value="">All Categories</option>
              <option value="COURIER">Courier</option>
              <option value="MONEY">Money</option>
              <option value="RETURNS">Returns</option>
              <option value="SLA">SLA</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Error Alert */}
      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <IconAlert size={16} /> {error}
        </div>
      )}

      {/* Main Issues Table */}
      <Card className="overflow-hidden p-0 border-border/80">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Loading exception queue...
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No exception issues found matching selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Issue Code</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Detected At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-semibold">
                      <Link to={`/orders/${i.order_id}`} className="text-foreground hover:text-primary transition-colors font-semibold">
                        {i.order_name || i.order_id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs font-semibold bg-muted/50 px-2 py-0.5 rounded border border-border/70 text-foreground">
                        {i.issue_code}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={i.severity} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {i.detected_at ? new Date(i.detected_at).toLocaleString() : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={i.resolved ? "success" : "warning"} className="text-xs font-semibold shadow-xs">
                        {i.resolved ? "RESOLVED" : "OPEN"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!i.resolved ? (
                        <Button onClick={() => setResolving(i)} size="sm" className="text-xs font-semibold shadow-xs">
                          Resolve Discrepancy
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium">Resolved</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Resolve Dialog Modal */}
      {resolving && (
        <div
          role="dialog"
          aria-label="Resolve issue"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <Card className="w-full max-w-lg p-6 sm:p-8 shadow-2xl border-border bg-card">
            <h2 className="text-xl font-bold font-heading tracking-tight text-foreground mb-2">Resolve Discrepancy</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {resolving.order_name || resolving.order_id}: <strong className="text-foreground">{resolving.issue_code}</strong>
            </p>

            <div className="mb-4 rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
              {resolving.issue_message}
            </div>

            <div className="mb-6 flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                AUDITED RESOLUTION REASON (MANDATORY)
              </label>
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this exception is resolved (e.g. Manually inspected parcel, customer agreed to partial return)..."
                aria-label="Reason"
              />
            </div>

            <div className="flex gap-3">
              <Button
                onClick={doResolve}
                disabled={!reason.trim()}
                className="flex-1"
              >
                Confirm Resolution &amp; Audit
              </Button>
              <Button
                variant="outline"
                onClick={() => setResolving(null)}
              >
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
