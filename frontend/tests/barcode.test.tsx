import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { isValidBarcode } from "../lib/barcode";
import ParcelBarcode from "../components/barcode/ParcelBarcode";

test("accepts both formats", () => {
  expect(isValidBarcode("P00000001")).toBe(true);
  expect(isValidBarcode("PKG-0000000001")).toBe(true);
  expect(isValidBarcode("P123")).toBe(false);
});

test("invalid value shows error, not canvas", () => {
  render(<ParcelBarcode value="NOPE" />);
  expect(screen.getByRole("alert")).toBeDefined();
});
