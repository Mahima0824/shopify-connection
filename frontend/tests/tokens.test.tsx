import fs from "fs";
import path from "path";
import { expect, test } from "vitest";
const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
test("enterprise canvas + ink + accent tokens exist", () => {
  expect(css).toMatch(/--canvas\s*:\s*#ffffff/i);
  expect(css).toMatch(/--ink\s*:\s*#0f172a/i);
  expect(css).toMatch(/--accent\s*:\s*#0f7665/i);
});
test("no Clay palette or dark footer remnants", () => {
  expect(css).not.toMatch(/#fffaf0|#ff4d8b|#1a3a3a|#101010/i);
});
test("tabular numerals utility exists", () => {
  expect(css).toMatch(/\.tnum/);
});
