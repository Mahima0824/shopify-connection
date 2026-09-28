import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import MetricCard from "../components/MetricCard";

test("MetricCard renders title and value correctly", () => {
  render(<MetricCard title="Gross Sales" value="₹10,000" />);
  expect(screen.getByText("Gross Sales")).toBeDefined();
  expect(screen.getByText("₹10,000")).toBeDefined();
});
