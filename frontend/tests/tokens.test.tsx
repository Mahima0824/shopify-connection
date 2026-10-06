import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "vitest";
const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../src/styles/globals.css"), "utf8");
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf8");

test("the legacy teal palette is fully retired", () => {
  // --canvas / --ink / --accent are gone; the sky palette from the shadcn preset
  // is the single source of truth. These three hexes must not come back.
  expect(css).not.toMatch(/#0f7665|#115e59/i);
});
test("sky primary and semantic status tokens exist", () => {
  // The preset's primary is sky (oklch 0.5 0.134 242.749); status tones are
  // declared here because shadcn ships no success/warning/neutral token.
  expect(css).toMatch(/--sc-primary:\s*oklch\(0\.5\s+0\.134\s+242\.749\)/i);
  expect(css).toMatch(/--success:/i);
  expect(css).toMatch(/--warning:/i);
  expect(css).toMatch(/--neutral:/i);
});
test("no Clay palette or dark footer remnants", () => {
  expect(css).not.toMatch(/#fffaf0|#ff4d8b|#1a3a3a|#101010/i);
});
test("tabular numerals utility exists", () => {
  // The .tnum helper became Tailwind's `tabular-nums` utility in the JSX.
  expect(read("../src/components/MetricCard.tsx")).toMatch(/tabular-nums/);
});
