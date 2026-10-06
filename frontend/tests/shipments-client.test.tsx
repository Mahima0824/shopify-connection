import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AWAITING_TRACKING,
  PUSH_STATES,
  SHIPMENT_STATUSES,
  TERMINAL_STATUSES,
  carrierLabel,
  formatEntryDate,
  formatOrderAmount,
  isAwaiting,
  isTerminal,
  pushOrderLabel,
  pushStateLabel,
  statusTone,
} from "../src/lib/shipments";
import {
  getShipmentCouriers,
  getShipmentHistory,
  listShipments,
  pushShipment,
  syncShipment,
} from "../src/lib/api";

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { localStorage.clear(); });

const EXPECTED_TONES: Record<string, string> = {
  NOT_CREATED: "neutral",
  READY_TO_SHIP: "info",
  IN_TRANSIT: "info",
  OUT_FOR_DELIVERY: "info",
  DELIVERED: "success",
  FAILED_ATTEMPT: "warning",
  RTO: "danger",
  RTO_DELIVERED: "danger",
  RETURNED: "danger",
  LOST: "danger",
  CLOSED: "neutral",
  EXCEPTION: "warning",
  AWAITING_TRACKING: "info",
};

test("status tone covers the whole vocabulary", () => {
  expect(SHIPMENT_STATUSES).toContain("DELIVERED");
  expect(SHIPMENT_STATUSES).toContain("READY_TO_SHIP");
  expect([...SHIPMENT_STATUSES].sort()).toEqual(Object.keys(EXPECTED_TONES).sort());
  for (const s of SHIPMENT_STATUSES) {
    expect(statusTone(s)).toBe(EXPECTED_TONES[s]);
  }
  expect(statusTone(undefined)).toBe("neutral");
});

test("terminal statuses are the non-refreshing ones", () => {
  // DELIBERATE UPDATE (final review, minor 2). The page and the backend
  // disagreed: RTO was terminal to the page but not to the backend, so a
  // ShipSagar RTO parcel stopped refreshing and could never reach RETURNED,
  // while RTO_DELIVERED and CLOSED were terminal to the backend and not to the
  // page. The page now mirrors backend/app/services/shipment_service.py
  // TERMINAL exactly; test_terminal_status_vocabulary_is_shared_by_the_backend
  // _and_the_page in backend/tests/test_shipsagar.py pins the other half.
  expect([...TERMINAL_STATUSES]).toEqual([
    "DELIVERED", "RETURNED", "LOST", "RTO_DELIVERED", "CLOSED",
  ]);
  expect(isTerminal("DELIVERED")).toBe(true);
  expect(isTerminal("IN_TRANSIT")).toBe(false);
  // RTO is forward-progressible (RTO -> RETURNED), so it keeps refreshing.
  expect(isTerminal("RTO")).toBe(false);
  // Every terminal status must also be a real, tone-carrying, filterable state.
  for (const s of TERMINAL_STATUSES) {
    expect(SHIPMENT_STATUSES).toContain(s);
  }
});

test("courier codes render in their canonical upper-case form", () => {
  expect(carrierLabel("ip")).toBe("IP");
  expect(carrierLabel("")).toBe("—");
});

test("entry date formatting returns a date or an em dash", () => {
  const iso = "2026-10-03T15:16:05+00:00";
  const formatted = formatEntryDate(iso);
  expect(formatted).not.toBe("—");
  expect(formatted).not.toBe(iso);
  expect(formatted).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(formatted).not.toContain("T15:16");
  expect(formatted).toContain("2026");
  expect(formatEntryDate(null)).toBe("—");
  expect(formatEntryDate("")).toBe("—");
  expect(formatEntryDate("not-a-date")).toBe("—");
});

test("the push picker labels an order from fields the orders API actually returns", () => {
  expect(pushOrderLabel({ id: "o1", internal_order_number: "MAN-1" })).toBe("MAN-1");
  // shopify_order_name is the fallback, then the id, so a row is never blank.
  expect(pushOrderLabel({ id: "o2", shopify_order_name: "#1002" })).toBe("#1002");
  expect(pushOrderLabel({ id: "o3" })).toBe("o3");
  expect(pushOrderLabel(null)).toBe("—");
  expect(pushOrderLabel({ id: "o4", internal_order_number: "  " })).toBe("o4");
});

test("order amounts format from the currency the orders API returns", () => {
  expect(formatOrderAmount({ total_amount: 1499, currency: "INR" })).toContain("INR");
  expect(formatOrderAmount({ total_amount: 1499, currency: "INR" })).toContain("1,499");
  expect(formatOrderAmount({ total_amount: 0, currency: "INR" })).toContain("0");
  expect(formatOrderAmount({ total_amount: null })).toBe("—");
  expect(formatOrderAmount({ total_amount: NaN })).toBe("—");
  expect(formatOrderAmount(null)).toBe("—");
});

test("listShipments unwraps items and facets", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: {
      items: [{ id: "s1", awb_number: "EG1" }], total: 1, page: 1, page_size: 20,
      facets: {
        carriers: [{ code: "IP", count: 1 }],
        statuses: [{ code: "DELIVERED", count: 1 }],
      } } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await listShipments({ status: "DELIVERED" });
  expect(out.total).toBe(1);
  expect(out.facets.carriers[0].code).toBe("IP");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/shipments?status=DELIVERED");
});

test("listShipments omits empty filters, trims the rest and pins the whole query string", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: {
      items: [], total: 0, page: 1, page_size: 20,
      facets: { carriers: [], statuses: [] } } }),
  });
  vi.stubGlobal("fetch", fetchMock);

  await listShipments({
    date_from: "2026-10-01",
    date_to: "",
    q: "  EG1  ",
    order_no: "   ",
    status: "delivered",
    carrier: "ip",
    page: 1,
    page_size: 25,
  });
  expect(String(fetchMock.mock.calls[0][0])).toMatch(
    /\/api\/v1\/shipments\?date_from=2026-10-01&q=EG1&status=DELIVERED&carrier=IP&page_size=25$/,
  );

  await listShipments({ page: 3 });
  expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/api\/v1\/shipments\?page=3$/);

  await listShipments({ q: "  ", order_no: "", date_from: undefined, date_to: undefined });
  expect(String(fetchMock.mock.calls[2][0])).toMatch(/\/api\/v1\/shipments$/);

  await listShipments();
  expect(String(fetchMock.mock.calls[3][0])).toMatch(/\/api\/v1\/shipments$/);
});

test("listShipments keeps every order-joined display field null when the Order row is missing", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: {
      items: [{
        id: "s2", business_id: "b1", order_id: "o-missing", parcel_id: "p1",
        carrier_code: "IP", awb_number: "EG2", tracking_status: "NOT_CREATED",
        entry_datetime: null, shipment_type: "Road", country_name: "India",
        order_no: null, customer_name: null, customer_email: null,
        customer_mobile: null, company_name: null,
      }],
      total: 1, page: 1, page_size: 20,
      facets: { carriers: [{ code: "IP", count: 1 }], statuses: [{ code: "NOT_CREATED", count: 1 }] } } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await listShipments();
  expect(out.items[0]).toMatchObject({
    order_no: null,
    customer_name: null,
    customer_email: null,
    customer_mobile: null,
    company_name: null,
    entry_datetime: null,
    shipment_type: "Road",
    country_name: "India",
  });
  expect(out.items[0].awb_number).toBe("EG2");
  expect(statusTone(out.items[0].tracking_status)).toBe("neutral");
});

test("pushShipment POSTs to /shipments/push", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { id: "s1", pushed: true, message: "ok" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await pushShipment({ order_id: "o1", tracking_no: "EG1", courier_code: "IP" });
  expect(out.pushed).toBe(true);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/api/v1/shipments/push");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({
    order_id: "o1", tracking_no: "EG1", courier_code: "IP",
  });
});

test("syncShipment POSTs to the shipment sync route", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { synced: true, new_events: 2 } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await syncShipment("s1");
  expect(out.synced).toBe(true);
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/shipments/s1/sync");
  expect(fetchMock.mock.calls[0][1].method).toBe("POST");
});

test("AWAITING_TRACKING is filterable but not terminal", () => {
  expect(AWAITING_TRACKING).toBe("AWAITING_TRACKING");
  expect(SHIPMENT_STATUSES).toContain(AWAITING_TRACKING);
  // Deliberately NOT terminal here. The backend treats it as terminal because
  // there is no tracking number to poll, but on the page it is precisely the
  // state that prompts the user for one, so it must stay actionable. A future
  // "tidy-up" that adds it to TERMINAL_STATUSES would hide those rows.
  expect(TERMINAL_STATUSES as readonly string[]).not.toContain(AWAITING_TRACKING);
  expect(isTerminal(AWAITING_TRACKING)).toBe(false);
  expect(statusTone(AWAITING_TRACKING)).toBe("info");
  expect(isAwaiting({ push_state: "awaiting" })).toBe(true);
  expect(isAwaiting({ push_state: "pushed" })).toBe(false);
  expect(isAwaiting(null)).toBe(false);
  expect(isAwaiting({})).toBe(false);
  expect(pushStateLabel("none")).toBe("No shipment");
  expect(pushStateLabel("awaiting")).toBe("Awaiting tracking number");
  expect(pushStateLabel("pushed")).toBe("Tracking");
  expect(pushStateLabel("rejected")).toBe("Not accepted by ShipSagar");
  // An unknown state must never render as blank or as "Tracking".
  expect(pushStateLabel("something-new")).toBe("No shipment");
  expect(pushStateLabel(null)).toBe("No shipment");
  expect(PUSH_STATES).toEqual(["none", "awaiting", "pushed", "rejected"]);
});

test("isAwaiting means the button can do something, not merely that the label says so", () => {
  // A Dispatch-booked or create_shipment row owns a real AWB and no SS- id, so
  // the backend reports push_state "awaiting" — but pushing it can only 400
  // (SHIPMENT_EXISTS, or NON_COURIER_CODES for MANUAL). isAwaiting gates the
  // Add Shipment button, so it has to agree with the push route's own adoption
  // test: only a shipment with no tracking number yet can be pushed.
  const awaiting = { push_state: "awaiting", carrier_code: "INDIA_POST", awb_number: null };
  expect(isAwaiting(awaiting)).toBe(true);
  // A booked row: real AWB, so SHIPMENT_EXISTS on any push.
  expect(isAwaiting({ ...awaiting, awb_number: "EG080960145IN" })).toBe(false);
  expect(isAwaiting({ ...awaiting, push_state: "pushed", awb_number: "EG1" })).toBe(false);
  // MANUAL can never be pushed: register_tracking refuses it as a courier.
  expect(isAwaiting({ ...awaiting, carrier_code: "MANUAL" })).toBe(false);
  expect(isAwaiting({ ...awaiting, carrier_code: "manual" })).toBe(false);
  expect(isAwaiting({ ...awaiting, carrier_code: " ip " })).toBe(true);
});

test("getShipmentCouriers unwraps the courier list", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { couriers: [
      { courier_code: "IP", courier_name: "India Post" }] } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await getShipmentCouriers();
  expect(out[0].courier_code).toBe("IP");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/shipments/couriers");
});

test("getShipmentCouriers yields an empty list, not a rejection, when the catalogue is down", async () => {
  // GET /api/v1/shipments/couriers answers 502 with data.couriers === [] when
  // ShipSagar has no cached catalogue. The Add Shipment dialog must still be
  // able to open and push, so the client resolves to an array on failure.
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => ({
      success: false,
      error: { code: "SHIPSAGAR_API_ERROR", message: "courier list down" },
      data: { couriers: [] },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  await expect(getShipmentCouriers()).resolves.toEqual([]);
});

test("getShipmentHistory returns the events newest first", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: {
      awb: "EG1", courier_code: "IP", status: "OUT_FOR_DELIVERY",
      tracking_url: null,
      events: [
        { action_date: "17-May-2023", action_time: "09:00",
          action_location: "Delhi", action_description: "Out for delivery",
          normalized_status: "OUT_FOR_DELIVERY" },
        { action_date: "16-May-2023", action_time: "12:27",
          action_location: "", action_description: "Label Created",
          normalized_status: "READY_TO_SHIP" },
      ] } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await getShipmentHistory("s1");
  expect(out.events[0].action_description).toBe("Out for delivery");
  expect(out.status).toBe("OUT_FOR_DELIVERY");
  expect(out.tracking_url).toBeNull();
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/shipments/s1/history");
});
