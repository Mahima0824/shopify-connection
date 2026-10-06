import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import Landing from "../src/pages/Landing";
test("landing renders enterprise hero", () => {
  render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>
  );
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
});
test("landing has no Clay fills and anchors resolve", () => {
  const { container } = render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>
  );
  expect(container.innerHTML).not.toMatch(/feature-card-(pink|teal|lavender|peach|ochre)|#fffaf0|#ff4d8b/i);
  for (const id of ["product", "solutions", "resources", "pricing", "customers"]) {
    expect(container.querySelector(`#${id}`)).toBeTruthy();
  }
});
