import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import Timeline from "../src/components/Timeline";
import EmptyState from "../src/components/EmptyState";
test("timeline renders nodes", () => {
  render(<Timeline items={[{ at: null, kind: "DISPATCHED", label: "Dispatched", detail: null }]} />);
  expect(screen.getByText(/Dispatched/)).toBeDefined();
});
test("timeline light cards have no dark rgba background", () => {
  const { container } = render(
    <Timeline items={[{ at: null, kind: "DISPATCHED", label: "Dispatched", detail: null }]} />
  );
  expect(container.innerHTML).not.toMatch(/15, 23, 42/);
});
test("timeline uses cream fragment cards", () => {
  const { container } = render(<Timeline items={[{at:"now",kind:"DISPATCHED",label:"Dispatched",detail:"ok"}]} />);
  expect(container.innerHTML).toMatch(/f5f0e0|ffaf|content-card|#fffaf0/i);
});
test("empty state renders actions", () => {
  const { container } = render(
    <MemoryRouter>
      <EmptyState
        title="Nothing here"
        body="Sync to populate."
        primary={{ label: "Sync now", href: "/orders" }}
      />
    </MemoryRouter>
  );
  expect(container.textContent).toMatch(/Nothing here/);
  expect(container.querySelector('a[href="/orders"]')?.textContent).toMatch(/Sync now/);
});
