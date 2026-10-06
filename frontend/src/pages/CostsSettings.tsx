import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, Card, Input, Label } from "../components/primitives";

export default function CostsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: any[] }>(`/api/v1/reports/costs`, {}, token)
      .then((d) => setItems(d.items ?? []))
      .catch(() => {});
  }

  useEffect(load, []);

  async function save() {
    const token = localStorage.getItem("token") ?? undefined;
    const payload = {
      items: items.map((i) => ({
        key: i.key,
        amount: Number(i.amount),
        source: "MANUAL",
        effective_from: new Date().toISOString(),
      })),
    };
    await api(`/api/v1/reports/costs`, { method: "PUT", body: JSON.stringify(payload) }, token);
    setMsg("Saved — new values apply from now; past months frozen.");
    load();
  }

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold tracking-tight text-2xl sm:text-3xl text-foreground">
              Cost Configuration
            </h1>
            <span className="inline-flex items-center rounded-md border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              COGS &amp; Overhead
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manual cost inputs feed monthly profitability — past months stay frozen.
          </p>
        </div>
      </div>

      <Card className="flex flex-col gap-5 p-6 border-border/80 shadow-xs max-w-2xl">
        {items.map((i, ix) => (
          <div key={i.key} className="flex flex-col gap-2">
            <Label htmlFor={`cost-${i.key}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {i.key} ({i.source})
            </Label>
            <Input
              id={`cost-${i.key}`}
              type="number"
              value={i.amount}
              aria-label={i.key}
              onChange={(e) =>
                setItems((s) =>
                  s.map((x, jx) => (jx === ix ? { ...x, amount: e.target.value } : x))
                )
              }
            />
          </div>
        ))}
        <div>
          <Button onClick={save}>Save costs</Button>
        </div>
        {msg && (
          <p role="status" className="text-sm font-semibold text-success">
            {msg}
          </p>
        )}
      </Card>
    </main>
  );
}
