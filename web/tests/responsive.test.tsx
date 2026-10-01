// web/tests/responsive.test.tsx
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../src/styles/globals.css"), "utf8");
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf8");

test("collapsible grid utilities exist with small-screen rules", () => {
  expect(css).toMatch(/\.cols-2/);
  expect(css).toMatch(/\.cols-3/);
  expect(css).toMatch(/max-width:\s*480px/);
});

test("login uses dynamic viewport height for mobile chrome", () => {
  expect(css).toMatch(/100dvh/);
  expect(read("../src/pages/Login.tsx")).toMatch(/fullscreen-center/);
});

test("root layout declares device-width viewport", () => {
  const layout = read("../index.html");
  expect(layout).toMatch(/viewport/);
  expect(layout).toMatch(/device-width/);
});

test("scan hub uses collapsible grid instead of fixed 3 columns", () => {
  const scan = read("../src/pages/ScanHub.tsx");
  expect(scan).toMatch(/cols-3/);
  expect(scan).not.toMatch(/1fr 1fr 1fr/);
});
