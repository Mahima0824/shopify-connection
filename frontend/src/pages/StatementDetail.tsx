import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/primitives";

export default function StatementDetailPage() {
  const { id } = useParams();
  const [counts, setCounts] = useState<any | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [shipId, setShipId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<any>(`/api/v1/statements/${id!}/results`, {}, token)
      .then((d) => {
        setCounts(d.counts);
        setRows(d.rows ?? []);
      })
      .catch((e) => setError(e?.message));
  }

  useEffect(load, [id]);

  async function dryRun() {
    const token = localStorage.getItem("token") ?? undefined;
    try {
      const d = await api<any>(`/api/v1/statements/${id!}/dry-run`, { method: "POST" }, token);
      setCounts({ dry_run: d });
    } catch (e: any) {
      setError(e?.message ?? "Dry run failed");
    }
  }

  async function process() {
    const token = localStorage.getItem("token") ?? undefined;
    try {
      await api(`/api/v1/statements/${id!}/process`, { method: "POST" }, token);
      load();
    } catch (e: any) {
      setError(e?.message ?? "Process failed");
    }
  }

  async function matchRow(rid: string) {
    const token = localStorage.getItem("token") ?? undefined;
    try {
      await api(
        `/api/v1/statements/rows/${rid}/match`,
        { method: "POST", body: JSON.stringify({ shipment_id: shipId }) },
        token
      );
      setShipId("");
      load();
    } catch (e: any) {
      setError(e?.message ?? "Match failed");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Statement results</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dry-run first, then process and clear the unmatched queue
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={dryRun}>
            Dry run
          </Button>
          <Button onClick={process}>Process</Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {counts && (
        <Card className="flex flex-wrap gap-6 p-6">
          {Object.entries(counts.dry_run ?? counts)
            .filter(([, v]) => typeof v === "number")
            .map(([k, v]) => (
              <div key={k}>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {k}
                </div>
                <div className="mt-1 text-2xl font-extrabold text-foreground">{v as number}</div>
              </div>
            ))}
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No rows in this statement.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>AWB</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.row_number}
                    </TableCell>
                    <TableCell className="font-mono font-semibold text-foreground">
                      {r.awb_number ?? "-"}
                    </TableCell>
                    <TableCell className="tabular-nums font-medium text-foreground">
                      ₹{Number(r.net_amount || 0).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.reconciliation_status === "MATCHED" ? "default" : "secondary"}>
                        {r.reconciliation_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.reconciliation_status === "UNMATCHED" && (
                        <div className="inline-flex items-center gap-2">
                          <Input
                            className="w-36 h-9"
                            value={shipId}
                            onChange={(e) => setShipId(e.target.value)}
                            placeholder="Shipment ID"
                            aria-label="Shipment ID"
                          />
                          <Button size="sm" variant="outline" onClick={() => matchRow(r.id)}>
                            Match
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
