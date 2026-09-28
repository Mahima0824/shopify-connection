import React from "react";
import { expect, test } from "vitest";
import { shouldSuppress } from "../lib/scan-debounce";

test("debounce suppresses repeats inside window", () => {
  const t0 = 1000;
  expect(shouldSuppress({ value: "P00000001", at: 0 }, "P00000001", t0)).toBe(true);
  expect(shouldSuppress({ value: "P00000001", at: 0 }, "P00000002", t0)).toBe(false);
  expect(shouldSuppress({ value: "P00000001", at: 0 }, "P00000001", t0 + 5000)).toBe(false);
  expect(shouldSuppress(null, "P00000001", t0)).toBe(false);
});
