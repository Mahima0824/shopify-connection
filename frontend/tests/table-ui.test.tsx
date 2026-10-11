import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../src/components/primitives";

test("a table built from the primitives carries the shared chrome", () => {
  const { container } = render(
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>#10453</TableCell>
          <TableCell>AWAITING_TRACKING</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );

  const table = container.querySelector('[data-slot="table"]');
  const head = container.querySelector('[data-slot="table-head"]');
  const cell = container.querySelector('[data-slot="table-cell"]');
  const row = container.querySelector('[data-slot="table-row"]');

  // Header weight/size is set by the primitive, not per call site.
  expect(head?.className).toMatch(/text-\[11px\]/);
  expect(head?.className).toMatch(/uppercase/);
  // Cell padding is owned by the primitive so every table lines up.
  expect(cell?.className).toMatch(/px-4/);
  expect(cell?.className).toMatch(/py-3/);
  // Column rules live on the <table> via arbitrary variants.
  expect(table?.className).toMatch(/\[&_td\]:border-l/);
  expect(table?.className).toMatch(/first-child\]:border-l-0/);
  // Rows carry the shared hover treatment.
  expect(row?.className).toMatch(/hover:bg-muted\/40/);
  expect(screen.getByText("#10453")).toBeTruthy();
});

test("cell padding is not overridden at the call site", () => {
  // Any per-call-site px-/py- on a TableCell would reintroduce the drift this
  // suite exists to prevent.
  render(
    <Table>
      <TableBody>
        <TableRow>
          <TableCell className="text-right">5</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
  const cell = document.querySelector('[data-slot="table-cell"]');
  const px = cell?.className.match(/px-(\S+)/);
  expect(px?.[1]).toBe("4");
});