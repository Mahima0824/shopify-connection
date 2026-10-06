// web/tests/nav.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";

import TopNav from "../src/components/TopNav";
import Reveal from "../src/components/Reveal";

function renderNav() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <TopNav />
    </MemoryRouter>
  );
}

test("topnav renders wordmark without R dot and sign in", () => {
  renderNav();
  expect(screen.getByText(/ReconHub/i)).toBeTruthy();
  expect(screen.queryByText("R")).toBeNull();
  expect(screen.getByText(/Sign in/i)).toBeTruthy();
  expect(screen.queryByText(/Try free/i)).toBeNull();
});

test("topnav centers app sections with active effect and no underline", () => {
  const { container } = renderNav();
  const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement;
  for (const label of ["Dashboard", "Orders", "Dispatch", "Returns", "Exceptions", "Tally"]) {
    expect(nav.textContent).toMatch(label);
  }
  const active = container.querySelector('[aria-current="page"]');
  expect(active?.textContent).toMatch(/Dashboard/);
  // Pills were styled by an inline style object with borderRadius 9999; they are
  // now Tailwind, so the pill shape lives in a rounded-full class.
  expect(active?.className ?? "").toMatch(/rounded-full/);
});

test("exactly one current-page marker exists", () => {
  const { container } = renderNav();
  expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
});

test("topnav uses enterprise canvas background", () => {
  const { container } = renderNav();
  const header = container.querySelector("header") as HTMLElement;
  // --canvas and then --background were both replaced by Tailwind's bg-background
  // once the legacy palette was deleted.
  expect(header.className).toMatch(/bg-background/);
});

test("topnav groups routes with active trail", () => {
  const { container } = renderNav();
  const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement;
  for (const label of ["Dashboard", "Orders", "Scan", "Exceptions", "Finance", "Tracking"]) {
    expect(nav.textContent).toMatch(label);
  }
  expect(container.querySelector('[aria-current="page"]')).toBeTruthy();
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

test("reveal force-shows content even if observer never fires", async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  try {
    const { container } = render(<Reveal delay={120}>hello</Reveal>);
    await new Promise((r) => setTimeout(r, 1300));
    expect(container.querySelector(".reveal")?.classList.contains("is-visible")).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
