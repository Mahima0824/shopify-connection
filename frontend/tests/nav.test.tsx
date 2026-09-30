// frontend/tests/nav.test.tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import TopNav from "../components/TopNav";
import Reveal from "../components/Reveal";

test("topnav renders wordmark without R dot and sign in", () => {
  render(<TopNav />);
  expect(screen.getByText(/ReconHub/i)).toBeTruthy();
  expect(screen.queryByText("R")).toBeNull();
  expect(screen.getByText(/Sign in/i)).toBeTruthy();
  expect(screen.queryByText(/Try free/i)).toBeNull();
});

test("topnav centers app sections with active effect and no underline", () => {
  const { container } = render(<TopNav />);
  const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement;
  for (const label of ["Dashboard", "Orders", "Dispatch", "Returns", "Exceptions", "Tally"]) {
    expect(nav.textContent).toMatch(label);
  }
  const active = container.querySelector('[aria-current="page"]');
  expect(active?.textContent).toMatch(/Dashboard/);
  expect(active?.getAttribute("style") ?? "").toMatch(/9999/);
});

test("exactly one current-page marker exists", () => {
  const { container } = render(<TopNav />);
  expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
});

test("topnav uses enterprise canvas background", () => {
  const { container } = render(<TopNav />);
  const header = container.querySelector("header") as HTMLElement;
  expect(header.outerHTML + (header.getAttribute("style") ?? "")).toMatch(/var\(--canvas\)/i);
});

test("topnav groups routes with active trail", () => {
  const { container } = render(<TopNav />);
  const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement;
  for (const label of ["Dashboard", "Orders", "Scan", "Exceptions", "Finance", "Import"]) {
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
