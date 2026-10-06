import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import OrderTable from "../src/components/OrderTable";

afterEach(() => { cleanup(); });
beforeEach(() => { localStorage.clear(); });

function order(over: Record<string, unknown> = {}) {
  return {
    id: "o1", internal_order_number: "MAN-1", shopify_order_name: "#1",
    financial_status: "PAID", fulfillment_status: "UNFULFILLED",
    operational_status: "NEW", total_amount: 100, cod_mode: "COD",
    cod_value: 100, receiver_city: "Nashik", receiver_pincode: "422001",
    order_date: "2026-10-06T10:00:00+00:00", shipment: null, ...over,
  };
}

function renderTable(rows: any[]) {
  return render(
    <MemoryRouter>
      <OrderTable orders={rows} onAddShipment={() => {}} />
    </MemoryRouter>,
  );
}

test("an order with no shipment shows No shipment", () => {
  renderTable([order()]);
  expect(screen.getByText("No shipment")).toBeTruthy();
});

test("an awaiting order offers Add Shipment and fires the callback", () => {
  const onAddShipment = vi.fn();
  render(
    <MemoryRouter>
      <OrderTable orders={[order({ shipment: { id: "s1", awb_number: "",
        carrier_code: "IP", tracking_status: "AWAITING_TRACKING",
        push_state: "awaiting" } })]} onAddShipment={onAddShipment} />
    </MemoryRouter>,
  );
  expect(screen.getByText("Awaiting tracking number")).toBeTruthy();
  fireEvent.click(screen.getByText("Add Shipment", { selector: "button" }));
  expect(onAddShipment).toHaveBeenCalled();
  expect(onAddShipment.mock.calls[0][0].internal_order_number).toBe("MAN-1");
});

test("a pushed order links its tracking number to the history page", () => {
  renderTable([order({ shipment: { id: "s9", awb_number: "EG080960145IN",
    carrier_code: "IP", tracking_status: "IN_TRANSIT",
    push_state: "pushed", current_location: "Delhi" } })]);
  const link = screen.getByText("EG080960145IN").closest("a");
  expect(link?.getAttribute("href")).toBe("/shipments/s9");
  expect(screen.getByText("IN_TRANSIT")).toBeTruthy();
  expect(screen.getByText("Delhi")).toBeTruthy();
});

test("a refused push is labelled, not hidden", () => {
  renderTable([order({ shipment: { id: "s8", awb_number: "EG-REFUSED",
    carrier_code: "IP", tracking_status: "READY_TO_SHIP",
    push_state: "rejected" } })]);
  expect(screen.getByText("Not accepted by ShipSagar")).toBeTruthy();
  expect(screen.getByText("EG-REFUSED")).toBeTruthy();
});
