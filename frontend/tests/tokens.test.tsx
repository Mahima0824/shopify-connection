import fs from "fs";
import path from "path";
import { expect, test } from "vitest";

const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");

test("Clay canvas + primary tokens exist", () => {
  expect(css).toMatch(/--canvas\s*:\s*#fffaf0/i);
  expect(css).toMatch(/--primary\s*:\s*#0a0a0a/);
  expect(css).toMatch(/--brand-pink\s*:\s*#ff4d8b/i);
  expect(css).toMatch(/--brand-teal\s*:\s*#1a3a3a/);
});

test("no dark footer token usage remains", () => {
  expect(css).not.toMatch(/#101010/);
});
