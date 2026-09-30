// frontend/tests/loading.test.tsx
import React from "react";
import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import Loading from "../app/loading";

test("root loading state announces busy status", () => {
  const { container } = render(<Loading />);
  expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
});
