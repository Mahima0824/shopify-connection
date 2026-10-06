import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import OrderTable from "../src/components/OrderTable";
import OrdersPage from "../src/pages/Orders";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ items: [] }),
  }) as unknown as Response));
});

test("renders order", () => {
  render(
    <MemoryRouter>
      <OrderTable orders={[{ id: "1", shopify_order_name: "#10452", total_amount: "1499.00" }]} />
    </MemoryRouter>
  );
  expect(screen.getByText("#10452")).toBeDefined();
});
test("has new order + filters", async ()=>{
  render(<MemoryRouter><OrdersPage/></MemoryRouter>);
  expect(await screen.findByText(/New Order/i)).toBeDefined();
  expect(await screen.findByPlaceholderText(/Search orders/i)).toBeDefined();
});
