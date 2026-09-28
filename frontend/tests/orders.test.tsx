import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import OrderTable from "../components/OrderTable";
test("renders order", () => {
  render(<OrderTable orders={[{ id: "1", shopify_order_name: "#10452", total_amount: "1499.00" }]} />);
  expect(screen.getByText("#10452")).toBeDefined();
});
