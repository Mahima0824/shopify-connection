import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { AppRoutes } from "../src/App";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

test("shell renders nav and outlet for unknown route", () => {
  renderAt("/nope");
  expect(screen.getAllByText(/ReconHub/i)[0]).toBeTruthy();
});

test("login renders without the top nav or the footer", () => {
  const { container } = renderAt("/login");
  expect(container.querySelector("header")).toBeNull();
  expect(container.querySelector("footer")).toBeNull();
  // The sign-in form itself must still be there.
  expect(screen.getByLabelText(/email/i)).toBeTruthy();
});

test("app routes keep the nav and footer", () => {
  const { container } = renderAt("/dashboard");
  expect(container.querySelector("header")).toBeTruthy();
  expect(container.querySelector("footer")).toBeTruthy();
});
