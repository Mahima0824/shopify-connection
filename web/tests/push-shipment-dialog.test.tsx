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
  { id: "o3", order_no: "MAN-3", customer_name: "Sunita Rao",
    receiver_city: "Mumbai", receiver_pincode: "400001", shipment_id: null },
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

function pushError(status: number, code: string, message: string) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/shipments/push")) {
      return {
        ok: false,
        status,
        json: async () => ({ success: false, error: { code, message } }),
      };
    }
    return { ok: true, json: async () => ({ success: true, data: ORDERS }) };
  });
}

function previewValues(): string[] {
  return Array.from(document.querySelectorAll("dl dd")).map((n) => n.textContent ?? "");
}

function fieldErrorFor(label: string): string | null {
  const holder = screen.getByLabelText(label).closest("div");
  if (!holder) return null;
  const alert = holder.querySelector('[role="alert"]');
  return alert?.textContent?.trim() ?? null;
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

test("the payload preview shows the values that will actually be sent", async () => {
  vi.stubGlobal("fetch", stubFetch());
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={() => {}} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Order")).toBeTruthy());
  await waitFor(() => expect(previewValues()).toEqual([
    "Dileep Kumar · Nashik",
    "—",
    "India",
    "Road",
  ]));

  fireEvent.change(screen.getByLabelText("Order"), { target: { value: "o3" } });
  await waitFor(() => expect(previewValues()).toEqual([
    "Sunita Rao · Mumbai",
    "—",
    "India",
    "Road",
  ]));
});

test("the tracking number input is marked required", async () => {
  vi.stubGlobal("fetch", stubFetch());
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={() => {}} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Tracking No")).toBeTruthy());
  const input = screen.getByLabelText("Tracking No") as HTMLInputElement;
  expect(input.hasAttribute("required")).toBe(true);
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

  const notice = screen.getByRole("status");
  expect(notice.textContent).toContain("please try again later");
  expect(screen.queryAllByRole("alert")).toHaveLength(0);
  expect(fieldErrorFor("Tracking No")).toBeNull();
  expect(fieldErrorFor("Courier")).toBeNull();
  expect(fieldErrorFor("Order")).toBeNull();
});

test("a validation code from the backend lands on the field it belongs to", async () => {
  vi.stubGlobal(
    "fetch",
    pushError(400, "INVALID_TRACKING_NUMBER_LENGTH", "Tracking number must be 64 characters or fewer."),
  );
  const onPushed = vi.fn();
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Tracking No")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));

  await waitFor(() =>
    expect(fieldErrorFor("Tracking No")).toBe(
      "Tracking number must be 64 characters or fewer.",
    ),
  );
  expect(fieldErrorFor("Order")).toBeNull();
  expect(fieldErrorFor("Courier")).toBeNull();
  expect(screen.queryAllByRole("status")).toHaveLength(0);
  expect(screen.queryAllByRole("alert")).toHaveLength(1);
  expect(onPushed).not.toHaveBeenCalled();
});

test("a 502 says the shipment was saved and will retry, and does not call onPushed", async () => {
  vi.stubGlobal(
    "fetch",
    pushError(502, "SHIPSAGAR_TIMEOUT", "ShipSagar request timed out."),
  );
  const onPushed = vi.fn();
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Tracking No")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));

  await waitFor(() => expect(screen.getByText("ShipSagar request timed out.")).toBeTruthy());
  const notice = screen.getByRole("status").textContent ?? "";
  expect(notice).toContain("ShipSagar request timed out.");
  expect(notice).toContain("Shipment saved");
  expect(notice).toMatch(/queued/i);
  expect(notice).toMatch(/retry/i);
  expect(notice).not.toContain("could not be reached");
  expect(screen.queryAllByRole("alert")).toHaveLength(0);
  expect(onPushed).not.toHaveBeenCalled();
});

test("an unrecognised code still shows the server message in a banner", async () => {
  vi.stubGlobal(
    "fetch",
    pushError(403, "FORBIDDEN", "Warehouse role required"),
  );
  const onPushed = vi.fn();
  render(
    <PushShipmentDialog open onClose={() => {}} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() => expect(screen.getByLabelText("Tracking No")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));

  await waitFor(() => expect(screen.getByText("Warehouse role required")).toBeTruthy());
  expect(screen.getByRole("alert").textContent).toContain("Warehouse role required");
  expect(screen.queryByText("Failed to push shipment")).toBeNull();
  expect(screen.queryAllByRole("status")).toHaveLength(0);
  expect(onPushed).not.toHaveBeenCalled();
});

test("reopening the dialog resets every field from the previous attempt", async () => {
  vi.stubGlobal(
    "fetch",
    pushError(400, "DUPLICATE_TRACKING", "Tracking number EG1 is already used for IP."),
  );
  const onPushed = vi.fn();
  const onClose = vi.fn();
  const { rerender } = render(
    <PushShipmentDialog open onClose={onClose} onPushed={onPushed} defaultOrderId="o1" />,
  );
  await waitFor(() =>
    expect((screen.getByLabelText("Order") as HTMLSelectElement).value).toBe("o1"),
  );

  fireEvent.change(screen.getByLabelText("Tracking No"), { target: { value: "EG1" } });
  fireEvent.change(screen.getByLabelText("Courier"), { target: { value: "OTHER" } });
  fireEvent.change(screen.getByLabelText("Custom courier code"), { target: { value: "dtc" } });
  fireEvent.click(screen.getByText("Push shipment", { selector: "button" }));
  await waitFor(() =>
    expect(screen.getByText("Tracking number EG1 is already used for IP.")).toBeTruthy(),
  );
  expect((screen.getByLabelText("Custom courier code") as HTMLInputElement).value).toBe("dtc");
  expect(previewValues()[0]).toBe("Dileep Kumar · Nashik");

  fireEvent.click(screen.getByLabelText("Close dialog"));
  expect(onClose).toHaveBeenCalled();
  rerender(
    <PushShipmentDialog open={false} onClose={onClose} onPushed={onPushed} defaultOrderId="o3" />,
  );
  expect(screen.queryByLabelText("Tracking No")).toBeNull();

  rerender(
    <PushShipmentDialog open onClose={onClose} onPushed={onPushed} defaultOrderId="o3" />,
  );
  await waitFor(() =>
    expect((screen.getByLabelText("Order") as HTMLSelectElement).value).toBe("o3"),
  );
  expect((screen.getByLabelText("Tracking No") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Courier") as HTMLSelectElement).value).toBe("IP");
  expect(screen.queryByLabelText("Custom courier code")).toBeNull();
  expect(screen.queryAllByRole("alert")).toHaveLength(0);
  expect(screen.queryAllByRole("status")).toHaveLength(0);
  expect(previewValues()).toEqual(["Sunita Rao · Mumbai", "—", "India", "Road"]);
  expect(onPushed).not.toHaveBeenCalled();
});
