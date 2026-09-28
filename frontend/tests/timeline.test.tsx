import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Timeline from "../components/Timeline";
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
