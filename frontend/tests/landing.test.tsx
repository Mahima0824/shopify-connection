// frontend/tests/landing.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "../app/page";

test("landing renders hero and pricing", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  expect(screen.getByText(/Teams/i)).toBeTruthy();
});
