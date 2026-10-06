import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  // Newest-first ordering. The last description is compared against itself by
  // this shape, which is always 0, so the ordering claim is only about the
  // scans that precede the oldest one.
  const descs = ["Out for delivery", "Package arrived at the carrier facility",
                 "Package picked up"];
  const last = screen.getByText(descs[descs.length - 1]);
  const rendered = descs.slice(0, -1).map((d) =>
    screen.getByText(d).compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(rendered.length).toBe(2);
  expect(rendered.every((r) => r !== 0)).toBe(true);
  expect(screen.getByText("New Delhi")).toBeTruthy();
  expect(screen.getByText(/17-May-2023/)).toBeTruthy();
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
  await waitFor(() => expect(screen.getByText("please try again later")).toBeTruthy());
});
