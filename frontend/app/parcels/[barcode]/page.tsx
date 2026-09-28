"use client";
import { useEffect, useState } from "react";
import { api, API } from "../../../lib/api";

type ParcelData = {
  parcel: { id: string; parcel_code: string; barcode_value: string; status: string };
  order: { id: string; shopify_order_name: string; total_amount: number; financial_status: string; operational_status: string } | null;
  customer: { name: string | null; email: string | null; phone: string | null } | null;
  item_count: number;
};

export default function ParcelPage({ params }: { params: { barcode: string } }) {
  const [data, setData] = useState<ParcelData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token") ?? undefined;
    api<ParcelData>(`/api/v1/parcels/${params.barcode}`, {}, token)
      .then(setData)
      .catch((e: Error) => setErr(e.message));
  }, [params.barcode]);

  if (err) return <main><p role="alert">{err}</p></main>;
  if (!data) return <main><p>Loading…</p></main>;
  return (
    <main>
      <h1>Parcel {data.parcel.barcode_value}</h1>
      <p>Status: {data.parcel.status}</p>
      {data.order && (
        <p>Order: {data.order.shopify_order_name} — {data.order.total_amount}</p>
      )}
      {data.customer && <p>Customer: {data.customer.name ?? data.customer.email}</p>}
      <p>Items: {data.item_count}</p>
      <a href={`${API}/api/v1/parcels/${data.parcel.id}/label`} target="_blank" rel="noreferrer">
        Print label
      </a>
    </main>
  );
}
