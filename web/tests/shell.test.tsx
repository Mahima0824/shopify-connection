import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../src/App";

test("shell renders nav and outlet for unknown route", () => {
  render(
    <MemoryRouter initialEntries={["/nope"]}>
      <AppRoutes />
    </MemoryRouter>
  );
  expect(screen.getByText(/ReconHub/i)).toBeTruthy();
});
