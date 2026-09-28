// frontend/tests/nav.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import TopNav from "../components/TopNav";
import NavPillGroup from "../components/NavPillGroup";
import Reveal from "../components/Reveal";

test("topnav renders wordmark and signup", () => {
  render(<TopNav />);
  expect(screen.getByText(/ReconHub/i)).toBeTruthy();
  expect(screen.getByText(/Sign up free/i)).toBeTruthy();
});

test("pill group marks active segment", () => {
  const { container } = render(
    <NavPillGroup
      items={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Orders", href: "/orders" },
      ]}
      active="/orders"
    />
  );
  expect(container.querySelector(".pill-active")?.textContent).toMatch(/Orders/);
});

test("reveal renders children and never hides content without an observer", () => {
  const { container } = render(<Reveal>hello</Reveal>);
  expect(container.textContent).toMatch(/hello/);
  const el = container.querySelector(".reveal");
  expect(el).toBeTruthy();
  // No-JS / no-observer safe: content must not stay invisible when
  // IntersectionObserver is unavailable (Task 1 deferred note).
  if (typeof IntersectionObserver === "undefined") {
    expect(el?.classList.contains("is-visible")).toBe(true);
  }
});
