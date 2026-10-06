import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "vitest";
const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../src/styles/globals.css"), "utf8");
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf8");

test("the legacy teal palette is fully retired", () => {
  // --canvas / --ink / --accent are gone. These three hexes must not come back.
  expect(css).not.toMatch(/#0f7665|#115e59/i);
});

test("primary stays sky, not the DESIGN.md black", () => {
  // DESIGN.md mandates a #000000 pill button and bans blue outright, but the sky
  // accent was an explicit product decision, so primary is deliberately sky and
  // the doc's black-pill rule is not applied. Guard both halves of that.
  expect(css).toMatch(/--dm-primary:\s*oklch\(0\.5\s+0\.134\s+242\.749\)/i);
  expect(css).not.toMatch(/--dm-primary:\s*oklch\(0\s+0\s+0\)/i);
});

test("DESIGN.md palette tokens are declared", () => {
  expect(css).toMatch(/--dm-background:\s*oklch\(0\.9864\s+0\.0079\s+106\.54\)/i); // canvas-cream
  expect(css).toMatch(/--dm-foreground:\s*oklch\(0\s+0\s+0\)/i);                 // ink
  expect(css).toMatch(/--dm-border:\s*oklch\(0\.9197\s+0\.004\s+286\.32\)/i);   // hairline-light
  expect(css).toMatch(/--dm-accent:\s*oklch\(0\.9382\s+0\.0789\s+155\.19\)/i);  // aloe-10
});

test("DESIGN.md radius ladder replaces the preset's scaled one", () => {
  // 4 / 5 / 8 / 12 / 20 / 9999 from the doc's Shapes table.
  expect(css).toMatch(/--radius-xs:\s*4px/i);
  expect(css).toMatch(/--radius-sm:\s*5px/i);
  expect(css).toMatch(/--radius-md:\s*8px/i);
  expect(css).toMatch(/--radius-lg:\s*12px/i);
  expect(css).toMatch(/--radius-xl:\s*20px/i);
  expect(css).toMatch(/--radius-pill:\s*9999px/i);
  expect(css).not.toMatch(/--radius-lg:\s*var\(--sc-radius\)/i);
});

test("status tokens exist for tones shadcn does not ship", () => {
  expect(css).toMatch(/--dm-success:/i);
  expect(css).toMatch(/--dm-warning:/i);
  expect(css).toMatch(/--dm-neutral:/i);
});

test("canonical token names alias the palette so inline styles follow it", () => {
  // Inline styles still read var(--primary) etc, so those names must point at
  // the DESIGN.md values rather than declaring a second, drifting palette.
  expect(css).toMatch(/--primary:\s*var\(--dm-primary\)/i);
  expect(css).toMatch(/--border:\s*var\(--dm-border\)/i);
  expect(css).toMatch(/--muted-foreground:\s*var\(--dm-muted-foreground\)/i);
});

test("no Clay palette or dark footer remnants", () => {
  expect(css).not.toMatch(/#fffaf0|#ff4d8b|#1a3a3a|#101010/i);
});

test("tabular numerals utility exists", () => {
  // The .tnum helper became Tailwind's `tabular-nums` utility in the JSX.
  expect(read("../src/components/MetricCard.tsx")).toMatch(/tabular-nums/);
});