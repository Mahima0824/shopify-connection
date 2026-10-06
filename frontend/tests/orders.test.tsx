import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import OrderTable from "../src/components/OrderTable";
test("renders order", () => {
  render(
    <MemoryRouter>
      <OrderTable orders={[{ id: "1", shopify_order_name: "#10452", total_amount: "1499.00" }]} />
    </MemoryRouter>
  );
  expect(screen.getByText("#10452")).toBeDefined();
});
