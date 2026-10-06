import React from "react";
import LabelPreview from "../components/barcode/LabelPreview";

const CODES = ["P00000001", "P00000002"];

export default function TestSheetPage() {
  return (
    <div className="container" style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px" }}>
      <div>
        <h1 className="display" style={{ fontSize: "28px", fontWeight: 700 }}>Barcode Test Sheet</h1>
        <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
          Print this sheet to verify handheld and phone-camera scanning before going live.
        </p>
      </div>
      <button type="button" className="btn-primary" onClick={() => window.print()} style={{ alignSelf: "flex-start" }}>
        Print Test Sheet
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {CODES.map((c) => (
          <LabelPreview key={c} businessName="Test Business" orderName="TEST-ORDER" parcelCode={c} />
        ))}
      </div>
    </div>
  );
}
