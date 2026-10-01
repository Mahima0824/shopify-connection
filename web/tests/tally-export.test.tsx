import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  listTallyExports,
  markTallyImported,
  validateTallyExport,
} from "../src/lib/api";
import TallyPage from "../src/pages/TallySettings";

afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const VALIDATION_OK = {
  transactions: 5,
  valid: 5,
  error_count: 0,
  warning_count: 1,
  errors: [],
  warnings: [{ code: "GSTIN_UNVERIFIED", message: "GSTIN not captured - verify in Tally.", ref: null }],
  already_exported: 0,
  fresh: 5,
  can_export: true,
};

const VALIDATION_BLOCKED = {
  transactions: 3,
  valid: 1,
  error_count: 2,
  warning_count: 0,
  errors: [{ code: "INVOICE_NOT_UNIQUE", message: "Invoice 'INV-1' appears 2 times.", ref: "INV-1" }],
  warnings: [],
  already_exported: 0,
  fresh: 3,
  can_export: false,
};

const BATCHES = [
  {
    id: "b-1",
    batch_reference: "TALLY-20260901-000001",
    record_count: 5,
    transaction_count: 5,
    status: "GENERATED",
    file_name: "TALLY_EXPORT_2026_09.xlsx",
    created_at: "2026-09-01T10:00:00",
  },
];

function baseStub(validation: any = VALIDATION_OK, batches: any[] = BATCHES) {
  return vi.fn().mockImplementation(async (url: string, init?: any) => {
    const u = String(url);
    if (u.includes("/api/v1/tally/validate")) {
      return { ok: true, json: async () => ({ success: true, data: validation }) };
    }
    if (u.includes("/mark-imported")) {
      return { ok: true, json: async () => ({ success: true, data: { id: "b-1", status: "IMPORTED" } }) };
    }
    if (u.includes("/api/v1/tally/exports")) {
      return { ok: true, json: async () => ({ success: true, data: { items: batches } }) };
    }
    if (u.includes("/api/v1/tally/batches")) {
      return { ok: true, json: async () => ({ success: true, data: batches }) };
    }
    if (u.includes("/api/v1/tally/mapping")) {
      return { ok: true, json: async () => ({ success: true, data: {} }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TallyPage />
    </MemoryRouter>
  );
}

test("validateTallyExport POSTs to /api/v1/tally/validate with from/to", async () => {
  const fetchMock = baseStub();
  vi.stubGlobal("fetch", fetchMock);
  const d = await validateTallyExport({ from: "2026-09-01T00:00:00", to: "2026-10-01T00:00:00" });
  expect(d.can_export).toBe(true);
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/v1/tally/validate"));
  expect(call).toBeTruthy();
  expect(String(call[0])).toMatch(/from=/);
  expect(String(call[0])).toMatch(/to=/);
  expect(call[1]?.method).toBe("POST");
});

test("listTallyExports hits GET /api/v1/tally/exports with envelope items", async () => {
  const fetchMock = baseStub();
  vi.stubGlobal("fetch", fetchMock);
  const d = await listTallyExports({ from: "2026-09-01T00:00:00" });
  expect(d.items.length).toBe(1);
  expect(d.items[0].batch_reference).toBe("TALLY-20260901-000001");
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/v1/tally/exports"));
  expect(call).toBeTruthy();
});

test("markTallyImported POSTs imported body to mark-imported endpoint", async () => {
  const fetchMock = baseStub();
  vi.stubGlobal("fetch", fetchMock);
  const d = await markTallyImported("b-1", { imported: true });
  expect(d.status).toBe("IMPORTED");
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/exports/b-1/mark-imported"));
  expect(call).toBeTruthy();
  expect(String(call[1]?.body ?? "")).toContain("imported");
});

test("tally page shows date range + Validate and keeps mapping form intact", async () => {
  vi.stubGlobal("fetch", baseStub());
  renderPage();
  await waitFor(() => expect(screen.getByLabelText("From date")).toBeTruthy());
  expect(screen.getByLabelText("To date")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Validate/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Generate workbook/i })).toBeTruthy();
  // Mapping form untouched.
  expect(screen.getByText("Voucher Types Configuration")).toBeTruthy();
  expect(screen.getByText("Save Ledger Mappings", { selector: "button" })).toBeTruthy();
});

test("validate success shows counts and PASSED; export stays enabled", async () => {
  vi.stubGlobal("fetch", baseStub(VALIDATION_OK));
  renderPage();
  await waitFor(() => expect(screen.getByRole("button", { name: /Validate/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Validate/i }));
  await waitFor(() => expect(screen.getByText("PASSED")).toBeTruthy());
  expect(screen.getByText(/5 valid/i)).toBeTruthy();
  expect(screen.getByText(/GSTIN_UNVERIFIED/)).toBeTruthy();
  expect((screen.getByRole("button", { name: /Generate workbook/i }) as HTMLButtonElement).disabled).toBe(false);
});

test("BLOCKED validation lists errors and disables export", async () => {
  vi.stubGlobal("fetch", baseStub(VALIDATION_BLOCKED));
  renderPage();
  await waitFor(() => expect(screen.getByRole("button", { name: /Validate/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Validate/i }));
  await waitFor(() => expect(screen.getByText("BLOCKED")).toBeTruthy());
  expect(screen.getByText(/INVOICE_NOT_UNIQUE/)).toBeTruthy();
  await waitFor(() =>
    expect((screen.getByRole("button", { name: /Generate workbook/i }) as HTMLButtonElement).disabled).toBe(true),
  );
});

test("duplicate export (409) shows friendly already-exported message", async () => {
  const fetchMock = baseStub();
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/export-workbook")) {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          success: false,
          error: { code: "DUPLICATE_EXPORT", message: "2 transaction(s) already exported; re-export blocked." },
        }),
      };
    }
    return baseStub()(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() => expect(screen.getByRole("button", { name: /Generate workbook/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Generate workbook/i }));
  await waitFor(() => expect(screen.getByText(/already exported/i)).toBeTruthy());
});

test("batch history header is honest (Created, not Range) and validate sends inclusive to-date", async () => {
  const fetchMock = baseStub();
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() => expect(screen.getByText("TALLY_EXPORT_2026_09.xlsx")).toBeTruthy());
  expect(screen.getByText("Created", { selector: "th" })).toBeTruthy();
  expect(screen.queryByText("Range", { selector: "th" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Validate/i }));
  await waitFor(() => expect(screen.getByText("PASSED")).toBeTruthy());
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/v1/tally/validate"));
  expect(call).toBeTruthy();
  const toM = String(call[0]).match(/to=([^&]*)/);
  expect(toM).toBeTruthy();
  // Inclusive to-day: backend `to` is exclusive, so frontend must send next-day midnight.
  expect(decodeURIComponent(toM?.[1] ?? "")).toMatch(/T00:00:00$/);
});

test("batch history shows file + status and mark-imported posts + reloads", async () => {
  const fetchMock = baseStub();
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() => expect(screen.getByText("TALLY_EXPORT_2026_09.xlsx")).toBeTruthy());
  expect(screen.getByText("GENERATED")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Mark imported b-1/i }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/exports/b-1/mark-imported")),
    ).toBe(true),
  );
});

test("validation envelope error shows alert with retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/mapping") || u.includes("/exports") || u.includes("/batches")) {
        return { ok: true, json: async () => ({ success: true, data: u.includes("mapping") ? {} : { items: [] } }) };
      }
      return { ok: true, json: async () => ({ success: false, error: { code: "BAD_REQUEST", message: "boom" } }) };
    }),
  );
  renderPage();
  await waitFor(() => expect(screen.getByRole("button", { name: /Validate/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Validate/i }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByText(/Retry/i)).toBeTruthy();
});
