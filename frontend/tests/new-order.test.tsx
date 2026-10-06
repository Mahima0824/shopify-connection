import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { validateNewOrder, buildOrderQuery } from "../src/lib/india-post";
import NewOrderDialog from "../src/components/NewOrderDialog";
test("pin validation", ()=>{
  expect(validateNewOrder({receiver_pincode:"123"}).receiver_pincode).toBeDefined();
  expect(buildOrderQuery({cod_mode:"COD",pincode:"500018"})).toContain("cod_mode=COD");
});
test("dialog renders as fixed overlay", ()=>{
  render(<NewOrderDialog open onClose={()=>{}} onSaved={()=>{}} />);
  const dialog = screen.getByRole("dialog");
  expect(dialog.style.position).toBe("fixed");
});
