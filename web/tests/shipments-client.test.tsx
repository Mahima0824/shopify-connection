import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  COURIER_OPTIONS,
  SHIPMENT_STATUSES,
  TERMINAL_STATUSES,
  carrierLabel,
  formatEntryDate,
  isPushable,
  isTerminal,
  statusTone,
  validatePush,
} from "../src/lib/shipments";
import { listOrdersForPush, listShipments, pushShipment, syncShipment } from "../src/lib/api";

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
  RETURNED: "danger",
  LOST: "danger",
  EXCEPTION: "warning",
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
  expect([...TERMINAL_STATUSES]).toEqual(["DELIVERED", "RETURNED", "RTO", "LOST"]);
  expect(isTerminal("DELIVERED")).toBe(true);
  expect(isTerminal("IN_TRANSIT")).toBe(false);
});

test("courier options include IP, DTDC and FEDEX", () => {
  const codes = COURIER_OPTIONS.map((o) => o.code);
  expect(codes).toContain("IP");
  expect(codes).toContain("DTDC");
  expect(codes).toContain("FEDEX");
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

test("push validation requires a tracking number and a courier", () => {
  expect(validatePush({ tracking_no: "", courier_code: "" })).toEqual({
    tracking_no: "Tracking number is required.",
    courier_code: "Courier is required.",
  });
  expect(validatePush({ tracking_no: "  ", courier_code: "IP" })).toHaveProperty("tracking_no");
  expect(validatePush({ tracking_no: "EG1", courier_code: "IP" })).toEqual({});
});

test("isPushable blocks orders that already carry a shipment", () => {
  expect(isPushable({ shipment_id: null })).toBe(true);
  expect(isPushable({ shipment_id: "s1" })).toBe(false);
  expect(isPushable(null)).toBe(false);
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

const PUSH_ORDER_ROWS = [
  { id: "o1", order_no: "MAN-1", customer_name: "D", receiver_city: "N",
    receiver_pincode: "422001", shipment_id: null },
];

test("listOrdersForPush reads the items envelope shape", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: { items: PUSH_ORDER_ROWS, total: 1 } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await listOrdersForPush();
  expect(out).toHaveLength(1);
  expect(out[0].id).toBe("o1");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/orders");
});

test("listOrdersForPush returns a bare array response unchanged", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: PUSH_ORDER_ROWS }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await listOrdersForPush();
  expect(out).toHaveLength(1);
  expect(out[0]).toEqual(PUSH_ORDER_ROWS[0]);
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/orders");
});