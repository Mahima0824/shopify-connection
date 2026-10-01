import React from "react";
import ParcelBarcode from "./ParcelBarcode";

export default function LabelPreview({ businessName, orderName, parcelCode, customer, itemCount, reprint }: {
  businessName: string; orderName: string; parcelCode: string; customer?: string | null; itemCount?: number; reprint?: boolean;
}) {
  return (
    <div className="label" style={{ background: "#fff", color: "#000", padding: 24, maxWidth: 380 }}>
      {reprint && <p style={{ fontWeight: 800 }}>REPRINT</p>}
      <h3>{businessName}</h3>
      <p>Order: {orderName}</p>
      <p>Parcel: {parcelCode}</p>
      {customer && <p>Customer: {customer}</p>}
      {itemCount != null && <p>Items: {itemCount}</p>}
      <ParcelBarcode value={parcelCode} />
      <p>{parcelCode}</p>
    </div>
  );
}
