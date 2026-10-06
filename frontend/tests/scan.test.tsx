// frontend/tests/scan.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import ScanBanner from "../src/components/ScanBanner";
test("banner shows error text", () => {
  render(<ScanBanner kind="error" text="Already dispatched at 10:42 AM by Raj" />);
  expect(screen.getByText(/Already dispatched/)).toBeDefined();
});
