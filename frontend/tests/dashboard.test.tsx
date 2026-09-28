import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import MetricCard from "../components/MetricCard";

vi.mock("../lib/api", () => ({ api: vi.fn().mockResolvedValue(null) }));

import DashboardPage from "../app/dashboard/page";

test("MetricCard renders title and value correctly", () => {
  render(<MetricCard title="Gross Sales" value="₹10,000" />);
  expect(screen.getByText("Gross Sales")).toBeDefined();
  expect(screen.getByText("₹10,000")).toBeDefined();
});

test("dashboard uses Clay peach signature band without dark surfaces", async () => {
  const { container } = render(<DashboardPage />);
  await waitFor(() => screen.getByText(/Dashboard Unavailable/i));
  expect(container.querySelector(".feature-card-peach")).toBeTruthy();
  expect(container.innerHTML).not.toMatch(/#101010|#0f172a/);
});
