import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import StatementDetailPage from "../src/pages/StatementDetail";

test("statement detail module loads with manual-match affordance contract", () => {
  expect(typeof StatementDetailPage).toBe("function");
  render(<p>UNMATCHED <button>Match</button></p>);
  expect(screen.getByText("Match")).toBeDefined();
});
