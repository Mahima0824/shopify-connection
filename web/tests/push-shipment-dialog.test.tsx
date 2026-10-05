import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import PushShipmentDialog from "../src/components/PushShipmentDialog";

afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const ORDERS = [
  { id: "o1", order_no: "MAN-1", customer_name: "Dileep Kumar",
    receiver_city: "Nashik", receiver_pincode: "422001", shipment_id: null },
  { id: "o2", order_no: "MAN-2", customer_name: "Rahul Sharma",
    receiver_city: "Pune", receiver_pincode: "411001", shipment_id: "s9" },
];

function stubFetch() {
  return vi.fn().mockImplementation(async (url: string, init?: any) => {
    if (String(url).includes("/api/v1/shipments/push")) {
      if (init?.method !== "POST") throw new Error("push must be POST");
      const body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ success: true, data: {
          id: "s1", pushed: true, message: "Data has been recorded successfully",
          awb_number: body.tracking_no, carrier_code: body.courier_code,
          tracking_status: "READY_TO_SHIP",
          shipsagar_tracking_id: `SS-${body.tracking_no}` } }),
      };
    }
    return { ok: true, json: async () => ({ success: true, data: ORDERS }) };
  });
}

test("dialog renders every field group and refuses a blank tracking number", async () => {
  vi.stubGlobal("fetch", stubFetch());
  const onPushed = vi.fn();
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Order")).toBeTruthy());
  expect(screen.getByLabelText("Tracking No")).toBeTruthy();
  expect(screen.getByLabelText("Courier")).toBeTruthy();
  expect(screen.getByText("Customer")).toBeTruthy();
  expect(screen.getByText("Company Name")).toBeTruthy();
  expect(screen.getByText("Country")).toBeTruthy();
  expect(screen.getByText("Shipment Type")).toBeTruthy();

  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(screen.getByText("Tracking number is required.")).toBeTruthy());
  expect(onPushed).not.toHaveBeenCalled();
});

test("pushing posts the typed tracking number and courier, then calls onPushed", async () => {
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const onPushed = vi.fn();
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Tracking No")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Tracking No"), {
    target: { value: "EG080960145IN" },
  });
  fireEvent.change(screen.getByLabelText("Courier"), { target: { value: "IP" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(onPushed).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/shipments/push"));
  expect(JSON.parse((call?.[1] as any).body)).toEqual({
    order_id: "o1",
    tracking_no: "EG080960145IN",
    courier_code: "IP",
  });
});

test("orders that already have a shipment cannot be selected", async () => {
  vi.stubGlobal("fetch", stubFetch());
  render(<PushShipmentDialog open onClose={() => {}} onPushed={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText("Order")).toBeTruthy());
  const select = screen.getByLabelText("Order") as HTMLSelectElement;
  const values = Array.from(select.options).map((o) => o.value);
  expect(values).toContain("o1");
  expect(values).not.toContain("o2");
});

test("a provider rejection is surfaced as a banner, not a field error", async () => {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/shipments/push")) {
      return {
        ok: true,
        json: async () => ({ success: true, data: {
          id: "s1", pushed: false, message: "please try again later" } }),
      };
    }
    return { ok: true, json: async () => ({ success: true, data: ORDERS }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const onPushed = vi.fn();
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Tracking No")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(screen.getByText("please try again later")).toBeTruthy());
  expect(onPushed).toHaveBeenCalled();
});
