import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { Input } from "../src/components/primitives";
import SelectField from "../src/components/SelectField";

beforeEach(() => {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

test("the filter Select trigger and the Input beside it share a height token", () => {
  render(
    <MemoryRouter>
      <div className="flex items-center gap-3">
        <Input aria-label="Search" className="flex-[2]" />
        <SelectField
          ariaLabel="Carrier Filter"
          value=""
          allLabel="All Carriers"
          onChange={() => {}}
          tall
          options={[{ value: "X", label: "X" }]}
        />
      </div>
    </MemoryRouter>
  );

  const input = screen.getByLabelText("Search");
  const trigger = screen.getByRole("combobox", { name: "Carrier Filter" });

  // Both must resolve to the same explicit height. The previous min-h-11 on the
  // select made it 44px against the Input's 36px, which read as a misalignment.
  expect(input.className).toMatch(/\bh-9\b/);
  expect(trigger.className).toMatch(/\bh-9\b/);
  expect(trigger.className).not.toMatch(/min-h-11/);
});

test("the compact Select trigger also matches the Input height", () => {
  render(
    <MemoryRouter>
      <div className="flex items-center gap-3">
        <Input aria-label="Search" />
        <SelectField
          ariaLabel="Status Filter"
          value=""
          allLabel="All Statuses"
          onChange={() => {}}
          options={[{ value: "X", label: "X" }]}
        />
      </div>
    </MemoryRouter>
  );
  const trigger = screen.getByRole("combobox", { name: "Status Filter" });
  expect(trigger.className).toMatch(/\bh-9\b/);
});