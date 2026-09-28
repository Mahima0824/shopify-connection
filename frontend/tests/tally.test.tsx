import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("Tally test placeholder", () => {
  render(<div data-testid="tally-test">Tally Module</div>);
  expect(screen.getByTestId("tally-test")).toBeDefined();
});
