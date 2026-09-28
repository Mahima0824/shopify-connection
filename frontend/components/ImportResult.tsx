import React from "react";
export type ImportSummary = { parsed: number; created: number; updated: number; skipped: number; errors: { row: number | null; name?: string; reason: string }[] };
export default function ImportResult({ summary }: { summary: ImportSummary }) {
  return (
    <div>
      <p>{summary.parsed} parsed · {summary.created} created · {summary.updated} updated · {summary.skipped} skipped</p>
      {summary.errors.length > 0 && (
        <table><thead><tr><th>Row</th><th>Order</th><th>Reason</th></tr></thead>
          <tbody>{summary.errors.map((e, ix) => <tr key={ix}><td>{e.row ?? "-"}</td><td>{e.name ?? "-"}</td><td>{e.reason}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}
