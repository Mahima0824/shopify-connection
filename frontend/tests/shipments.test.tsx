import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { slaTone } from "../src/lib/sla";

test("sla bands map to tones", () => {
  expect(slaTone("BREACHED")).toBe("critical");
  expect(slaTone("APPROACHING")).toBe("warn");
  expect(slaTone("NORMAL")).toBe("ok");
  expect(screen).toBeDefined();
});
