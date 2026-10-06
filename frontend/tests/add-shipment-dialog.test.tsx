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

test("a ShipSagar outage refreshes the order instead of inviting a doomed retry", async () => {
  // The 502 path commits the AWB and queues a retry job, so the shipment EXISTS.
  // The Orders cell would keep offering Add Shipment (push_state is still
  // "awaiting") and the retry would 400 SHIPMENT_EXISTS with no way out - so the
  // dialog must report the save, refresh, and not show a failure alert.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/api/v1/shipments/push")) {
      return { ok: false, status: 502, json: async () => ({ success: false,
        error: { code: "SHIPSAGAR_API_ERROR", message: "connection reset" },
        data: { id: "s1", awb_number: "EG1", carrier_code: "IP",
                order_no: "20261006-001", pushed: false,
                message: "connection reset" } }) };
    }
    if (String(url).includes("/couriers")) {
      return { ok: true, json: async () => ({ success: true, data: { couriers: COURIERS } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  }));
  const onPushed = vi.fn();
  const onRecovered = vi.fn();
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} onRecovered={onRecovered} />);
  await screen.findByLabelText("Courier");
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() => expect(onRecovered).toHaveBeenCalled());
  expect(screen.getByRole("status").textContent).toContain("queued");
  expect(screen.queryByRole("alert")).toBeNull();
  // onPushed is the success callback; the shipment is not "pushed" yet.
  expect(onPushed).not.toHaveBeenCalled();
  // The box is cleared so a retry cannot double-post a number already stored.
  expect((screen.getByLabelText("Tracking No") as HTMLInputElement).value).toBe("");
});

test("a null order id is refused before any request", async () => {
  // Without the guard this posts order_id: "" and earns a guaranteed 400 that
  // reads like the tracking number was the problem.
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  render(<AddShipmentDialog open orderId={null} orderLabel="MAN-1"
    onClose={() => {}} onPushed={() => {}} />);
  await screen.findByLabelText("Courier");
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() =>
    expect(screen.getByText(/No order was selected/i)).toBeTruthy());
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/push"))).toBe(false);
});

test("a backend validation code shows the server message in an alert", async () => {
  // Ported from the deleted push-shipment-dialog.test.tsx ("a validation code
  // from the backend lands on the field it belongs to" / "an unrecognised code
  // still shows the server message in a banner"). This dialog has one error
  // region rather than per-field ones, so the claim is the server's own words
  // survive: not a generic string, and no false "saved" notice.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/api/v1/shipments/push")) {
      return { ok: false, status: 400, json: async () => ({ success: false,
        error: { code: "DUPLICATE_TRACKING",
                 message: "Tracking number EG1 is already used for IP." } }) };
    }
    if (String(url).includes("/couriers")) {
      return { ok: true, json: async () => ({ success: true, data: { couriers: COURIERS } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  }));
  const onPushed = vi.fn();
  render(<AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} />);
  await screen.findByLabelText("Courier");
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() =>
    expect(screen.getByText("Tracking number EG1 is already used for IP.")).toBeTruthy(),
  );
  expect(screen.getByRole("alert").textContent)
    .toContain("Tracking number EG1 is already used for IP.");
  expect(screen.queryByRole("status")).toBeNull();
  expect(onPushed).not.toHaveBeenCalled();
});

test("reopening the dialog resets every field from the previous attempt", async () => {
  // Ported from the deleted push-shipment-dialog.test.tsx ("reopening the dialog
  // resets every field"). A stale tracking number left in the box is how one
  // order gets pushed with another order's number.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/api/v1/shipments/push")) {
      return { ok: false, status: 400, json: async () => ({ success: false,
        error: { code: "DUPLICATE_TRACKING",
                 message: "Tracking number EG1 is already used for IP." } }) };
    }
    if (String(url).includes("/couriers")) {
      return { ok: true, json: async () => ({ success: true, data: { couriers: COURIERS } }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  }));
  const onPushed = vi.fn();
  const { rerender } = render(
    <AddShipmentDialog open orderId="o1" orderLabel="MAN-1"
      onClose={() => {}} onPushed={onPushed} />,
  );
  await screen.findByLabelText("Courier");
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.change(screen.getByLabelText("Courier"), { target: { value: "FEDEX" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() =>
    expect(screen.getByText("Tracking number EG1 is already used for IP.")).toBeTruthy(),
  );

  rerender(<AddShipmentDialog open={false} orderId="o1" orderLabel="MAN-1"
    onClose={() => {}} onPushed={onPushed} />);
  expect(screen.queryByLabelText("Tracking No")).toBeNull();

  rerender(<AddShipmentDialog open orderId="o2" orderLabel="MAN-2"
    onClose={() => {}} onPushed={onPushed} />);
  await waitFor(() => expect(screen.getByLabelText("Tracking No")).toBeTruthy());
  expect((screen.getByLabelText("Tracking No") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Courier") as HTMLSelectElement).value).toBe("IP");
  expect(screen.queryAllByRole("alert")).toHaveLength(0);
  expect(screen.queryAllByRole("status")).toHaveLength(0);
  expect(onPushed).not.toHaveBeenCalled();
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