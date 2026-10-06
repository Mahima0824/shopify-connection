import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import NewOrderDialog from "../src/components/NewOrderDialog";

// Deliberately a NEW file rather than an edit to tests/new-order.test.tsx:
// that file is still untracked as part of the India Post feature, so staging it
// would commit someone else's work.

const SAVED_ORDER = { id: "o-new", internal_order_number: "20261006-001" };

function stubFetch(pushResult?: Record<string, unknown>) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("/api/v1/shipments/push")) {
      return {
        ok: true,
        json: async () => ({ success: true, data: {
          id: "s1", awb_number: "EG1", carrier_code: "IP",
          tracking_status: "READY_TO_SHIP", order_no: "20261006-001",
          ...(pushResult ?? {}),
        } }),
      };
    }
    if (String(url).endsWith("/api/v1/orders")) {
      return { ok: true, json: async () => ({ success: true, data: SAVED_ORDER }) };
    }
    return { ok: true, json: async () => ({ success: true, data: {} }) };
  });
}

function fillAndSubmitOrderForm() {
  fireEvent.change(screen.getByPlaceholderText("e.g. KIRAN PATEL"), { target: { value: "KIRAN" } });
  fireEvent.change(screen.getByPlaceholderText("10-digit mobile"), { target: { value: "9876543210" } });
  fireEvent.change(screen.getByPlaceholderText(/House \/ Flat No/), { target: { value: "12 MG Road" } });
  fireEvent.change(screen.getByPlaceholderText("City name"), { target: { value: "Nashik" } });
  fireEvent.change(screen.getByPlaceholderText("6-digit pincode"), { target: { value: "422001" } });
  fireEvent.change(screen.getByPlaceholderText("e.g. 930"), { target: { value: "930" } });
  fireEvent.change(screen.getByPlaceholderText("e.g. 1499"), { target: { value: "1499" } });
  fireEvent.click(screen.getByText("Save & Create Order", { selector: "button" }));
}

async function reachTrackingStep() {
  await waitFor(() => expect(screen.getByText("Save & push shipment")).toBeTruthy());
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("a saved order advances to a tracking step asking only for the number", async () => {
  const onSaved = vi.fn();
  vi.stubGlobal("fetch", stubFetch());
  render(<NewOrderDialog open onClose={() => {}} onSaved={onSaved} />);

  fillAndSubmitOrderForm();
  await reachTrackingStep();

  expect(screen.getByLabelText(/Tracking Number/i)).toBeTruthy();
  // Step 2 must not ask for anything else: the order form fields are gone.
  expect(screen.queryByPlaceholderText("e.g. KIRAN PATEL")).toBeNull();
  // onSaved has NOT fired yet — that is what closes the dialog, and closing on
  // save would make the tracking step unreachable.
  expect(onSaved).not.toHaveBeenCalled();
});

test("Save & push shipment posts the tracking number as an India Post courier", async () => {
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn();
  render(<NewOrderDialog open onClose={() => {}} onSaved={onSaved} />);

  fillAndSubmitOrderForm();
  await reachTrackingStep();
  fireEvent.change(screen.getByLabelText(/Tracking Number/i), { target: { value: "EG080960145IN" } });
  fireEvent.click(screen.getByText("Save & push shipment", { selector: "button" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED_ORDER));
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/shipments/push"));
  expect(JSON.parse((call?.[1] as any).body)).toEqual({
    order_id: "o-new", tracking_no: "EG080960145IN", courier_code: "IP",
  });
});

test("a ShipSagar refusal still finishes the order and shows the message", async () => {
  // pushed: false is a 200. The order must not be trapped in the dialog and the
  // caller must still refresh, or the new row never appears in the table.
  vi.stubGlobal("fetch", stubFetch({ pushed: false, message: "please try again later" }));
  const onSaved = vi.fn();
  render(<NewOrderDialog open onClose={() => {}} onSaved={onSaved} />);

  fillAndSubmitOrderForm();
  await reachTrackingStep();
  fireEvent.change(screen.getByLabelText(/Tracking Number/i), { target: { value: "EG1" } });
  fireEvent.click(screen.getByText("Save & push shipment", { selector: "button" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED_ORDER));
  expect(screen.getByText("please try again later")).toBeTruthy();
});

test("Skip for now closes with the saved order and pushes nothing", async () => {
  // This is the escape hatch: a ShipSagar outage must never block order creation.
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn();
  render(<NewOrderDialog open onClose={() => {}} onSaved={onSaved} />);

  fillAndSubmitOrderForm();
  await reachTrackingStep();
  fireEvent.click(screen.getByText("Skip for now", { selector: "button" }));

  expect(onSaved).toHaveBeenCalledWith(SAVED_ORDER);
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/shipments/push"))).toBe(false);
});

test("a blank tracking number is refused before any push request", async () => {
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn();
  render(<NewOrderDialog open onClose={() => {}} onSaved={onSaved} />);

  fillAndSubmitOrderForm();
  await reachTrackingStep();
  fireEvent.click(screen.getByText("Save & push shipment", { selector: "button" }));

  await waitFor(() => expect(screen.getByText("Tracking number is required.")).toBeTruthy());
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/shipments/push"))).toBe(false);
  expect(onSaved).not.toHaveBeenCalled();
});

test("reopening the dialog resets the tracking step", async () => {
  // A previous attempt that was abandoned at step 2 must not leak into a fresh
  // order. Held mounted (open toggled) so the effect dependency is exercised.
  const onSaved = vi.fn();
  const fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(
    <NewOrderDialog open onClose={() => {}} onSaved={onSaved} />,
  );

  fillAndSubmitOrderForm();
  await reachTrackingStep();
  fireEvent.change(screen.getByLabelText(/Tracking Number/i), { target: { value: "EG-STALE" } });

  rerender(<NewOrderDialog open={false} onClose={() => {}} onSaved={onSaved} />);
  rerender(<NewOrderDialog open onClose={() => {}} onSaved={onSaved} />);

  expect(screen.getByText("Save & Create Order")).toBeTruthy();
  expect(screen.queryByText("Save & push shipment")).toBeNull();
  fillAndSubmitOrderForm();
  await reachTrackingStep();
  expect((screen.getByLabelText(/Tracking Number/i) as HTMLInputElement).value).toBe("");
  expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/shipments/push")).length).toBe(0);
});
