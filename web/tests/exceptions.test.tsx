import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import SeverityBadge from "../src/components/SeverityBadge";
test("badge shows text severity", () => {
  render(<SeverityBadge severity="CRITICAL" />);
  expect(screen.getByText("CRITICAL")).toBeDefined();
});
