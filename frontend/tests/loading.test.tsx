// web/tests/loading.test.tsx
import React from "react";
import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import Loading from "../src/components/Loading";

test("root loading state announces busy status", () => {
  const { container } = render(<Loading />);
  expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
});
