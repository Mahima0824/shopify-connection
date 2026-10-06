import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./primitives";

export type ImportSummary = {
  parsed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number | null; name?: string; reason: string }[];
};

export default function ImportResult({ summary }: { summary: ImportSummary }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium text-foreground">
        {summary.parsed} parsed · {summary.created} created · {summary.updated} updated · {summary.skipped} skipped
      </p>
      {summary.errors.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.errors.map((e, ix) => (
                <TableRow key={ix}>
                  <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                    {e.row ? `#${e.row}` : "—"}
                  </TableCell>
                  <TableCell className="font-semibold text-foreground">{e.name ?? "—"}</TableCell>
                  <TableCell className="text-destructive font-medium text-xs">{e.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
