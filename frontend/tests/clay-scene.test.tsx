import React from "react";
import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import ClayScene from "../components/ClayScene";
import { IconBox } from "../components/icons";
test("mountains scene renders svg", () => {
  const { container } = render(<ClayScene variant="mountains" />);
  expect(container.querySelector("svg")).toBeTruthy();
});
test("horizon scene renders svg", () => {
  const { container } = render(<ClayScene variant="horizon" />);
  expect(container.querySelector("svg")).toBeTruthy();
});
test("icons render svg paths", () => {
  const { container } = render(<IconBox />);
  expect(container.querySelector("svg path")).toBeTruthy();
});
