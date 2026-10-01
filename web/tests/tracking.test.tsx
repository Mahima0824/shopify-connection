import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { bandTone, cooldownMessage, cooldownSeconds } from "../src/lib/tracking";
test("delay band tones", () => {
  expect(bandTone("WAREHOUSE_DELAY")).toBe("warn");
  expect(bandTone("DELIVERED")).toBe("ok");
  expect(bandTone("NDR")).toBe("critical");
});
test("cooldown helpers read retry_after from api error text", () => {
  const err = new Error("Refresh cooldown: retry after 42s");
  expect(cooldownSeconds(err)).toBe(42);
  expect(cooldownMessage(err)).toBe("Refresh cooldown — retry after 42s.");
  expect(cooldownSeconds(new Error("boom"))).toBe(null);
  expect(screen).toBeDefined();
});
