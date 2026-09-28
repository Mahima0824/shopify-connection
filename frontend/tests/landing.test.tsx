import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "../app/page";
test("landing renders hero h1", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
});
test("landing cycles saturated cards without dark footer", () => {
  const { container } = render(<Home />);
  expect(container.querySelector(".feature-card-pink")).toBeTruthy();
  expect(container.querySelector(".feature-card-teal")).toBeTruthy();
  expect(container.innerHTML).not.toMatch(/#101010/);
});
