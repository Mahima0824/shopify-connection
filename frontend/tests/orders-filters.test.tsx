import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import OrdersPage from "../src/pages/Orders";

const urls: string[] = [];

/* Radix opens a Select on pointerdown. jsdom implements neither pointer capture
   nor scrollIntoView, so both are stubbed before the first render. */
function stubPointerApi() {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

async function openSelect(trigger: HTMLElement) {
  const user = userEvent.setup();
  await user.click(trigger);
  await screen.findByRole("listbox");
  return user;
}

beforeEach(() => {
  urls.length = 0;
  stubPointerApi();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => {
      urls.push(String(u));
      return { ok: true, json: async () => ({ items: [] }) } as unknown as Response;
    })
  );
});

const lastQuery = () => {
  const u = urls[urls.length - 1] ?? "";
  return u.slice(u.indexOf("?") + 1);
};

test("selecting a real filter value sends it in the query", async () => {
  render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>
  );
  const trigger = await screen.findByRole("combobox", { name: "COD mode" });
  urls.length = 0;

  await openSelect(trigger);
  await userEvent.click(screen.getByRole("option", { name: "PREPAID" }));

  await waitFor(() => {
    expect(lastQuery()).toMatch(/cod_mode=PREPAID/);
  });
});

test("choosing the ALL option clears the filter instead of sending ALL", async () => {
  render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>
  );
  const trigger = await screen.findByRole("combobox", { name: "COD mode" });

  // Select PREPAID first so there is a value to clear.
  await openSelect(trigger);
  await userEvent.click(screen.getByRole("option", { name: "PREPAID" }));
  await waitFor(() => expect(lastQuery()).toMatch(/cod_mode=PREPAID/));

  // Now pick ALL. Radix cannot hold "" as a value, so the trigger sends the
  // "ALL" sentinel; it must be mapped back to "" or the API filters on a
  // literal "ALL" and returns nothing.
  urls.length = 0;
  await openSelect(trigger);
  await userEvent.click(screen.getByRole("option", { name: "ALL" }));

  await waitFor(() => {
    const q = lastQuery();
    expect(q).not.toMatch(/cod_mode=ALL/);
    expect(q).not.toMatch(/cod_mode=/);
  });
});

test("the select dropdown opens below its trigger, not above", async () => {
  render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>
  );
  const trigger = await screen.findByRole("combobox", { name: "COD mode" });
  await openSelect(trigger);

  // item-aligned placement lets Radix pick whichever side has room, which
  // flipped the panel over the trigger. popper + side=bottom pins it below.
  const listbox = screen.getByRole("listbox");
  expect(listbox.getAttribute("data-side")).toBe("bottom");
  // React serialises the boolean to the string "false"; "true" would mean the
  // content reverted to item-aligned positioning.
  expect(listbox.getAttribute("data-align-trigger")).not.toBe("true");
});

test("the four filter selects render as Radix triggers, not native selects", async () => {
  const { container } = render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>
  );
  await screen.findByPlaceholderText(/Search orders/i);

  // No bare <select> left in the filter bar.
  expect(container.querySelectorAll("select").length).toBe(0);
  // Each has a combobox role with its accessible name.
  for (const name of ["COD mode", "Status", "Delivery Partner", "Date range"]) {
    expect(screen.getByRole("combobox", { name })).toBeTruthy();
  }
});