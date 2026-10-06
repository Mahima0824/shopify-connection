import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, Card } from "../components/primitives";

const KNOWN = ["DTDC", "TIRUPATI", "INDIA_POST", "MANUAL"];

type Health = {
  code: string;
  name: string;
  capabilities: string[];
  configured: boolean;
  last_success: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

export default function CarriersPage() {
  const [code, setCode] = useState("DTDC");
  const [msg, setMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<Health[]>([]);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: Health[] }>(`/api/v1/carriers/health`, {}, token)
      .then((d) => setHealth(d.items ?? []))
      .catch((e) => setHealthError(e?.message ?? "Failed to load carrier health"));
  }, []);

  async function connect() {
    const token = localStorage.getItem("token") ?? undefined;
    setMsg(null);
    try {
      await api(`/api/v1/carriers/${code}/connect`, { method: "POST", body: JSON.stringify({}) }, token);
      setMsg(`${code} connected (keys encrypted, never displayed).`);
    } catch (e: any) {
      setMsg(e?.message ?? "Connect failed");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-6 bg-background px-6 max-[480px]:px-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Carrier connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live API adapters activate when you save real account credentials. Until then, use MANUAL checkpoints.
        </p>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-6">
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Carrier"
          className="min-h-11 w-full max-w-[240px] rounded-md border border-input bg-background px-3.5 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          {KNOWN.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <Button onClick={connect}>Connect</Button>
      </Card>

      {msg && (
        <Card className="p-4 text-sm text-foreground">
          <p role="status">{msg}</p>
        </Card>
      )}

      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">Carrier health</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connection state and last sync outcome per provider (credentials never shown).
        </p>
      </div>

      {healthError && (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {healthError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {health.map((h) => (
          <Card
            key={h.code}
            className={`p-5 ${h.configured ? "border-t-4 border-t-success" : "border-t-4 border-t-muted"}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-foreground">{h.code}</span>
              <Badge variant={h.configured ? "default" : "secondary"}>
                {h.configured ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{h.name}</div>
            <div className="mt-3 text-xs text-foreground">
              <span className="text-muted-foreground">Capabilities: </span>
              {(h.capabilities ?? []).join(", ") || "—"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Last success: {h.last_success ?? "never"}
            </div>
            {h.last_error && (
              <div role="status" className="mt-1 text-xs text-destructive">
                Last error: {h.last_error}
              </div>
            )}
          </Card>
        ))}
      </div>
    </main>
  );
}
