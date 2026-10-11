import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, Card, Input } from "../components/primitives";
import SelectField from "../components/SelectField";

const KNOWN = ["SHIPSAGAR", "INDIA_POST", "MANUAL"];

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
  const [code, setCode] = useState("SHIPSAGAR");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<Health[]>([]);
  const [healthError, setHealthError] = useState<string | null>(null);

  const loadHealth = React.useCallback(() => {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: Health[] }>(`/api/v1/carriers/health`, {}, token)
      .then((d) => setHealth(d.items ?? []))
      .catch((e) => setHealthError(e?.message ?? "Failed to load carrier health"));
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  async function connect() {
    const token = localStorage.getItem("token") ?? undefined;
    setMsg(null);
    try {
      const credentials = apiKey.trim() ? { api_key: apiKey.trim() } : {};
      await api(`/api/v1/carriers/${code}/connect`, {
        method: "POST",
        body: JSON.stringify({ credentials }),
      }, token);
      setMsg(`${code} connected successfully (credentials encrypted at rest).`);
      setApiKey("");
      loadHealth();
    } catch (e: any) {
      setMsg(e?.message ?? "Connect failed");
    }
  }

  return (
    <main className="page-shell flex flex-col gap-6 bg-background">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-medium tracking-tight text-2xl sm:text-3xl text-foreground">
              Carrier Connections
            </h1>
            <Badge variant="secondary" className="text-xs">
              Logistics APIs
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            ShipSagar handles all courier logistics API integrations (DTDC, Delhivery, Blue Dart, etc.) directly. Separate direct provider APIs are replaced by ShipSagar.
          </p>
        </div>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-6 border-border/80 shadow-xs">
        <SelectField
          ariaLabel="Carrier"
          value={code}
          includeAll={false}
          placeholder="Select carrier"
          onChange={setCode}
          triggerClassName="w-full max-w-[200px]"
          options={KNOWN.map((c) => ({ value: c, label: c }))}
        />
        <Input
          type="password"
          placeholder="API Key / Token (optional)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="min-h-11 w-full max-w-[280px]"
        />
        <Button onClick={connect}>Connect Carrier</Button>
      </Card>

      {msg && (
        <Card className="p-4 text-sm text-foreground">
          <p role="status">{msg}</p>
        </Card>
      )}

      <div>
        <h2 className="font-heading font-semibold text-xl tracking-tight text-foreground">Carrier Health &amp; Integrations</h2>
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
            className={`p-5 border-border/80 shadow-xs ${h.configured ? "border-t-4 border-t-success" : "border-t-4 border-t-muted"}`}
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
