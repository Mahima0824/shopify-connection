import React, { useEffect, useState } from "react";
import SelectField from "./SelectField";
import { api } from "../lib/api";
import { Button, Card, Input, Label } from "./primitives";
import { IconAlert, IconCheck, IconClose, IconStore } from "./icons";

export type EditOrderDialogProps = {
  open: boolean;
  order: any | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function EditOrderDialog({
  open,
  order,
  onClose,
  onSaved,
}: EditOrderDialogProps) {
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (order) {
      setForm({
        shopify_order_name: order.shopify_order_name || order.internal_order_number || "",
        total_amount: order.total_amount ?? "",
        financial_status: order.financial_status || "PAID",
        cod_mode: order.cod_mode || "COD",
        cod_value: order.cod_value ?? "",
        receiver_name: order.receiver_name || "",
        receiver_mobile: order.receiver_mobile || "",
        receiver_add1: order.receiver_add1 || "",
        receiver_city: order.receiver_city || "",
        receiver_state: order.receiver_state || "",
        receiver_pincode: order.receiver_pincode || "",
        weight_grams: order.weight_grams ?? 930,
        length_cm: order.length_cm ?? 30,
        breadth_cm: order.breadth_cm ?? 20,
        height_cm: order.height_cm ?? 5,
      });
      setError(null);
    }
  }, [order, open]);

  if (!open || !order) return null;

  const handleChange = (key: string, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem("token") ?? undefined;
      await api(
        `/api/v1/orders/${order.id}`,
        {
          method: "PUT",
          body: JSON.stringify(form),
        },
        token
      );
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to update order");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full h-9 px-3 bg-card border border-border/80 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition shadow-xs";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-order-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-2xl border-border/80 bg-background rounded-2xl">
        <div className="flex items-center justify-between border-b border-border/80 pb-4 mb-4">
          <div>
            <h2 id="edit-order-title" className="text-xl font-medium font-heading text-foreground">
              Edit Order {order.shopify_order_name || order.internal_order_number || order.id}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Update details for internal order #{order.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full size-8 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition"
          >
            <IconClose size={16} />
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
            <IconAlert size={15} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                Order Name / Code
              </Label>
              <Input
                value={form.shopify_order_name || ""}
                onChange={(e) => handleChange("shopify_order_name", e.target.value)}
                placeholder="#1001"
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                Total Amount (₹)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={form.total_amount ?? ""}
                onChange={(e) => handleChange("total_amount", e.target.value)}
                placeholder="699.95"
                className="h-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                Financial Status
              </Label>
              <SelectField
                ariaLabel="Financial Status"
                value={form.financial_status || "PAID"}
                includeAll={false}
                onChange={(v) => handleChange("financial_status", v)}
                triggerClassName={inputClass}
                options={[
                  { value: "PAID", label: "PAID" },
                  { value: "PENDING", label: "PENDING" },
                  { value: "REFUNDED", label: "REFUNDED" },
                ]}
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                Payment Mode
              </Label>
              <SelectField
                ariaLabel="Payment Mode"
                value={form.cod_mode || "COD"}
                includeAll={false}
                onChange={(v) => handleChange("cod_mode", v)}
                triggerClassName={inputClass}
                options={[
                  { value: "COD", label: "COD" },
                  { value: "PREPAID", label: "PREPAID" },
                ]}
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                COD Value (₹)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={form.cod_value ?? ""}
                onChange={(e) => handleChange("cod_value", e.target.value)}
                placeholder="0"
                className="h-9"
              />
            </div>
          </div>

          <div className="border-t border-border/60 pt-3 flex flex-col gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-primary font-heading">
              Customer &amp; Shipping Details
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  Customer Name
                </Label>
                <Input
                  value={form.receiver_name || ""}
                  onChange={(e) => handleChange("receiver_name", e.target.value)}
                  placeholder="John Doe"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  Mobile Number
                </Label>
                <Input
                  value={form.receiver_mobile || ""}
                  onChange={(e) => handleChange("receiver_mobile", e.target.value)}
                  placeholder="9876543210"
                  className="h-9"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                Street Address
              </Label>
              <Input
                value={form.receiver_add1 || ""}
                onChange={(e) => handleChange("receiver_add1", e.target.value)}
                placeholder="123 Main Street"
                className="h-9"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  City
                </Label>
                <Input
                  value={form.receiver_city || ""}
                  onChange={(e) => handleChange("receiver_city", e.target.value)}
                  placeholder="Surat"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  State
                </Label>
                <Input
                  value={form.receiver_state || ""}
                  onChange={(e) => handleChange("receiver_state", e.target.value)}
                  placeholder="Gujarat"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  Pincode
                </Label>
                <Input
                  value={form.receiver_pincode || ""}
                  onChange={(e) => handleChange("receiver_pincode", e.target.value)}
                  placeholder="394210"
                  className="h-9"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-border/60 pt-3 flex flex-col gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-heading flex items-center gap-1.5">
              <IconStore size={14} className="text-status-success" /> Weight &amp; Parcel Dimensions (India Post)
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  Weight (g)
                </Label>
                <Input
                  type="number"
                  value={form.weight_grams ?? ""}
                  onChange={(e) => handleChange("weight_grams", e.target.value)}
                  placeholder="930"
                  className="h-9 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  Length (cm)
                </Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.length_cm ?? ""}
                  onChange={(e) => handleChange("length_cm", e.target.value)}
                  placeholder="30"
                  className="h-9 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  Width (cm)
                </Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.breadth_cm ?? ""}
                  onChange={(e) => handleChange("breadth_cm", e.target.value)}
                  placeholder="20"
                  className="h-9 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">
                  Height (cm)
                </Label>
                <Input
                  type="number"
                  step="0.1"
                  value={form.height_cm ?? ""}
                  onChange={(e) => handleChange("height_cm", e.target.value)}
                  placeholder="5"
                  className="h-9 font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border/80 pt-4 mt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving} className="font-semibold px-5 gap-1.5">
              <IconCheck size={14} />
              {saving ? "Saving Changes..." : "Save Order"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
