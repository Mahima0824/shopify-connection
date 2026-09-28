import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Timeline from "../components/Timeline";
test("timeline renders nodes", () => {
  render(<Timeline items={[{ at: null, kind: "DISPATCHED", label: "Dispatched", detail: null }]} />);
  expect(screen.getByText(/Dispatched/)).toBeDefined();
});
