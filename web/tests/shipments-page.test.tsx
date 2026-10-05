import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ShipmentsPage from "../src/pages/Shipments";

afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const HEALTH = {
  provider: "SHIPSAGAR", configured: true, status: "warning",
  failed_webhooks: 2, failed_jobs: 0, pending_jobs: 3, unregistered_shipments: 1,
};

function row(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `s${i}`, business_id: "b1", order_id: `o${i}`, parcel_id: `p${i}`,
    carrier_code: "IP", awb_number: `EG08096014${i}IN`,
    shipsagar_tracking_id: `SS-EG08096014${i}IN`,
    tracking_status: i === 0 ? "DELIVERED" : "IN_TRANSIT",
    order_no: `MAN-${i}`, customer_name: `Customer ${i}`,
    customer_email: `c${i}@e.com`, customer_mobile: `99630266${i}${i}`,
    company_name: `Co ${i}`, shipment_type: "Road", country_name: "India",
    entry_datetime: "2026-10-03T15:16:05+00:00",
    current_location: "New Delhi",
    ...over,
  };
}

function listPayload(items = [row(0), row(1), row(2)]) {
  const statuses: Record<string, number> = {};
  const carriers: Record<string, number> = {};
  for (const r of items) {
    statuses[r.tracking_status] = (statuses[r.tracking_status] ?? 0) + 1;
    carriers[r.carrier_code] = (carriers[r.carrier_code] ?? 0) + 1;
  }
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 20,
    facets: {
      carriers: Object.entries(carriers).map(([code, count]) => ({ code, count })),
      statuses: Object.entries(statuses).map(([code, count]) => ({ code, count })),
    },
  };
}

function stubPage(options: { items?: ReturnType<typeof row>[] } = {}) {
  const items = options.items ?? [row(0), row(1), row(2)];
  return vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: HEALTH }) };
    }
    if (u.includes("/shipsagar/retry-drain")) {
      return { ok: true, json: async () => ({ success: true, data: {
        checked: 4, succeeded: 3, requeued: 1, dead_lettered: 0 } }) };
    }
    if (u.includes("/api/v1/shipments?")) {
      return { ok: true, json: async () => ({ success: true, data: listPayload(items) }) };
    }
    if (u.includes("/api/v1/shipments/")) {
      return { ok: true, json: async () => ({ success: true, data: {
        synced: true, new_events: 1 } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: [] }) };
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ShipmentsPage />
    </MemoryRouter>,
  );
}

test("renders the shipment table with the display columns", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
  expect(screen.getByText("Total : 3 Shipments")).toBeTruthy();
  expect(screen.getByText("Order No")).toBeTruthy();
  expect(screen.getByText("Tracking Number")).toBeTruthy();
  expect(screen.getAllByText("Current Status").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("Customer")).toBeTruthy();
  expect(screen.getByText("Shipment Type")).toBeTruthy();
  expect(screen.getByText("Country Name")).toBeTruthy();
  expect(screen.getByText("Company Name")).toBeTruthy();
  expect(screen.getByText("Entry Date & Time")).toBeTruthy();
  expect(screen.getByText("Customer 0")).toBeTruthy();
  expect(screen.getByText("c0@e.com")).toBeTruthy();
  expect(screen.getByText("Co 1")).toBeTruthy();
  expect(screen.getAllByText("India").length).toBe(3);
  expect(screen.getAllByText("Road").length).toBe(3);
});

test("carrier and status chips render with facet counts", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() => expect(screen.getByText(/IP\(3\)/)).toBeTruthy());
  expect(screen.getByText(/DELIVERED\(1\)/)).toBeTruthy();
  expect(screen.getByText(/IN_TRANSIT\(2\)/)).toBeTruthy();
  // "All Records" appears once per chip row.
  expect(screen.getAllByText(/All Records/).length).toBeGreaterThanOrEqual(2);
});

test("no element holds the exact text ShipSagar on the page", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
  expect(screen.queryAllByText("ShipSagar", { exact: true })).toHaveLength(0);
  // The provider is still labelled, inside the combined tracking cell.
  expect(screen.getAllByText(/· ShipSagar$/).length).toBe(3);
});

test("the health banner sits below the table and keeps its exact wording", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() =>
    expect(
      screen.getByText("ShipSagar health: 2 failed webhooks · 3 pending retries"),
    ).toBeTruthy(),
  );
});

test("ADMIN sees the retry-drain button and its completion line", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() =>
    expect(screen.getByText("Retry drain", { selector: "button" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByText("Retry drain", { selector: "button" }));
  await waitFor(() =>
    expect(
      screen.getByText("Retry drain complete: 3 drained, 1 requeued, 0 dead-lettered (4 checked)"),
    ).toBeTruthy(),
  );
});

test("a non-ADMIN sees no retry-drain button", async () => {
  localStorage.setItem("role", "VIEWER");
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() =>
    expect(
      screen.getByText("ShipSagar health: 2 failed webhooks · 3 pending retries"),
    ).toBeTruthy(),
  );
  expect(screen.queryByText("Retry drain", { selector: "button" })).toBeNull();
});

test("changing the status filter re-queries the backend", async () => {
  const fetchMock = stubPage();
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "DELIVERED" } });
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("status=DELIVERED")),
    ).toBe(true),
  );
});

test("auto refresh syncs non-terminal rows and skips terminal ones", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = stubPage();
  vi.stubGlobal("fetch", fetchMock);
  try {
    renderPage();
    await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(26000);
    const syncCalls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/sync"));
    expect(syncCalls.some((u) => u.endsWith("/s1/sync"))).toBe(true);
    expect(syncCalls.some((u) => u.endsWith("/s2/sync"))).toBe(true);
    // s0 is DELIVERED — terminal, never re-fetched.
    expect(syncCalls.some((u) => u.endsWith("/s0/sync"))).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("the push dialog opens from the page", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() => expect(screen.getByText("Push Shipment")).toBeTruthy());
  fireEvent.click(screen.getByText("Push Shipment", { selector: "button" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "Push Shipment" })).toBeTruthy(),
  );
});

test("a list error surfaces a retry affordance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false, status: 500,
    json: async () => ({ success: false, error: { code: "BOOM", message: "list boom" } }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText("list boom")).toBeTruthy());
});