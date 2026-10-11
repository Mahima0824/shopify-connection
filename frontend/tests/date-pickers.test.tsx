import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach } from "vitest";
import { DatePicker } from "../src/components/DateRangePicker";
import { MonthPicker } from "../src/components/MonthPicker";

beforeEach(() => {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

test("DatePicker shows the placeholder until a date is chosen", () => {
  render(<DatePicker value="" onChange={() => {}} ariaLabel="From date" />);
  const t = screen.getByRole("button", { name: "From date" });
  expect(t).toBeTruthy();
  expect(t.textContent).toMatch(/Pick a date/);
  expect(t.getAttribute("data-empty")).toBe("true");
});

test("DatePicker formats a committed value and clears the empty flag", () => {
  render(
    <DatePicker value="2026-10-24" onChange={() => {}} ariaLabel="From date" />
  );
  const t = screen.getByRole("button", { name: "From date" });
  expect(t.textContent).toMatch(/24 Oct 2026/);
  expect(t.getAttribute("data-empty")).toBe("false");
});

test("choosing a day in the DatePicker emits yyyy-MM-dd", async () => {
  const onChange = vi.fn();
  render(<DatePicker value="" onChange={onChange} ariaLabel="From date" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "From date" }));
  const grid = await screen.findByRole("grid");
  // Pick the 15th; the grid always contains it exactly once.
  const day = Array.from(grid.querySelectorAll('[role="gridcell"] button')).find(
    (b) => b.textContent?.trim() === "15"
  ) as HTMLElement;
  expect(day).toBeTruthy();
  await user.click(day);
  expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-15$/));
});

test("MonthPicker renders the committed month and exposes a grid of months", async () => {
  render(<MonthPicker value="2026-10" onChange={() => {}} ariaLabel="Close month" />);
  const trigger = screen.getByRole("button", { name: "Close month" });
  expect(trigger.textContent).toMatch(/October 2026/);

  const user = userEvent.setup();
  await user.click(trigger);
  const list = await screen.findByRole("listbox");
  const opts = Array.from(list.querySelectorAll('[role="option"]'));
  expect(opts).toHaveLength(12);
  expect(opts[0].textContent).toMatch(/Jan/);
});

test("picking a month emits yyyy-MM", async () => {
  const onChange = vi.fn();
  render(<MonthPicker value="2026-10" onChange={onChange} ariaLabel="Close month" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Close month" }));
  const list = await screen.findByRole("listbox");
  const feb = Array.from(list.querySelectorAll('[role="option"]')).find(
    (o) => o.textContent?.trim() === "Feb"
  ) as HTMLElement;
  await user.click(feb);
  expect(onChange).toHaveBeenCalledWith("2026-02");
});

test("MonthPicker navigates years without losing the selection", async () => {
  render(<MonthPicker value="2026-10" onChange={() => {}} ariaLabel="Close month" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Close month" }));
  await screen.findByRole("listbox");
  await user.click(screen.getByRole("button", { name: "Next year" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next year" })).toBeTruthy()
  );
  expect(screen.getByText("2027")).toBeTruthy();
  // The committed value is still October 2026.
  expect(screen.getByRole("option", { name: /Oct/ }).getAttribute("aria-selected")).toBe("false");
});