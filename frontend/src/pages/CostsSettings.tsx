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
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Cost configuration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manual cost inputs feed monthly profitability — past months stay frozen.
        </p>
      </div>

      <Card className="flex flex-col gap-5 p-6">
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
