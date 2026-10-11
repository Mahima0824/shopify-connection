import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { globSync } from "fs";
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CarrierIcon, CARRIER_OPTIONS } from "../src/components/CarrierIcon";
import SelectField from "../src/components/SelectField";
import { Button, buttonVariants } from "../src/components/primitives";

const here = path.dirname(fileURLToPath(import.meta.url));

test("no emoji characters exist in user-facing JSX or option labels across src", () => {
  const files = globSync(path.join(here, "../src/**/*.tsx"));
  const offenders: string[] = [];

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const lines = src.split("\n");

    lines.forEach((line, i) => {
      // Ignore comment lines
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      // Ignore WhatsApp message template body (which is sent via external Meta Cloud API)
      if (line.includes("Thank you for shopping with us!") || line.includes("send tracking details upon dispatch")) return;

      // Match common emoji ranges and pictographs
      if (/[\uD83C-\uDBFF\uDC00-\uDFFF\u26A0\u26A1\u2708\u2705\u2714\u2728]/.test(line)) {
        offenders.push(`${path.relative(here, file)}:${i + 1} -> ${line.trim()}`);
      }
    });
  }

  expect(offenders).toEqual([]);
});

test("CarrierIcon renders dedicated SVG icons for all supported carriers", () => {
  const { container } = render(
    <div>
      <CarrierIcon code="INDIA_POST" data-testid="ip" />
      <CarrierIcon code="DELHIVERY" data-testid="delhivery" />
      <CarrierIcon code="BLUEDART" data-testid="bluedart" />
      <CarrierIcon code="DTDC" data-testid="dtdc" />
    </div>
  );

  const svgs = container.querySelectorAll("svg");
  expect(svgs.length).toBe(4);
});

test("CARRIER_OPTIONS supplies clean labels with CarrierIcon nodes", () => {
  expect(CARRIER_OPTIONS.length).toBe(4);
  CARRIER_OPTIONS.forEach((opt) => {
    // Labels must not contain emoji
    expect(opt.label).not.toMatch(/[\uD800-\uDFFF]/);
    expect(opt.icon).toBeDefined();
  });
});

test("SelectField renders option icons ahead of option labels", () => {
  render(
    <SelectField
      ariaLabel="Carrier Choice"
      value="INDIA_POST"
      includeAll={false}
      onChange={() => {}}
      options={CARRIER_OPTIONS}
    />
  );

  const trigger = screen.getByRole("combobox", { name: "Carrier Choice" });
  expect(trigger).toBeTruthy();
  // An SVG is rendered inside the trigger alongside the label
  const svg = trigger.querySelector("svg");
  expect(svg).toBeTruthy();
  expect(trigger.textContent).toContain("India Post");
});

test("Button component provides consistent height tokens matching control scale", () => {
  expect(buttonVariants({ size: "default" })).toMatch(/\bh-9\b/);
  expect(buttonVariants({ size: "sm" })).toMatch(/\bh-8\b/);
  expect(buttonVariants({ size: "lg" })).toMatch(/\bh-10\b/);
  expect(buttonVariants({ size: "xs" })).toMatch(/\bh-7\b/);
});
