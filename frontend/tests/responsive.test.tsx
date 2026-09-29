// frontend/tests/responsive.test.tsx
import fs from "fs";
import path from "path";
import { expect, test } from "vitest";

const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), "utf8");

test("collapsible grid utilities exist with small-screen rules", () => {
  expect(css).toMatch(/\.cols-2/);
  expect(css).toMatch(/\.cols-3/);
  expect(css).toMatch(/max-width:\s*480px/);
});

test("login uses dynamic viewport height for mobile chrome", () => {
  expect(css).toMatch(/100dvh/);
  expect(read("../app/login/page.tsx")).toMatch(/fullscreen-center/);
});

test("root layout declares device-width viewport", () => {
  const layout = read("../app/layout.tsx");
  expect(layout).toMatch(/viewport/);
  expect(layout).toMatch(/device-width/);
});

test("scan hub uses collapsible grid instead of fixed 3 columns", () => {
  const scan = read("../app/scan/page.tsx");
  expect(scan).toMatch(/cols-3/);
  expect(scan).not.toMatch(/1fr 1fr 1fr/);
});
