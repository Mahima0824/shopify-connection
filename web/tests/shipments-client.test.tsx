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

test("status tone covers the whole vocabulary", () => {
  expect(SHIPMENT_STATUSES).toContain("DELIVERED");
  expect(SHIPMENT_STATUSES).toContain("READY_TO_SHIP");
  for (const s of SHIPMENT_STATUSES) {
    expect(["success", "info", "warning", "danger", "neutral"]).toContain(statusTone(s));
    if (s !== "NOT_CREATED") expect(statusTone(s)).not.toBe("neutral");
  }
  expect(statusTone("DELIVERED")).toBe("success");
  expect(statusTone("RETURNED")).toBe("danger");
  expect(statusTone("FAILED_ATTEMPT")).toBe("warning");
  expect(statusTone("NOT_CREATED")).toBe("neutral");
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
  expect(formatEntryDate("2026-10-03T15:16:05+00:00")).toMatch(/\d/);
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

test("listOrdersForPush tolerates both list and items shapes", async () => {
  const rows = [{ id: "o1", order_no: "MAN-1", customer_name: "D", receiver_city: "N",
                  receiver_pincode: "422001", shipment_id: null }];
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ success: true, data: { items: rows, total: 1 } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const out = await listOrdersForPush();
  expect(out).toHaveLength(1);
  expect(out[0].id).toBe("o1");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/orders");
});
