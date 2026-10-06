import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ShipmentHistoryPage from "../src/pages/ShipmentHistory";

afterEach(() => { cleanup(); });
beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const HISTORY = {
  awb: "EG080960145IN", courier_code: "IP", status: "OUT_FOR_DELIVERY",
  tracking_url: null,
  events: [
    { action_date: "17-May-2023", action_time: "09:00", action_location: "New Delhi",
      action_description: "Out for delivery", normalized_status: "OUT_FOR_DELIVERY" },
    { action_date: "16-May-2023", action_time: "19:43", action_location: "",
      action_description: "Package arrived at the carrier facility",
      normalized_status: "IN_TRANSIT" },
    { action_date: "16-May-2023", action_time: "15:51", action_location: "",
      action_description: "Package picked up", normalized_status: "READY_TO_SHIP" },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/shipments/s1"]}>
      <Routes>
        <Route path="/shipments/:id" element={<ShipmentHistoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("renders the tracking number, status and every scan newest first", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: HISTORY }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960145IN")).toBeTruthy());
  expect(screen.getByText("OUT_FOR_DELIVERY")).toBeTruthy();
  // Newest-first is a claim about the WHOLE order, so it is checked as a
  // chain of consecutive pairs: every scan must precede the one after it.
  // Comparing everything against only the last entry (or against itself) would
  // still pass on a rendered 2,1,3.
  const descs = ["Out for delivery", "Package arrived at the carrier facility",
                 "Package picked up"];
  for (let i = 0; i + 1 < descs.length; i += 1) {
    const rel = screen.getByText(descs[i]).compareDocumentPosition(
      screen.getByText(descs[i + 1]));
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  // And the rendered list itself is in that order, not merely in the DOM.
  const renderedOrder = screen.getAllByRole("listitem").map(
    (li) => li.textContent ?? "");
  expect(renderedOrder.length).toBe(3);
  expect(renderedOrder[0]).toContain("Out for delivery");
  expect(renderedOrder[1]).toContain("Package arrived at the carrier facility");
  expect(renderedOrder[2]).toContain("Package picked up");
  expect(screen.getByText("New Delhi")).toBeTruthy();
  expect(screen.getByText(/17-May-2023/)).toBeTruthy();
});

test("the courier's own tracking link is rendered when the carrier provides one", async () => {
  // tracking_url was computed by the backend, typed on ShipmentHistory, and
  // never rendered: the one place that can show scans ShipSagar has not
  // delivered yet was unreachable from the page.
  const url = "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true,
      data: { ...HISTORY, tracking_url: url } }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960145IN")).toBeTruthy());
  const link = screen.getByText("Track on courier site").closest("a");
  expect(link?.getAttribute("href")).toBe(url);
  // A new tab, with noopener: the carrier page is a third-party origin.
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toContain("noopener");
});

test("no tracking link is rendered for a carrier that supplies none", async () => {
  // HISTORY.tracking_url is null, which is what DTDC and every non-HTTP provider
  // returns; a dead link would be worse than none.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: HISTORY }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText("EG080960145IN")).toBeTruthy());
  expect(screen.queryByText("Track on courier site")).toBeNull();
});

test("an empty history says so explicitly instead of rendering blank", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: { ...HISTORY, events: [] } }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText(/No scans yet/i)).toBeTruthy());
});

test("a ShipSagar failure is shown inline", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false, status: 502,
    json: async () => ({ success: false, error: { code: "SHIPSAGAR_API_ERROR",
      message: "please try again later" } }),
  }));
  renderPage();
  // The stub fails every request, so both the history call and the health
  // probe report it. What matters is that the tracking failure is rendered as
  // a real alert carrying the backend's own words, not swallowed or genericised.
  await waitFor(() =>
    expect(screen.getAllByText("please try again later").length).toBeGreaterThanOrEqual(1),
  );
  expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1);
});

test("a route with no shipment id says so instead of loading forever", async () => {
  // Without this the `!id` early return left `loading` at its initial true
  // forever, so a bad /shipments URL rendered "Loading tracking history…"
  // with no error and no way to tell it had stopped trying.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: HISTORY }),
  }));
  render(
    <MemoryRouter initialEntries={["/shipments"]}>
      <Routes>
        <Route path="/shipments" element={<ShipmentHistoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText(/No shipment was selected/i)).toBeTruthy();
  expect(screen.queryByText(/Loading tracking history/i)).toBeNull();
});

/** Routes every URL so the health probe on the page does not confuse history. */
function stubHistory(options: {
  history?: () => { ok: boolean; status?: number; json: () => Promise<unknown> };
} = {}) {
  const history = options.history ?? (() => ({
    ok: true, json: async () => ({ success: true, data: HISTORY }),
  }));
  return vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/shipsagar/health")) {
      return { ok: true, json: async () => ({ success: true, data: {
        provider: "SHIPSAGAR", configured: true, status: "warning",
        failed_webhooks: 2, failed_jobs: 0, pending_jobs: 3, unregistered_shipments: 1 } }) };
    }
    return history();
  });
}

function historyCalls(mock: ReturnType<typeof vi.fn>): number {
  return mock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/api/v1/shipments/s1/history")).length;
}

test("the 60s interval refetches the history without a manual refresh", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = stubHistory();
  vi.stubGlobal("fetch", fetchMock);
  try {
    renderPage();
    await waitFor(() => expect(screen.getByText("EG080960145IN")).toBeTruthy());
    expect(historyCalls(fetchMock)).toBe(1);

    // Nothing before the interval elapses: no polling storm on a page left open.
    await vi.advanceTimersByTimeAsync(30000);
    expect(historyCalls(fetchMock)).toBe(1);

    await vi.advanceTimersByTimeAsync(30000);
    expect(historyCalls(fetchMock)).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("unmounting clears the interval, so a closed page stops polling", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = stubHistory();
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { unmount } = renderPage();
    await waitFor(() => expect(screen.getByText("EG080960145IN")).toBeTruthy());
    expect(historyCalls(fetchMock)).toBe(1);

    unmount();
    await vi.advanceTimersByTimeAsync(180000);
    // Without clearInterval a page navigated away from keeps hitting the
    // backend every minute for as long as the tab stays open.
    expect(historyCalls(fetchMock)).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test("a REFRESH_COOLDOWN 429 during auto refresh is absorbed silently", async () => {
  // The backend rate-limits a poll with 429 REFRESH_COOLDOWN
  // (api/shipments.py:657). That is normal operation, so a banner every 60s
  // would train the operator to ignore the error area.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let cool = false;
  const fetchMock = stubHistory({
    history: () => (cool
      ? { ok: false, status: 429, json: async () => ({ success: false, error: {
          code: "REFRESH_COOLDOWN", message: "Refresh cooldown: retry after 25s" } }) }
      : { ok: true, json: async () => ({ success: true, data: HISTORY }) }),
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    renderPage();
    await waitFor(() => expect(screen.getByText("EG080960145IN")).toBeTruthy());

    cool = true;
    await vi.advanceTimersByTimeAsync(60000);
    await vi.advanceTimersByTimeAsync(0);

    expect(historyCalls(fetchMock)).toBeGreaterThanOrEqual(2);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.queryByText(/cooldown/i)).toBeNull();
    // The timeline from the last good read is still on screen.
    expect(screen.getByText("Out for delivery")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test("an explicit Refresh reports a cooldown, because the user is waiting", async () => {
  vi.stubGlobal("fetch", stubHistory({
    history: () => ({ ok: false, status: 429, json: async () => ({ success: false,
      error: { code: "REFRESH_COOLDOWN", message: "Refresh cooldown: retry after 25s" } }) }),
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText(/Refresh cooldown/i)).toBeTruthy());
});

test("an ADMIN can drain the ShipSagar retry queue from this page", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  const fetchMock = stubHistory();
  fetchMock.mockImplementation(async (url: string, init?: any) => {
    const u = String(url);
    if (u.includes("/shipsagar/retry-drain")) {
      expect(init?.method).toBe("POST");
      return { ok: true, json: async () => ({ success: true, data: {
        checked: 4, succeeded: 3, requeued: 1, dead_lettered: 0 } }) };
    }
    return stubHistory()(String(url));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
  await waitFor(() =>
    expect(screen.getByText("ShipSagar health: 2 failed webhooks · 3 pending retries"))
      .toBeTruthy(),
  );
  fireEvent.click(screen.getByText("Retry drain", { selector: "button" }));
  await waitFor(() =>
    expect(
      screen.getByText("Retry drain complete: 3 drained, 1 requeued, 0 dead-lettered (4 checked)"),
    ).toBeTruthy(),
  );
});

test("the retry drain derives the checked total when the backend omits it", async () => {
  localStorage.setItem("role", "ADMIN");
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes("/shipsagar/retry-drain")) {
      return { ok: true, json: async () => ({ success: true, data: {
        succeeded: 2, requeued: 1, dead_lettered: 1 } }) };
    }
    return stubHistory()(u);
  }));
  renderPage();
  await waitFor(() => expect(screen.getByText("Retry drain", { selector: "button" })).toBeTruthy());
  fireEvent.click(screen.getByText("Retry drain", { selector: "button" }));
  await waitFor(() =>
    expect(
      screen.getByText("Retry drain complete: 2 drained, 1 requeued, 1 dead-lettered (4 checked)"),
    ).toBeTruthy(),
  );
});

test("a non-ADMIN sees the health line but no drain control", async () => {
  localStorage.setItem("role", "VIEWER");
  vi.stubGlobal("fetch", stubHistory());
  renderPage();
  await waitFor(() =>
    expect(screen.getByText("ShipSagar health: 2 failed webhooks · 3 pending retries"))
      .toBeTruthy(),
  );
  expect(screen.queryByText("Retry drain", { selector: "button" })).toBeNull();
});
