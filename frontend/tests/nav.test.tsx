// web/tests/nav.test.tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

test("topnav renders wordmark and sign in", () => {
  renderNav();
  expect(screen.getByText(/ReconHub/i)).toBeTruthy();
  expect(screen.getByText(/Sign in/i)).toBeTruthy();
  expect(screen.queryByText(/Try free/i)).toBeNull();
});

test("topnav centers app sections with active effect and no underline", () => {
  const { container } = renderNav();
  const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement;
  for (const label of ["Dashboard", "Orders", "Finance"]) {
    expect(nav.textContent).toMatch(label);
  }
  const active = container.querySelector('[aria-current="page"]');
  expect(active?.textContent).toMatch(/Dashboard/);
  expect(active?.className ?? "").toMatch(/rounded-full/);
});

test("exactly one current-page marker exists", () => {
  const { container } = renderNav();
  expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
});

test("topnav uses enterprise canvas background", () => {
  const { container } = renderNav();
  const header = container.querySelector("header") as HTMLElement;
  expect(header.className).toMatch(/bg-background/);
});

test("topnav groups routes with active trail", () => {
  const { container } = renderNav();
  const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement;
  for (const label of ["Dashboard", "Orders", "Finance", "Tracking"]) {
    expect(nav.textContent).toMatch(label);
  }
  expect(container.querySelector('[aria-current="page"]')).toBeTruthy();
});

test("clicking outside topnav closes open dropdown menu", () => {
  const { container } = renderNav();
  const btn = screen.getByLabelText("Finance submenu");
  fireEvent.click(btn);
  expect(screen.getByText("Statements")).toBeTruthy();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByText("Statements")).toBeNull();
});

test("hovering a submenu opens it and leaving closes it", async () => {
  const { container } = renderNav();
  // The hover handlers sit on the wrapper that holds both the trigger and the
  // panel, which is the parent of the aria-haspopup trigger.
  const group = screen
    .getByLabelText("Finance submenu")
    .parentElement as HTMLElement;
  expect(group).toBeTruthy();

  fireEvent.mouseEnter(group);
  await new Promise((r) => setTimeout(r, 200));
  expect(screen.getByText("Statements")).toBeTruthy();

  fireEvent.mouseLeave(group);
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByText("Statements")).toBeNull();
});

test("an open submenu parent matches the hover treatment of plain items", () => {
  const { container } = renderNav();
  const parent = screen.getByLabelText("Finance submenu");
  // No underline anywhere in the nav: an underline competed with the active
  // item's bottom rule and read as a second, conflicting indicator.
  expect(parent.className).not.toMatch(/underline/);

  fireEvent.click(parent);
  expect(parent.className).not.toMatch(/underline/);
  expect(parent.className).not.toMatch(/hover:bg-/);
});

test("idle nav items signal hover by colour, with no underline", () => {
  const { container } = renderNav();
  const idle = [...container.querySelectorAll('nav[aria-label="Primary"] a')].find(
    (a) => a.getAttribute("aria-current") !== "page"
  ) as HTMLElement;
  expect(idle.className).toMatch(/hover:text-foreground/);
  expect(idle.className).not.toMatch(/underline/);
  expect(idle.className).not.toMatch(/hover:bg-/);
});

test("active nav item uses the primary colour plus an after-rule, never black", () => {
  const { container } = renderNav();
  const active = container.querySelector('[aria-current="page"]') as HTMLElement;
  expect(active.className).toMatch(/text-primary/);
  expect(active.className).toMatch(/after:bg-primary/);
  // No heavy black capsule and no tint fill: the active route is marked by
  // colour plus the bottom rule only, with nothing painted behind the label.
  expect(active.className).not.toMatch(/\bbg-foreground\b/);
  expect(active.className).not.toMatch(/\btext-background\b/);
  expect(active.className).not.toMatch(/(^|\s)bg-/);
  expect(active.className).not.toMatch(/underline/);
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
