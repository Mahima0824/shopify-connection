import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function CostsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  function load() {
    const token = localStorage.getItem("token") ?? undefined;
    api<{ items: any[] }>(`/api/v1/reports/costs`, {}, token).then((d) => setItems(d.items ?? [])).catch(() => {});
  }
  useEffect(load, []);
  async function save() {
    const token = localStorage.getItem("token") ?? undefined;
    const payload = {
      items: items.map((i) => ({ key: i.key, amount: Number(i.amount), source: "MANUAL", effective_from: new Date().toISOString() })),
    };
    await api(`/api/v1/reports/costs`, { method: "PUT", body: JSON.stringify(payload) }, token);
    setMsg("Saved — new values apply from now; past months frozen.");
    load();
  }
  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 max-[480px]:px-4" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", background: "var(--background)" }}>
      <div>
        <h1 className="font-bold tracking-tight text-foreground" style={{ fontSize: "28px", fontWeight: 700 }}>Cost configuration</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "14px", marginTop: "4px" }}>Manual cost inputs feed monthly profitability — past months stay frozen.</p>
      </div>
      <div className="rounded-xl border border-border bg-white text-foreground p-6 max-[768px]:p-5" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {items.map((i, ix) => (
          <div key={i.key}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: "6px" }}>{i.key} ({i.source})
              <input type="number" value={i.amount} aria-label={i.key} className="w-full min-h-11 rounded-lg border border-border bg-white px-3.5 py-2.5 text-base text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-[var(--primary)] focus-visible:outline-offset-2"
                onChange={(e) => setItems((s) => s.map((x, jx) => (jx === ix ? { ...x, amount: e.target.value } : x)))} />
            </label>
          </div>
        ))}
        <div>
          <button onClick={save} className="inline-flex items-center justify-center cursor-pointer rounded-lg min-h-11 px-5 py-3 border-0 text-sm font-semibold bg-primary text-[text-primary-foreground] active:translate-y-px max-[480px]:w-full">Save costs</button>
        </div>
        {msg && <p role="status" style={{ color: "var(--success)", fontWeight: 600 }}>{msg}</p>}
      </div>
    </main>
  );
}
