import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import DateRangePicker from "../src/components/DateRangePicker";

test("shows the placeholder until a range is picked", () => {
  render(<DateRangePicker from="" to="" onChange={() => {}} />);
  expect(screen.getByText("Pick a date range")).toBeTruthy();
});

test("describes a single-day range without repeating the date", () => {
  render(<DateRangePicker from="2026-03-14" to="2026-03-14" onChange={() => {}} />);
  expect(screen.getByText("14 Mar 2026")).toBeTruthy();
});

test("describes a multi-day range across the month boundary", () => {
  render(<DateRangePicker from="2026-03-28" to="2026-04-02" onChange={() => {}} />);
  expect(screen.getByText("28 Mar - 2 Apr 2026")).toBeTruthy();
});

test("marks itself empty so the trigger can show muted placeholder text", () => {
  const { container } = render(
    <DateRangePicker from="" to="" onChange={() => {}} />
  );
  const trigger = container.querySelector("button[data-empty]");
  expect(trigger?.getAttribute("data-empty")).toBe("true");
});

test("clear resets both ends of the range", () => {
  const onChange = vi.fn();
  const { container } = render(
    <DateRangePicker from="2026-03-01" to="2026-03-10" onChange={onChange} />
  );

  // The trigger shows a value, so the popover's Clear button is the target.
  fireEvent.click(container.querySelector("button") as HTMLElement);
  const clear = screen.getByRole("button", { name: /clear/i });
  fireEvent.click(clear);

  expect(onChange).toHaveBeenCalledWith({ from: "", to: "" });
});