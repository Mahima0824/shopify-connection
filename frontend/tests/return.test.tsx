// frontend/tests/return.test.tsx
import React from "react";
import { expect, test } from "vitest";
import { CONDITIONS, RETURN_TYPES } from "../lib/return-options";
test("return options match plan", () => {
  expect(RETURN_TYPES).toEqual(["CUSTOMER_RETURN", "RTO"]);
  expect(CONDITIONS).toContain("MISSING_ITEM");
});
