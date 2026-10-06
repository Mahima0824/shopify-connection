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

test("dashboard empty state offers sign-in and sync actions", async () => {
  const { container } = render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
  await waitFor(() => screen.getByText(/Dashboard unavailable/i));
  expect(container.querySelector('a[href="/login"]')?.textContent).toMatch(/Sign in/i);
  expect(container.querySelector('a[href="/orders"]')?.textContent).toMatch(/Sync/i);
});
