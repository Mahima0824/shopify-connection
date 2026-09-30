import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { APP_NAV_GROUPS } from "../lib/app-nav";
import {
  canCloseMonth,
  canReopenMonth,
  closeMonth,
  getPeriodDetail,
  reopenMonth,
} from "../lib/api";
import ClosePage from "../app/finance/close/page";

afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const OPEN_DETAIL = {
  success: true,
  data: {
    status: "OPEN",
    issues: {
      total: 3,
      counts: {
        unreconciled_payments: 1,
        unreconciled_bank: 1,
        unexported_transactions: 1,
        invalid_gst: 0,
        missing_cogs: 0,
        pending_refunds: 0,
        check_errors: 0,
      },
      checks: {
        unreconciled_payments: ["pay-1"],
        unexported_transactions: ["txn-9"],
        invalid_gst: [],
        missing_cogs: [],
        pending_refunds: [],
      },
    },
  },
};

const CLEAR_DETAIL = {
  success: true,
  data: {
    status: "OPEN",
    issues: {
      total: 0,
      counts: {
        unreconciled_payments: 0,
        unreconciled_bank: 0,
        unexported_transactions: 0,
        invalid_gst: 0,
        missing_cogs: 0,
        pending_refunds: 0,
        check_errors: 0,
      },
      checks: {},
    },
  },
};

const CLOSED_DETAIL = {
  success: true,
  data: {
    status: "CLOSED",
    issues: {
      total: 0,
      counts: {
        unreconciled_payments: 0,
        unreconciled_bank: 0,
        unexported_transactions: 0,
        invalid_gst: 0,
        missing_cogs: 0,
        pending_refunds: 0,
        check_errors: 0,
      },
      checks: {},
    },
  },
};

test("finance nav includes Close entry", () => {
  const finance = APP_NAV_GROUPS.find((g) => g.label === "Finance");
  expect(finance?.children?.some((c) => c.label === "Close" && c.href === "/finance/close")).toBe(true);
});

test("getPeriodDetail hits /api/v1/accounting/periods/{y}/{m} with envelope data", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => OPEN_DETAIL,
  });
  vi.stubGlobal("fetch", fetchMock);
  const d = await getPeriodDetail(2026, 9);
  expect(d.status).toBe("OPEN");
  expect(d.issues.total).toBe(3);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/accounting\/periods\/2026\/9/);
});

test("closeMonth and reopenMonth POST to the right endpoints", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { id: "p1", status: "CLOSED" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  await closeMonth(2026, 9);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/periods\/2026\/9\/close/);
  expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
  await reopenMonth(2026, 9);
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/periods\/2026\/9\/reopen/);
  expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
});

test("role gates: close ADMIN/ACCOUNTANT, reopen ADMIN only", () => {
  expect(canCloseMonth("ADMIN")).toBe(true);
  expect(canCloseMonth("ACCOUNTANT")).toBe(true);
  expect(canCloseMonth("VIEWER")).toBe(false);
  expect(canCloseMonth(null)).toBe(false);
  expect(canReopenMonth("ADMIN")).toBe(true);
  expect(canReopenMonth("ACCOUNTANT")).toBe(false);
  expect(canReopenMonth(null)).toBe(false);
});

test("open period renders badge, 5-gate table, and disabled close when blocked", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => OPEN_DETAIL,
  }));
  render(<ClosePage />);
  await waitFor(() => expect(screen.getAllByText("Unreconciled payments / bank rows").length).toBeGreaterThan(0));
  expect(screen.getByLabelText(/Period status OPEN/i)).toBeTruthy();
  for (const label of ["Unexported transactions", "Invalid GST rows", "Orders missing COGS", "Pending refunds"]) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
  expect(screen.getByText(/BLOCKED \(3\)/)).toBeTruthy();
  const closeBtn = screen.getByText("Close month", { selector: "button" });
  expect((closeBtn as HTMLButtonElement).disabled).toBe(true);
});

test("close 422 surfaces blocker list", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  const blockedIssues = {
    total: 2,
    counts: {
      unreconciled_payments: 1, unreconciled_bank: 0, unexported_transactions: 1,
      invalid_gst: 0, missing_cogs: 0, pending_refunds: 0, check_errors: 0,
    },
    checks: { unreconciled_payments: ["pay-7"], unexported_transactions: ["txn-3"] },
  };
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/close")) {
      return {
        ok: false,
        status: 422,
        json: async () => ({
          success: false,
          error: { code: "CLOSE_BLOCKED", message: "Cannot close month. 2 issues remain.", issues: blockedIssues },
        }),
      };
    }
    return { ok: true, json: async () => CLEAR_DETAIL };
  }));
  render(<ClosePage />);
  const closeBtn = await screen.findByText("Close month", { selector: "button" });
  expect((closeBtn as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(closeBtn);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByText(/Close blocked/i)).toBeTruthy();
  expect(screen.getByText(/pay-7/)).toBeTruthy();
  expect(screen.getByText(/txn-3/)).toBeTruthy();
});

test("closed period shows adjustments-only notice and ADMIN reopen", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => CLOSED_DETAIL,
  }));
  render(<ClosePage />);
  await waitFor(() => expect(screen.getByText(/adjustments only/i)).toBeTruthy());
  expect(screen.getByText("Reopen month", { selector: "button" })).toBeTruthy();
  expect(screen.queryByText("Close month", { selector: "button" })).toBeNull();
});

test("accountant sees no reopen button on closed period", async () => {
  localStorage.setItem("role", "ACCOUNTANT");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => CLOSED_DETAIL,
  }));
  render(<ClosePage />);
  await waitFor(() => expect(screen.getByText(/adjustments only/i)).toBeTruthy());
  expect(screen.queryByText("Reopen month", { selector: "button" })).toBeNull();
  expect(screen.getByText(/requires an ADMIN role/i)).toBeTruthy();
});

test("close page surfaces envelope errors with retry", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: false, error: { code: "BAD_REQUEST", message: "boom" } }),
  }));
  render(<ClosePage />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByText(/Retry/i)).toBeTruthy();
});
