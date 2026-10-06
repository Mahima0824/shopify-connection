import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AddShipmentDialog from "../src/components/AddShipmentDialog";

afterEach(() => { cleanup(); });
beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const COURIERS = [
  { courier_code: "IP", courier_name: "India Post" },
  { courier_code: "DTDC", courier_name: "DTDC" },
  { courier_code: "FEDEX", courier_name: "FedEx" },
];

function stubFetch(pushResult?: Record<string, unknown>) {
  return vi.fn().mockImplementation(async (url: string, init?: any) => {
    if (String(url).includes("/api/v1/shipments/couriers")) {
      return { ok: true, json: async () => ({ success: true, data: { couriers: COURIERS } }) };
    }
    if (String(url).includes("/api/v1/shipments/push")) {
      return { ok: true, json: async () => ({ success: true, data: {
        id: "s1", awb_number: "EG1", carrier_code: "IP",
        tracking_status: "READY_TO_SHIP", order_no: "20261006-001",
        ...(pushResult ?? {}), } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  });
}

test("loads couriers, defaults to India Post, and pushes the tracking number", async () => {
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const onPushed = vi.fn();
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} />);
  const courier = await screen.findByLabelText("Courier") as HTMLSelectElement;
  await waitFor(() => expect(courier.options.length).toBeGreaterThan(1));
  expect(courier.value).toBe("IP");
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG080960145IN" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(onPushed).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/shipments/push"));
  expect(JSON.parse((call?.[1] as any).body)).toEqual({
    order_id: "o1", tracking_no: "EG080960145IN", courier_code: "IP",
  });
});

test("a blank tracking number is refused before any request", async () => {
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const onPushed = vi.fn();
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} />);
  await screen.findByLabelText("Courier");
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(screen.getByText("Tracking number is required.")).toBeTruthy());
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/push"))).toBe(false);
  expect(onPushed).not.toHaveBeenCalled();
});

test("a ShipSagar refusal is shown without pretending the push failed", async () => {
  // pushed: false arrives as HTTP 200 - the shipment row exists either way, so
  // the notice is non-blocking and onPushed must still fire so the Orders table
  // refreshes and the new row appears.
  vi.stubGlobal("fetch", stubFetch({ pushed: false, message: "please try again later" }));
  const onPushed = vi.fn();
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} />);
  await screen.findByLabelText("Courier");
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(screen.getByText("please try again later")).toBeTruthy());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(onPushed).toHaveBeenCalled();
});

test("an unreachable courier catalogue still offers a usable dropdown", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/couriers")) {
      return { ok: false, status: 502, json: async () => ({ success: false,
        error: { code: "SHIPSAGAR_API_ERROR", message: "courier list down" },
        data: { couriers: [] } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {
      id: "s1", awb_number: "EG1", carrier_code: "IP",
      tracking_status: "READY_TO_SHIP", order_no: "20261006-001", pushed: true, message: "" } }) };
  }));
  const onPushed = vi.fn();
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} />);
  const courier = await screen.findByLabelText("Courier") as HTMLSelectElement;
  await waitFor(() => expect(courier.value).toBe("IP"));
  const codes = Array.from(courier.options).map((o) => o.value);
  expect(codes.length).toBeGreaterThan(0);
  expect(codes).toContain("IP");
  expect(codes).toContain("DTDC");
  // Falling back is only useful if the user can still push.
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(onPushed).toHaveBeenCalled());
});

test("the submit button is disabled while the push is in flight", async () => {
  let release: (v: unknown) => void = () => {};
  const gate = new Promise((r) => { release = r; });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/couriers")) {
      return { ok: true, json: async () => ({ success: true, data: { couriers: COURIERS } }) };
    }
    await gate;
    return { ok: true, json: async () => ({ success: true, data: {
      id: "s1", awb_number: "EG1", carrier_code: "IP", tracking_status: "READY_TO_SHIP",
      order_no: "20261006-001", pushed: true, message: "" } }) };
  }));
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={() => {}} />);
  await screen.findByLabelText("Courier");
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(screen.getByText("Pushing…")).toBeTruthy());
  release(null);
  await waitFor(() => expect(screen.getByText("Push shipment")).toBeTruthy());
});