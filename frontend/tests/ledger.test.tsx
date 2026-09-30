import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { APP_NAV_GROUPS } from "../lib/app-nav";
import { buildLedgerQuery, getLedgerSummary, LEDGER_TXN_TYPES, listLedger } from "../lib/api";
import LedgerPage from "../app/finance/ledger/page";

afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("finance nav includes Ledger entry", () => {
  const finance = APP_NAV_GROUPS.find((g) => g.label === "Finance");
  expect(finance?.children?.some((c) => c.label === "Ledger" && c.href === "/finance/ledger")).toBe(true);
});

test("ledger txn types cover all 11 backend types", () => {
  for (const t of ["SALE","PAYMENT","REFUND","CANCELLATION","COGS","SHIPPING_EXPENSE","PACKAGING_EXPENSE","PAYMENT_GATEWAY_FEE","OTHER_EXPENSE","TAX","ADJUSTMENT"]) {
    expect(LEDGER_TXN_TYPES).toContain(t);
  }
});

test("buildLedgerQuery encodes from/to/type/order_id", () => {
  const q = buildLedgerQuery({ from: "2026-09-01T00:00:00", to: "2026-10-01T00:00:00", type: "SALE", order_id: "o1" });
  expect(q).toMatch(/from=/);
  expect(q).toMatch(/to=/);
  expect(q).toMatch(/type=SALE/);
  expect(q).toMatch(/order_id=o1/);
  expect(buildLedgerQuery({})).toBe("");
});

test("listLedger hits /api/v1/ledger with envelope data", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { items: [], total: 0 } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const d = await listLedger({ type: "SALE" });
  expect(d.items).toEqual([]);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/ledger\?.*type=SALE/);
});

test("getLedgerSummary hits /api/v1/ledger/summary", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        revenue: { net_exclusive: "100.00" },
        profit: { gross_profit: "40.00", operating_profit: "30.00", label: "OPERATING PROFIT", warning: "", margin_pct: "30.00", cogs: "60.00" },
        transaction_count: 1,
      },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const d = await getLedgerSummary({ from: "2026-09-01T00:00:00", to: "2026-10-01T00:00:00" });
  expect(d.profit.operating_profit).toBe("30.00");
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/ledger\/summary\?/);
});

test("ledger page renders empty state when no entries", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { items: [], total: 0 } }),
  }));
  render(<LedgerPage />);
  await waitFor(() => expect(screen.getByText(/No ledger entries/i)).toBeTruthy());
});

test("ledger page shows ESTIMATED + warning when costs incomplete", async () => {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/summary")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            revenue: { net_exclusive: "1000.00" },
            profit: { gross_profit: "400.00", operating_profit: "300.00", label: "ESTIMATED OPERATING PROFIT", warning: "Profit calculation incomplete: COGS missing for 2 products.", margin_pct: "30.00", cogs: "600.00" },
            transaction_count: 5,
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: { items: [{ id: "1", transaction_type: "SALE", amount: "100.00", tax_amount: "0.00", net_amount: "100.00", order_id: "o1", transaction_date_ist: "2026-09-01", reference_number: "r1" }], total: 1 },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<LedgerPage />);
  await waitFor(() => expect(screen.getByText(/ESTIMATED/i)).toBeTruthy());
  expect(screen.getByText(/COGS missing/i)).toBeTruthy();
  // Rupee sign (U+20B9) must render as a real glyph, never mojibake.
  // String.fromCharCode keeps this assertion pure ASCII too.
  const rupee = String.fromCharCode(0x20B9);
  expect(screen.getAllByText(new RegExp(rupee)).length).toBeGreaterThan(0);
  expect(document.body.textContent ?? "").toContain(rupee);
  expect(document.body.textContent ?? "").not.toContain("u20B9");
});

test("ledger page surfaces envelope errors with retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: false, error: { code: "BAD_REQUEST", message: "from/to must be ISO datetimes" } }),
  }));
  render(<LedgerPage />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByText(/Retry/i)).toBeTruthy();
});

test("ledger error clears stale rows and summary", async () => {
  let mode = "ok";
  const summary = {
    revenue: { net_exclusive: "1000.00" },
    profit: { gross_profit: "400.00", operating_profit: "300.00", label: "OPERATING PROFIT", warning: "", margin_pct: "30.00", cogs: "600.00" },
    transaction_count: 1,
  };
  const row = { id: "9", transaction_type: "SALE", amount: "100.00", tax_amount: "0.00", net_amount: "100.00",
    order_id: "STALE-1", transaction_date_ist: "2026-09-01", reference_number: "r1" };
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (mode === "fail") {
      return { ok: true, json: async () => ({ success: false, error: { code: "BAD_REQUEST", message: "boom" } }) };
    }
    if (String(url).includes("/summary")) {
      return { ok: true, json: async () => ({ success: true, data: summary }) };
    }
    return { ok: true, json: async () => ({ success: true, data: { items: [row], total: 1 } }) };
  }));
  render(<LedgerPage />);
  await waitFor(() => expect(screen.getByText("STALE-1")).toBeTruthy());
  expect(screen.getByText("Net sales")).toBeTruthy();
  mode = "fail";
  fireEvent.click(screen.getByText("Apply", { selector: "button" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.queryByText("STALE-1")).toBeNull();
  expect(screen.queryByText("Net sales")).toBeNull();
  expect(screen.getByText(/No ledger entries/i)).toBeTruthy();
});
