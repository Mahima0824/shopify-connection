import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import MetricCard from "../src/components/MetricCard";

vi.mock("../src/lib/api", () => ({ api: vi.fn().mockResolvedValue(null) }));

import DashboardPage from "../src/pages/Dashboard";

test("MetricCard renders title and value correctly", () => {
  render(<MetricCard title="Gross Sales" value="₹10,000" />);
  expect(screen.getByText("Gross Sales")).toBeDefined();
  expect(screen.getByText("₹10,000")).toBeDefined();
});

test("dashboard renders header title and KPI section", async () => {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
  await waitFor(() => screen.getByRole("heading", { name: "Dashboard" }));
  expect(screen.getAllByText("Gross sales").length).toBeGreaterThan(0);
});
