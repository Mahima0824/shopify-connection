import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, Card, Input } from "../components/primitives";

export default function SlaPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [allowed, setAllowed] = useState("45");
  const [warning, setWarning] = useState("7");

  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: any[] }>(`/api/v1/sla/rules`, {}, token)
      .then((d) => setRules(d.items ?? []))
      .catch(() => {});
  }

  useEffect(load, []);

  async function add() {
    const token = localStorage.getItem("token") ?? undefined;
    await api(
      `/api/v1/sla/rules`,
      {
        method: "POST",
        body: JSON.stringify({
          carrier_code: "*",
          event_type: "RTO",
          allowed_days: Number(allowed),
          warning_days: Number(warning),
        }),
      },
      token
    );
    load();
  }

  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">SLA rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Breach thresholds per carrier and event type drive the outstanding board.
        </p>
      </div>

      <Card className="flex flex-col gap-5 p-6">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No SLA rules yet. Add the first RTO rule below.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-sm tabular-nums"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{r.carrier_code}</Badge>
                  <span className="font-semibold text-foreground">{r.event_type}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Allowed: <span className="font-medium text-foreground">{r.allowed_days}d</span> · Warning:{" "}
                  <span className="font-medium text-foreground">{r.warning_days}d</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Input
            value={allowed}
            onChange={(e) => setAllowed(e.target.value)}
            placeholder="Allowed days (e.g. 45)"
            aria-label="Allowed days"
            className="flex-1"
          />
          <Input
            value={warning}
            onChange={(e) => setWarning(e.target.value)}
            placeholder="Warning days (e.g. 7)"
            aria-label="Warning days"
            className="flex-1"
          />
          <Button onClick={add} className="whitespace-nowrap">
            Add RTO rule
          </Button>
        </div>
      </Card>
    </main>
  );
}
