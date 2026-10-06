import React, { useState } from "react";
export default function ManualBarcodeInput({ onSubmit, label }: { onSubmit: (v: string) => void; label?: string }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSubmit(v.trim()); setV(""); } }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Enter barcode manually" aria-label={label ?? "Barcode manual entry"} />
      <button type="submit">Submit</button>
    </form>
  );
}
