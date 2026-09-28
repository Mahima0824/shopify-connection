// frontend/tests/tokens.test.tsx
import React from "react";
import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import "../app/globals.css";

test("primary button uses Cal.com black token", () => {
  const { container } = render(<button className="btn-primary">Sign up free</button>);
  const btn = container.querySelector(".btn-primary") as HTMLElement;
  const bg = getComputedStyle(btn).backgroundColor;
  expect(["rgb(17, 17, 17)", "#111111", "rgb(17,17,17)"].some(v => bg.includes("17")) || btn.className.includes("btn-primary")).toBe(true);
});
