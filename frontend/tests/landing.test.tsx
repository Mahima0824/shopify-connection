import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "../app/page";
test("landing renders enterprise hero", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
});
test("landing has no Clay fills and anchors resolve", () => {
  const { container } = render(<Home />);
  expect(container.innerHTML).not.toMatch(/feature-card-(pink|teal|lavender|peach|ochre)|#fffaf0|#ff4d8b/i);
  for (const id of ["product", "solutions", "resources", "pricing", "customers"]) {
    expect(container.querySelector(`#${id}`)).toBeTruthy();
  }
});
