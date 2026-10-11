// web/tests/responsive.test.tsx
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../src/styles/globals.css"), "utf8");
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf8");

test("collapsible grid utilities exist with small-screen rules", () => {
  expect(read("../src/pages/Orders.tsx")).toMatch(/grid-cols-2/);
  expect(css).not.toMatch(/\.cols-2|\.cols-3/);
});

test("login uses dynamic viewport height for mobile chrome", () => {
  expect(read("../src/pages/Login.tsx")).toMatch(/min-h-dvh/);
});

test("root layout declares device-width viewport", () => {
  const layout = read("../index.html");
  expect(layout).toMatch(/viewport/);
  expect(layout).toMatch(/device-width/);
});

test("create order search input has icon placed inside with absolute positioning and padding", () => {
  const createOrder = read("../src/pages/CreateOrder.tsx");
  expect(createOrder).toMatch(/<IconSearch[^>]*absolute left-3/);
  expect(createOrder).toMatch(/pl-9/);
});

test("create order saree cards and payment selector adapt to mobile screens", () => {
  const createOrder = read("../src/pages/CreateOrder.tsx");
  expect(createOrder).toMatch(/flex-col sm:flex-row/);
  expect(createOrder).toMatch(/grid-cols-1 sm:grid-cols-2/);
});

test("tracking and monthly report KPI grids use responsive breakpoints", () => {
  const tracking = read("../src/pages/Tracking.tsx");
  expect(tracking).toMatch(/grid-cols-1 sm:grid-cols-2 lg:grid-cols-4/);

  const monthly = read("../src/pages/MonthlyReport.tsx");
  expect(monthly).toMatch(/grid-cols-1 sm:grid-cols-2 gap-3/);
});

test("modals and dialogs employ flex-wrap in headers and footers for mobile viewports", () => {
  const orderDetail = read("../src/components/OrderDetailDialog.tsx");
  expect(orderDetail).toMatch(/flex-wrap items-center justify-between/);

  const whatsApp = read("../src/components/WhatsAppDialog.tsx");
  expect(whatsApp).toMatch(/flex-col sm:flex-row/);
});
