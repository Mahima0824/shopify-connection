import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  REPORT_PRESETS,
  buildReportRangeQuery,
  canDrainRetries,
  drainShipsagarRetries,
  getGstReport,
  getProfitReport,
  getShipsagarHealth,
  shipmentProvider,
} from "../lib/api";
import MonthlyPage from "../app/reports/monthly/page";
import ShipmentsPage from "../app/shipments/page";

afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const GST = {
  success: true,
  data: {
    period: { from: "2026-04-01", to: "2027-04-01" },
    orders: 2,
    invalid: 0,
    totals: { taxable: "1000.00", cgst: "90.00", sgst: "90.00", igst: "0.00" },
    rows: [
      { order_id: "o1", order_name: "1001", valid: true, jurisdiction: "UNKNOWN", warnings: ["JURISDICTION_UNKNOWN"] },
    ],
  },
};

const PROFIT = {
  success: true,
  data: {
    period: { from: "2026-04-01", to: "2027-04-01" },
    orders: 2,
    revenue: { gross_inclusive: "1180.00", net_exclusive: "1000.00", gst: "180.00" },
    profit: {
      cogs: "400.00",
      gross_profit: "600.00",
      operating_profit: "500.00",
      margin_pct: "50.00",
      label: "ESTIMATED OPERATING PROFIT",
      warning: "Profit calculation incomplete: COGS missing for 1 products.",
    },
  },
};

test("report presets include financial_year and last_fy; range query builder", () => {
  expect(REPORT_PRESETS).toContain("financial_year");
  expect(REPORT_PRESETS).toContain("last_fy");
  expect(REPORT_PRESETS[0]).toBe("today");
  expect(REPORT_PRESETS[REPORT_PRESETS.length - 1]).toBe("custom");
  expect(buildReportRangeQuery({ preset: "financial_year" })).toMatch(/preset=financial_year/);
  expect(buildReportRangeQuery({ preset: "custom", from: "2026-04-01", to: "2027-03-31" })).toMatch(/from=/);
});

test("gst and profit clients hit envelope endpoints", async () => {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/reports/gst")) return { ok: true, json: async () => GST };
    return { ok: true, json: async () => PROFIT };
  });
  vi.stubGlobal("fetch", fetchMock);
  const g = await getGstReport({ preset: "financial_year" });
  expect(g.totals.cgst).toBe("90.00");
  const p = await getProfitReport({ preset: "financial_year" });
  expect(p.profit.operating_profit).toBe("500.00");
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/reports\/gst/);
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/v1\/reports\/profit/);
});

test("monthly page renders GST card with CA review and profit warning", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/reports/monthly?")) return { ok: true, json: async () => ({ success: true, data: { orders: { total: 1 }, money: {}, profitability: { label: "X" }, exceptions: {} } }) };
    if (String(url).includes("/reports/gst")) return { ok: true, json: async () => GST };
    if (String(url).includes("/reports/profit")) return { ok: true, json: async () => PROFIT };
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  }));
  render(<MonthlyPage />);
  await waitFor(() => expect(screen.getByText("GST")).toBeTruthy());
  expect(screen.getByText(/CA before filing/i)).toBeTruthy();
  expect(screen.getByText(/IGST-UNVERIFIED/i)).toBeTruthy();
  expect(screen.getByText("Profit")).toBeTruthy();
  expect(screen.getByText(/COGS missing for 1/i)).toBeTruthy();
  expect(screen.getByLabelText("Period preset")).toBeTruthy();
});

test("monthly cards surface envelope errors with retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/reports/monthly")) return { ok: true, json: async () => ({ success: true, data: { orders: { total: 0 }, money: {}, profitability: { label: "X" }, exceptions: {} } }) };
    return { ok: false, status: 500, json: async () => ({ success: false, error: { code: "BAD_REQUEST", message: "cards boom" } }) };
  }));
  render(<MonthlyPage />);
  await waitFor(() => expect(screen.getByText(/cards boom/)).toBeTruthy());
  expect(screen.getAllByText(/Retry/i).length).toBeGreaterThan(0);
});

test("provider badge maps ShipSagar / direct / MANUAL", () => {
  expect(shipmentProvider({ shipsagar_tracking_id: "ss-1", carrier_code: "DELHIVERY" })).toBe("SHIPSAGAR");
  expect(shipmentProvider({ carrier_code: "MANUAL" })).toBe("MANUAL");
  expect(shipmentProvider({ carrier_code: "DELHIVERY" })).toBe("DIRECT");
  expect(shipmentProvider({ shipsagar_tracking_id: "ss-1", carrier_code: "X" })).toBe("SHIPSAGAR");
  expect(shipmentProvider({ carrier_code: "MANUAL" })).toBe("MANUAL");
  expect(shipmentProvider({ carrier_code: "BLUEDART" })).toBe("DIRECT");
});

test("shipsagar health client and ADMIN-only drain gate", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { provider: "SHIPSAGAR", failed_webhooks: 2, pending_jobs: 3, status: "warning" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const h = await getShipsagarHealth();
  expect(h.failed_webhooks).toBe(2);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/shipsagar\/health/);
  expect(canDrainRetries("ADMIN")).toBe(true);
  expect(canDrainRetries("ACCOUNTANT")).toBe(false);
  expect(canDrainRetries(null)).toBe(false);
});

test("shipments page shows provider badge, health line, ADMIN retry-drain with confirm", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, init?: any) => {
    if (String(url).includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: { provider: "SHIPSAGAR", configured: true, status: "warning", failed_webhooks: 2, failed_jobs: 0, pending_jobs: 3, unregistered_shipments: 1 } }) };
    }
    if (String(url).includes("/shipsagar/retry-drain")) {
      expect(init?.method).toBe("POST");
      return { ok: true, json: async () => ({ success: true, data: { drained: 3 } }) };
    }
    return {
      ok: true,
      json: async () => ({ success: true, data: { items: [{ id: "s1", order_id: "o1", carrier_code: "DELHIVERY", shipsagar_tracking_id: "ss-9", awb_number: "AWB1", tracking_status: "IN_TRANSIT", location: "Mumbai" }], total: 1 } }),
    };
  }));
  render(<ShipmentsPage />);
  await waitFor(() => expect(screen.getByText("ShipSagar")).toBeTruthy());
  expect(screen.getByText(/2 failed webhooks/)).toBeTruthy();
  expect(screen.getByText(/3 pending retries/)).toBeTruthy();
  const btn = screen.getByText("Retry drain", { selector: "button" });
  fireEvent.click(btn);
  await waitFor(() => expect(screen.getByText(/Retry drain complete/)).toBeTruthy());
  expect(drainShipsagarRetries).toBeDefined();
});

test("non-ADMIN sees no retry-drain button", async () => {
  localStorage.setItem("role", "VIEWER");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: { provider: "SHIPSAGAR", status: "healthy", failed_webhooks: 0, pending_jobs: 0 } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: { items: [], total: 0 } }) };
  }));
  render(<ShipmentsPage />);
  await waitFor(() => expect(screen.getByText(/0 failed webhooks/)).toBeTruthy());
  expect(screen.queryByText("Retry drain", { selector: "button" })).toBeNull();
});
