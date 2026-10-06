import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import EmptyState from "../components/EmptyState";
import LabelPreview from "../components/barcode/LabelPreview";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/primitives";

type ParcelRow = {
  id: string; parcel_code: string; barcode_value: string; status: string;
  order_id: string; order_name: string | null; courier: string | null;
  awb: string | null; created_at: string | null;
};

export default function LabelsPage() {
  const [items, setItems] = useState<ParcelRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reprinted, setReprinted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api<{ items: ParcelRow[] }>(`/api/v1/parcels`, {}, localStorage.getItem("token") ?? undefined)
      .then((d) => setItems(d.items))
      .catch((e: Error) => setErr(e.message));
  }, []);

  const filtered = items.filter((p) => {
    if (!query) return true;
    const q = query.trim().toUpperCase();
    return p.barcode_value.toUpperCase().includes(q) || p.parcel_code.toUpperCase().includes(q) || (p.order_name ?? "").toUpperCase().includes(q);
  });

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function reprint(p: ParcelRow) {
    try {
      await api(`/api/v1/parcels/${p.id}/reprint`, { method: "POST" }, localStorage.getItem("token") ?? undefined);
      setReprinted((r) => ({ ...r, [p.id]: true }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reprint failed");
    }
  }

  const chosen = filtered.filter((p) => selected[p.id]);

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Print rules live in src/styles/globals.css; .no-print/.label are
          behavioural classes there because page-break has no utility. */}
      <div className="no-print flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Labels manager</h1>
          <p className="mt-1 text-sm text-muted-foreground">Select parcels, print labels, and audit reprints.</p>
        </div>

        <Card className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search barcode, parcel, order"
            aria-label="Search parcels"
            className="flex-1 min-w-[240px]"
          />
          <Button onClick={() => window.print()} disabled={chosen.length === 0}>
            Print Selected ({chosen.length})
          </Button>
        </Card>

        {err && (
          <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {err}
          </p>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            title="No parcels to label"
            body="Sync orders or import a CSV — parcels appear here automatically."
            primary={{ label: "Sync orders", href: "/orders" }}
            secondary={{ label: "Import CSV", href: "/import" }}
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Select</TableHead>
                    <TableHead>Parcel</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Checkbox
                          checked={!!selected[p.id]}
                          onCheckedChange={() => toggle(p.id)}
                          aria-label={`Select ${p.barcode_value}`}
                        />
                      </TableCell>
                      <TableCell className="font-semibold text-foreground">{p.parcel_code}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs font-semibold bg-muted/50 px-2 py-0.5 rounded border border-border/70 text-foreground">
                          {p.barcode_value}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{p.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => reprint(p)}>
                          Reprint
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      <div className="print-container">
        {chosen.map((p) => (
          <LabelPreview
            key={p.id}
            businessName="Recon Parcel"
            orderName={p.order_name ?? p.order_id}
            parcelCode={p.barcode_value}
            reprint={!!reprinted[p.id]}
          />
        ))}
      </div>
    </main>
  );
}
