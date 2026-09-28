import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import ImportResult from "../components/ImportResult";
test("result shows counts", () => {
  render(<ImportResult summary={{ parsed: 4, created: 4, updated: 0, skipped: 0, errors: [] }} />);
  expect(screen.getByText(/4 created/)).toBeDefined();
});
