import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  canManualMatch,
  getBankSummary,
  getStoredRole,
  listBankMismatches,
} from "../src/lib/api";
import StatementsPage from "../src/pages/StatementList";

afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const SUMMARY = {
  expected_settlement: "1000.00",
  actual_bank_credit: "950.00",
  difference: "-50.00",
  matched: 9,
  pending: 2,
  mismatch: 1,
  unknown: 0,
  ignored: 0,
  total: 12,
};

const ROWS = [
  {
    bank_row_id: "br-1",
    order_id: "o-1",
    order_name: "#1001",
    payment_id: "p-1",
    payment_reference: "pay_TXN1",
    shipment_id: "s-1",
    gateway_settlement_reference: "SETL-1",
    expected_amount: 1000,
    actual_amount: 950,
    bank_reference: "UTR123",
    difference: -50,
    match_level: "L1",
    transaction_date: "2026-09-15T00:00:00",
  },
  {
    bank_row_id: "br-2",
    order_id: null,
    order_name: null,
    payment_id: null,
    payment_reference: null,
    shipment_id: null,
    gateway_settlement_reference: null,
    expected_amount: 0,
    actual_amount: 500,
    bank_reference: "UTR999",
    difference: 500,
    match_level: "L4",
    transaction_date: "2026-09-16T00:00:00",
    status: "POTENTIAL_MATCH",
  },
];

function stubRecon() {
  return vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/bank-summary")) {
      return { ok: true, json: async () => ({ success: true, data: SUMMARY }) };
    }
    if (u.includes("/bank-mismatches")) {
      return { ok: true, json: async () => ({ success: true, data: { items: ROWS, total: 2 } }) };
    }
    if (u.includes("/api/v1/statements")) {
      return { ok: true, json: async () => ({ success: true, data: { items: [] } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <StatementsPage />
    </MemoryRouter>
  );
}

test("bank client hits summary + mismatches endpoints with envelope data", async () => {
  const fetchMock = stubRecon();
  vi.stubGlobal("fetch", fetchMock);
  const s = await getBankSummary();
  expect(s.expected_settlement).toBe("1000.00");
  const m = await listBankMismatches();
  expect(m.total).toBe(2);
  const urls = fetchMock.mock.calls.map((c) => String(c[0]));
  expect(urls.some((u) => u.includes("/api/v1/reconciliation/bank-summary"))).toBe(true);
  expect(urls.some((u) => u.includes("/api/v1/reconciliation/bank-mismatches"))).toBe(true);
});

test("manual match gated to ADMIN/ACCOUNTANT only", () => {
  expect(canManualMatch("ADMIN")).toBe(true);
  expect(canManualMatch("ACCOUNTANT")).toBe(true);
  expect(canManualMatch("VIEWER")).toBe(false);
  expect(canManualMatch("")).toBe(false);
  localStorage.setItem("role", "accountant");
  expect(getStoredRole()).toBe("ACCOUNTANT");
  expect(canManualMatch()).toBe(true);
  localStorage.setItem("role", "viewer");
  expect(canManualMatch()).toBe(false);
});

test("statements page shows summary strip + mismatch row with amounts", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("fetch", stubRecon());
  renderPage();
  await waitFor(() => expect(screen.getByText("Expected settlement")).toBeTruthy());
  expect(screen.getByText("Actual bank credit")).toBeTruthy();
  expect(screen.getAllByText("Difference").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("UTR123")).toBeTruthy();
  expect(screen.getByText("MISMATCH")).toBeTruthy();
  const rupee = String.fromCharCode(0x20B9);
  expect(screen.getAllByText(new RegExp(rupee)).length).toBeGreaterThan(0);
  expect(document.body.textContent ?? "").not.toContain("u20B9");
  // Existing upload flow untouched.
  expect(screen.getByLabelText("Statement file")).toBeTruthy();
  expect(screen.getByText("Upload", { selector: "button" })).toBeTruthy();
});

test("details opens drill-down drawer with order to bank chain", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("fetch", stubRecon());
  renderPage();
  await waitFor(() => expect(screen.getByText("UTR123")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Details for UTR123"));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  const dlg = within(screen.getByRole("dialog"));
  expect(dlg.getByText("#1001")).toBeTruthy();
  expect(dlg.getByText("pay_TXN1")).toBeTruthy();
  expect(dlg.getByText("SETL-1")).toBeTruthy();
  fireEvent.click(screen.getByText("Close", { selector: "button" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("manual-match button only for POTENTIAL_MATCH + privileged role", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("fetch", stubRecon());
  renderPage();
  await waitFor(() => expect(screen.getByText("UTR999")).toBeTruthy());
  expect(screen.getByLabelText("Manual match UTR999")).toBeTruthy();
  expect(screen.queryByLabelText("Manual match UTR123")).toBeNull();
  cleanup();

  localStorage.clear();
  localStorage.setItem("role", "VIEWER");
  vi.stubGlobal("fetch", stubRecon());
  renderPage();
  await waitFor(() => expect(screen.getByText("UTR999")).toBeTruthy());
  expect(screen.queryByLabelText(/Manual match/)).toBeNull();
});

test("manual match posts shipment and reloads", async () => {
  localStorage.setItem("role", "ACCOUNTANT");
  const fetchMock = stubRecon();
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() => expect(screen.getByText("UTR999")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Manual match UTR999"));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Shipment ID"), { target: { value: "s-9" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByText("Manual match", { selector: "button" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        (c) =>
          String(c[0]).includes("/api/v1/statements/rows/br-2/match") &&
          String(c[1]?.body ?? "").includes("s-9"),
      ),
    ).toBe(true),
  );
});

test("recon envelope error shows alert with retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/api/v1/statements")) {
      return { ok: true, json: async () => ({ success: true, data: { items: [] } }) };
    }
    return { ok: true, json: async () => ({ success: false, error: { code: "BAD_REQUEST", message: "boom" } }) };
  }));
  renderPage();
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByText(/Retry/i)).toBeTruthy();
});
