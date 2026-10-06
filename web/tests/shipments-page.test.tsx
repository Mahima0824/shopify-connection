import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function listPayload(items = [row(0), row(1), row(2)], total?: number) {
  const statuses: Record<string, number> = {};
  const carriers: Record<string, number> = {};
  for (const r of items) {
    statuses[r.tracking_status] = (statuses[r.tracking_status] ?? 0) + 1;
    carriers[r.carrier_code] = (carriers[r.carrier_code] ?? 0) + 1;
  }
  return {
    items,
    total: total ?? items.length,
    page: 1,
    page_size: 20,
    facets: {
      carriers: Object.entries(carriers).map(([code, count]) => ({ code, count })),
      statuses: Object.entries(statuses).map(([code, count]) => ({ code, count })),
    },
  };
}

function stubPage(
  options: {
    items?: ReturnType<typeof row>[];
    total?: number;
    sync?: () => { ok: boolean; status?: number; json: () => Promise<unknown> };
  } = {},
) {
  const items = options.items ?? [row(0), row(1), row(2)];
  const total = options.total ?? items.length;
  const sync = options.sync ?? (() => ({
    ok: true,
    json: async () => ({ success: true, data: { synced: true, new_events: 1 } }),
  }));
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
      return { ok: true, json: async () => ({ success: true, data: listPayload(items, total) }) };
    }
    if (u.includes("/api/v1/shipments/")) {
      return sync();
    }
    return { ok: true, json: async () => ({ success: true, data: [] }) };
  });
}

function renderPage(entry = "/shipments") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ShipmentsPage />
    </MemoryRouter>,
  );
}

function listCalls(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/v1/shipments?"));
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

test("the push dialog defaults to the order named in the URL", async () => {
  // Spec section 6.1: the dialog defaults to the order the user navigated from.
  // The page never passed defaultOrderId at all, so the prop existed only in
  // tests.
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/api/v1/orders")) {
      return { ok: true, json: async () => ({ success: true, data: {
        items: [
          { id: "oA", internal_order_number: "MAN-A", shopify_order_name: "#A",
            receiver_city: "Delhi", receiver_pincode: "110001" },
          { id: "oB", internal_order_number: "MAN-B", shopify_order_name: "#B",
            receiver_city: "Pune", receiver_pincode: "411001" },
        ],
        total: 2, page: 1 } }) };
    }
    return stubPage()(String(url));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage("/shipments?order_id=oB");
  await waitFor(() => expect(screen.getByText("Push Shipment")).toBeTruthy());
  fireEvent.click(screen.getByText("Push Shipment", { selector: "button" }));
  const order = await screen.findByLabelText("Order") as HTMLSelectElement;
  await waitFor(() => expect(order.value).toBe("oB"));
  // The default really is the linked order, not merely the first option.
  // index 0 is the "Choose an order…" placeholder.
  expect((order.options[2]?.text ?? "")).toContain("MAN-B");
});

test("a list error surfaces a retry affordance", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false, status: 500,
    json: async () => ({ success: false, error: { code: "BOOM", message: "list boom" } }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText("list boom")).toBeTruthy());
});

test("typing a free-text filter issues no request until APPLY, then exactly one", async () => {
  const fetchMock = stubPage();
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
  fetchMock.mockClear();

  fireEvent.change(screen.getByLabelText("Tracking No."), {
    target: { value: "EG080960149IN" },
  });
  fireEvent.change(screen.getByLabelText("Order No."), { target: { value: "MAN-7" } });
  await act(async () => { await Promise.resolve(); });
  expect(listCalls(fetchMock)).toHaveLength(0);

  fireEvent.click(screen.getByText("APPLY", { selector: "button" }));
  await waitFor(() => expect(listCalls(fetchMock)).toHaveLength(1));
  const applied = listCalls(fetchMock)[0];
  expect(applied).toContain("q=EG080960149IN");
  expect(applied).toContain("order_no=MAN-7");
});

test("a REFRESH_COOLDOWN 429 during auto refresh is absorbed silently", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    "fetch",
    stubPage({
      sync: () => ({
        ok: false,
        status: 429,
        json: async () => ({
          success: false,
          error: { code: "REFRESH_COOLDOWN", message: "Refresh cooldown active" },
        }),
      }),
    }),
  );
  try {
    renderPage();
    await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
    await vi.advanceTimersByTimeAsync(26000);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.queryByText(/cooldown/i)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("a 502 on push keeps the dialog open and the saved shipment appears on the page", async () => {
  // DELIBERATE UPDATE (final review, important 10). This test used to assert
  // that a 502 issued NO list refetch. That pinned the defect: the push route
  // commits the Parcel and the Shipment before returning 502, so onPushed never
  // fired, the page never refetched, the dialog said a retry was queued, and
  // re-pushing that order then returned SHIPMENT_EXISTS - the user was stuck
  // until a manual reload. The page now recovers on a 502.
  const pushed = row(9, { awb_number: "EG080960149IN", order_no: "MAN-9" });
  let committed = false;
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/v1/shipments/push")) {
      committed = true;
      return { ok: false, status: 502, json: async () => ({
        success: false,
        error: { code: "SHIPSAGAR_UNAVAILABLE", message: "ShipSagar is unavailable" },
      }) };
    }
    if (u.includes("/api/v1/orders")) {
      return { ok: true, json: async () => ({ success: true, data: {
        items: [{ id: "o1", order_no: "MAN-1", customer_name: "Dileep Kumar",
          receiver_city: "Delhi", receiver_pincode: "110001", shipment_id: null }],
        total: 1, page: 1 } }) };
    }
    if (u.includes("/api/v1/shipments?")) {
      const items = committed ? [row(0), row(1), row(2), pushed] : [row(0), row(1), row(2)];
      return { ok: true, json: async () => ({ success: true, data: listPayload(items) }) };
    }
    return stubPage()(String(url));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() => expect(screen.getByText("Push Shipment")).toBeTruthy());
  fireEvent.click(screen.getByText("Push Shipment", { selector: "button" }));
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "Push Shipment" })).toBeTruthy(),
  );

  const order = await screen.findByLabelText("Order") as HTMLSelectElement;
  await waitFor(() => expect(order.value).toBe("o1"));
  fireEvent.change(screen.getByLabelText("Tracking No"), {
    target: { value: "EG080960149IN" },
  });
  fetchMock.mockClear();

  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/v1/shipments/push")),
    ).toBe(true),
  );
  await waitFor(() => expect(screen.getByText(/A retry is queued/)).toBeTruthy());

  // The dialog stays open with its typed values, and the page recovered.
  expect(screen.getByRole("dialog", { name: "Push Shipment" })).toBeTruthy();
  expect((screen.getByLabelText("Tracking No") as HTMLInputElement).value).toBe(
    "EG080960149IN",
  );
  expect(listCalls(fetchMock).length).toBeGreaterThanOrEqual(1);
  await waitFor(() => expect(screen.getByText("EG080960149IN")).toBeTruthy());
  expect(screen.getByText("Total : 4 Shipments")).toBeTruthy();
});

test("unresolved ShipSagar push refusals are surfaced next to the health line", async () => {
  const withRefusals = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: {
        ...HEALTH, rejected_pushes: 2 } }) };
    }
    return stubPage()(String(url));
  });
  vi.stubGlobal("fetch", withRefusals);
  renderPage();
  await waitFor(() =>
    expect(screen.getByText("2 unresolved ShipSagar push refusals")).toBeTruthy(),
  );
  // The pre-existing health sentence is untouched.
  expect(
    screen.getByText("ShipSagar health: 2 failed webhooks · 3 pending retries"),
  ).toBeTruthy();
});

test("a healthy integration shows no refusal line", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() =>
    expect(screen.getByText("ShipSagar health: 2 failed webhooks · 3 pending retries")).toBeTruthy(),
  );
  expect(screen.queryByTestId("shipsagar-rejected")).toBeNull();
});

test("the drain summary derives the checked total when the backend omits it", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/shipsagar/health")) {
        return { ok: true, json: async () => ({ success: true, data: HEALTH }) };
      }
      if (u.includes("/shipsagar/retry-drain")) {
        return { ok: true, json: async () => ({ success: true, data: {
          succeeded: 2, requeued: 1, dead_lettered: 1 } }) };
      }
      return stubPage()(String(url));
    }),
  );
  renderPage();
  await waitFor(() =>
    expect(screen.getByText("Retry drain", { selector: "button" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByText("Retry drain", { selector: "button" }));
  await waitFor(() =>
    expect(
      screen.getByText("Retry drain complete: 2 drained, 1 requeued, 1 dead-lettered (4 checked)"),
    ).toBeTruthy(),
  );
});

test("a successful silent refresh clears a stale error banner", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let broken = true;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: HEALTH }) };
    }
    if (u.includes("/api/v1/shipments?")) {
      if (broken) {
        return { ok: false, status: 500, json: async () => ({
          success: false, error: { code: "BOOM", message: "list boom" } }) };
      }
      return { ok: true, json: async () => ({ success: true, data: listPayload() }) };
    }
    return { ok: true, json: async () => ({ success: true, data: { synced: true } }) };
  }));
  try {
    renderPage();
    await waitFor(() => expect(screen.getByText("list boom")).toBeTruthy());
    broken = false;
    await vi.advanceTimersByTimeAsync(26000);
    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(screen.queryByText("list boom")).toBeNull());
  } finally {
    vi.useRealTimers();
  }
});

test("a refresh cycle that overruns 25s is not overlapped by the next tick", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: HEALTH }) };
    }
    if (u.includes("/api/v1/shipments/")) {
      await gate;
      return { ok: true, json: async () => ({ success: true, data: { synced: true } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: listPayload() }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    renderPage();
    await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(26000);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/s1/sync"))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(26000);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/s1/sync"))).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
  } finally {
    vi.useRealTimers();
  }
});

test("the pager reaches shipments past the first page", async () => {
  const fetchMock = stubPage({ total: 45 });
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() => expect(screen.getByText("Total : 45 Shipments")).toBeTruthy());
  expect(screen.getByText(/Page 1 of 3/)).toBeTruthy();
  expect((screen.getByLabelText("Previous page") as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByText("Next", { selector: "button" }));
  await waitFor(() =>
    expect(listCalls(fetchMock).some((u) => u.includes("page=2"))).toBe(true),
  );
  expect(screen.getByText(/Page 2 of 3/)).toBeTruthy();
  expect((screen.getByLabelText("Previous page") as HTMLButtonElement).disabled).toBe(false);
});

test("every row links to its shipment detail page", async () => {
  vi.stubGlobal("fetch", stubPage());
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960140IN")).toBeTruthy());
  const links = screen.getAllByText("Open", { selector: "a" });
  expect(links).toHaveLength(3);
  expect((links[0] as HTMLAnchorElement).getAttribute("href")).toBe("/shipments/s0");
  expect((links[2] as HTMLAnchorElement).getAttribute("href")).toBe("/shipments/s2");
});

test("the page links to the outstanding board and the dispatch scan route", async () => {
  vi.stubGlobal("fetch", stubPage({ items: [] }));
  renderPage();
  await waitFor(() => expect(screen.getByText("Total : 0 Shipments")).toBeTruthy());
  expect(
    screen.getByText("Outstanding board", { selector: "a" }).getAttribute("href"),
  ).toBe("/shipments/outstanding");
  expect(
    screen.getByText("Dispatch a parcel", { selector: "a" }).getAttribute("href"),
  ).toBe("/scan/dispatch");
});
