import React, { useEffect, useState } from "react";
import SelectField from "./SelectField";
import { Button, Input } from "./primitives";
import { api, pushShipment } from "../lib/api";
import { INDIA_POST_HELP, newOrderDefaults, validateNewOrder } from "../lib/india-post";
import { IconAlert, IconBox, IconCheck, IconClose, IconCoin, IconMapPin, IconPackage, IconTag, IconTruck, IconUpload } from "./icons";

import ProductAvatar from "./ProductAvatar";

export type NewOrderDialogProps = {
  open: boolean;
  onClose: () => void;
  onSaved: (order: unknown) => void;
};

type FormState = Record<string, any>;

function initialForm(): FormState {
  return {
    ...newOrderDefaults(),
    receiver_name: "",
    receiver_mobile: "",
    receiver_add1: "",
    receiver_city: "",
    receiver_state: "",
    receiver_pincode: "",
    cod_value: "",
    barcode_no: "",
    line_items: [],
  };
}

export default function NewOrderDialog({ open, onClose, onSaved }: NewOrderDialogProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSenderDetails, setShowSenderDetails] = useState(false);

  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);

  const [step, setStep] = useState<"form" | "tracking">("form");
  const [savedOrder, setSavedOrder] = useState<any | null>(null);
  const [trackingNo, setTrackingNo] = useState("");
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);
  const [trackingSubmitting, setTrackingSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setSavedOrder(null);
    setTrackingNo("");
    setTrackingError(null);
    setTrackingNotice(null);
    setTrackingSubmitting(false);

    setLoadingProducts(true);
    api<any>("/api/v1/products")
      .then((res) => {
        const items = Array.isArray(res) ? res : (res?.data?.items ?? res?.items ?? []);
        setProducts(items);
      })
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false));
  }, [open]);

  const handleSelectProduct = (prod: any) => {
    setSelectedProduct(prod);
    setForm((f) => ({
      ...f,
      cod_value: prod.price ? prod.price : f.cod_value,
      total_amount: prod.price ? prod.price : f.total_amount,
      line_items: [
        {
          id: prod.shopify_product_id || prod.id,
          title: prod.title,
          sku: prod.sku,
          price: prod.price,
          quantity: 1,
          image_url: prod.image_url,
        },
      ],
    }));
  };

  if (!open) return null;

  const set = (key: string, value: string | number | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onChange =
    (key: string, numeric = false) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const raw = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
      set(key, numeric && typeof raw === "string" && raw !== "" ? Number(raw) : raw);
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateNewOrder(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const order = await api<any>("/api/v1/orders", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSavedOrder(order);
      setStep("tracking");
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save order");
    } finally {
      setSubmitting(false);
    }
  };

  const finish = (order: unknown) => {
    setSavedOrder(null);
    onSaved(order);
  };

  const handleTrackingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrackingError(null);
    setTrackingNotice(null);
    const no = trackingNo.trim();
    if (!no) {
      setTrackingError("Tracking number is required.");
      return;
    }
    const orderId = savedOrder?.id;
    if (!orderId) {
      setTrackingError("The saved order has no id to attach the shipment to.");
      return;
    }
    setTrackingSubmitting(true);
    try {
      const result = await pushShipment({
        order_id: orderId,
        tracking_no: no,
        courier_code: "IP",
      });
      // pushed: false is an HTTP 200: the Shipment row was committed either
      // way and only ShipSagar's registration was refused. Show the message,
      // but still finish so the caller refreshes and the new row is visible.
      if (!result.pushed) {
        setTrackingNotice(result.message || "ShipSagar did not accept this tracking number.");
      }
      finish(savedOrder);
    } catch (err: unknown) {
      setTrackingError(
        err instanceof Error && err.message ? err.message : "Failed to push shipment",
      );
    } finally {
      setTrackingSubmitting(false);
    }
  };

  const handleSkipTracking = () => {
    finish(savedOrder);
  };

  const renderError = (key: string) =>
    errors[key] ? (
      <span className="text-xs font-medium text-red-600 flex items-center gap-1 mt-1" role="alert">
        <IconAlert size={12} /> {errors[key]}
      </span>
    ) : null;

  const inputClass =
    "w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent transition shadow-xs";

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
      style={{ position: "fixed" }}
      role="dialog"
      aria-modal="true"
      aria-label="Create New Order"
    >
      <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-slate-900 flex items-center gap-2">
              <IconBox size={20} /> Create New Order
              <span className="bg-emerald-100 text-emerald-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                India Post
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === "form"
                ? "Fill in customer address, parcel dimensions, and COD info"
                : "Order created — add the India Post tracking number, or skip and add it later"}
            </p>
          </div>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <IconClose size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          {step === "form" ? (
          <form id="new-order-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
            
            {/* Sender Section (Prefilled) */}
            <div className="border border-slate-200 rounded-xl p-5 bg-white flex flex-col gap-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <IconTruck size={16} /> Sender Details (Default Pickup)
                </span>
                <button
                  type="button"
                  className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-medium rounded-md hover:bg-slate-200 transition"
                  onClick={() => setShowSenderDetails(!showSenderDetails)}
                >
                  {showSenderDetails ? "Hide Details" : "Edit Details"}
                </button>
              </div>

              {showSenderDetails ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-700">Sender Name</label>
                    <Input aria-label="sender_name" value={String(form.sender_name ?? "")} onChange={onChange("sender_name")} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-700">Sender Mobile</label>
                    <Input aria-label="sender_mobile" value={String(form.sender_mobile ?? "")} onChange={onChange("sender_mobile")} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-700">Sender City</label>
                    <Input aria-label="sender_city" value={String(form.sender_city ?? "")} onChange={onChange("sender_city")} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-700">Sender State</label>
                    <Input aria-label="sender_state" value={String(form.sender_state ?? "")} onChange={onChange("sender_state")} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-700">Sender Pincode</label>
                    <Input aria-label="sender_pincode" value={String(form.sender_pincode ?? "")} onChange={onChange("sender_pincode")} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-700">Sender Address Line 1</label>
                    <Input aria-label="sender_add1" value={String(form.sender_add1 ?? "")} onChange={onChange("sender_add1")} />
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-600 flex items-center gap-4 flex-wrap">
                  <span><strong>{String(form.sender_name)}</strong> ({String(form.sender_city)}, {String(form.sender_pincode)})</span>
                  <span>Mobile: {String(form.sender_mobile)}</span>
                </div>
              )}
            </div>

            {/* Shopify Product Selector */}
            <div className="border border-emerald-500/30 rounded-xl p-5 bg-emerald-50/40 flex flex-col gap-3 shadow-xs">
              <div className="flex items-center justify-between border-b border-emerald-200/60 pb-3">
                <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <IconPackage size={16} /> Select Shopify Product (Catalog)
                </span>
                {selectedProduct && (
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                    Product Selected
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-600">
                Pick a product from your full Shopify catalog to automatically attach item photo, title, SKU, and price to this order.
              </p>

              {loadingProducts ? (
                <div className="text-xs text-slate-500 py-2 flex items-center gap-2">
                  <div className="size-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                  Loading Shopify products...
                </div>
              ) : products.length === 0 ? (
                <div className="text-xs text-slate-500 py-2">
                  No products found in catalog. You can type order details manually below.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {products.map((p, idx) => {
                    const isSelected = selectedProduct && (
                      (p.id != null && selectedProduct.id === p.id) ||
                      (p.shopify_product_id != null && selectedProduct.shopify_product_id === p.shopify_product_id) ||
                      (Boolean(p.sku) && selectedProduct.sku === p.sku) ||
                      (selectedProduct.title === p.title)
                    );
                    return (
                      <div
                        key={p.id || p.shopify_product_id || p.sku || `prod-${idx}`}
                        onClick={() => handleSelectProduct(p)}
                        className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? "border-emerald-600 bg-emerald-100/70 shadow-xs ring-1 ring-emerald-500"
                            : "border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/20"
                        }`}
                      >
                        <ProductAvatar
                          imageUrl={p.image_url}
                          title={p.title}
                          className="size-10 rounded-lg border border-slate-200 shrink-0 object-cover"
                        />
                        <div className="flex-1 min-w-0 text-xs">
                          <span className="font-semibold text-slate-900 block truncate" title={p.title}>
                            {p.title}
                          </span>
                          <div className="flex items-center gap-2 text-slate-500 font-mono text-[11px]">
                            <span>{p.sku ? `SKU: ${p.sku}` : "No SKU"} • ₹{Number(p.price || 0).toLocaleString()}</span>
                            {p.stock_quantity !== undefined && (
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                  p.stock_quantity <= 0
                                    ? "bg-red-100 text-red-800"
                                    : p.stock_quantity < 5
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                Stock: {p.stock_quantity}
                              </span>
                            )}
                          </div>
                        </div>
                        {isSelected && (
                          <span className="text-emerald-700 font-bold text-xs shrink-0 flex items-center">
                            <IconCheck size={14} />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>


            {/* Receiver Section */}
            <div className="border border-slate-200 rounded-xl p-5 bg-white flex flex-col gap-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <IconTag size={16} /> Receiver Delivery Info
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Receiver Name <span className="text-red-500">*</span>
                  </label>
                  <Input
                    className={inputClass}
                    placeholder="e.g. KIRAN PATEL"
                    value={String(form.receiver_name ?? "")}
                    onChange={onChange("receiver_name")}
                  />
                  <span className="text-[11px] text-slate-500">{INDIA_POST_HELP.receiver_name}</span>
                  {renderError("receiver_name")}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Receiver Mobile <span className="text-red-500">*</span>
                  </label>
                  <Input
                    className={inputClass}
                    placeholder="10-digit mobile"
                    value={String(form.receiver_mobile ?? "")}
                    onChange={onChange("receiver_mobile")}
                  />
                  <span className="text-[11px] text-slate-500">{INDIA_POST_HELP.receiver_mobile}</span>
                  {renderError("receiver_mobile")}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Address Line 1 <span className="text-red-500">*</span>
                </label>
                <Input
                  className={inputClass}
                  placeholder="House / Flat No, Building, Street Address"
                  value={String(form.receiver_add1 ?? "")}
                  onChange={onChange("receiver_add1")}
                />
                {renderError("receiver_add1")}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    City <span className="text-red-500">*</span>
                  </label>
                  <Input
                    className={inputClass}
                    placeholder="City name"
                    value={String(form.receiver_city ?? "")}
                    onChange={onChange("receiver_city")}
                  />
                  {renderError("receiver_city")}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">State</label>
                  <Input
                    className={inputClass}
                    placeholder="State name"
                    value={String(form.receiver_state ?? "")}
                    onChange={onChange("receiver_state")}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Pincode <span className="text-red-500">*</span>
                </label>
                <Input
                  className={inputClass}
                  placeholder="6-digit pincode"
                  value={String(form.receiver_pincode ?? "")}
                  onChange={onChange("receiver_pincode")}
                />
                <span className="text-[11px] text-slate-500">{INDIA_POST_HELP.receiver_pincode}</span>
                {renderError("receiver_pincode")}
              </div>

              {form.receiver_pincode ? (
                <div className="bg-sky-50 text-sky-900 border border-sky-200 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5">
                  <IconMapPin size={13} /> DROP OFF PINCODE: <strong>{String(form.receiver_pincode)}</strong>
                </div>
              ) : null}
            </div>

            {/* Parcel Specs Section */}
            <div className="border border-slate-200 rounded-xl p-5 bg-white flex flex-col gap-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <IconBox size={16} /> Parcel & Dimensions
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Weight (Grams) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    className={inputClass}
                    type="number"
                    placeholder="e.g. 930"
                    value={String(form.weight_grams ?? "")}
                    onChange={onChange("weight_grams", true)}
                  />
                  <span className="text-[11px] text-slate-500">{INDIA_POST_HELP.weight_grams}</span>
                  {renderError("weight_grams")}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">Shape</label>
                  <Input
                    className={inputClass}
                    value={String(form.shape ?? "")}
                    onChange={onChange("shape")}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">Dimensions (L × B × H cm)</label>
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    className={inputClass}
                    type="number"
                    placeholder="Length"
                    value={String(form.length_cm ?? "")}
                    onChange={onChange("length_cm", true)}
                  />
                  <Input
                    className={inputClass}
                    type="number"
                    placeholder="Breadth"
                    value={String(form.breadth_cm ?? "")}
                    onChange={onChange("breadth_cm", true)}
                  />
                  <Input
                    className={inputClass}
                    type="number"
                    placeholder="Height"
                    value={String(form.height_cm ?? "")}
                    onChange={onChange("height_cm", true)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">Barcode No (Optional)</label>
                <Input
                  className={inputClass}
                  placeholder="e.g. EG123456789IN"
                  value={String(form.barcode_no ?? "")}
                  onChange={onChange("barcode_no")}
                />
                <span className="text-[11px] text-slate-500">{INDIA_POST_HELP.barcode_no}</span>
              </div>
            </div>

            {/* Payment & COD Section */}
            <div className="border border-slate-200 rounded-xl p-5 bg-white flex flex-col gap-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <IconCoin size={16} /> COD & Payment Details
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">Payment Mode</label>
                  <SelectField
                    ariaLabel="Payment Mode"
                    value={String(form.cod_mode ?? "")}
                    includeAll={false}
                    onChange={(v) => onChange("cod_mode")(v as any)}
                    triggerClassName={inputClass}
                    options={[
                      { value: "COD", label: "COD (Cash on Delivery)" },
                      { value: "PREPAID", label: "PREPAID" },
                    ]}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">COD Collectible Amount (₹)</label>
                  <Input
                    className={inputClass}
                    type="number"
                    placeholder="e.g. 1499"
                    value={String(form.cod_value ?? "")}
                    onChange={onChange("cod_value", true)}
                  />
                  <span className="text-[11px] text-slate-500">{INDIA_POST_HELP.cod_value}</span>
                  {renderError("cod_value")}
                </div>
              </div>
            </div>

            {submitError && (
              <div className="bg-red-50 text-red-800 border border-red-200 p-4 rounded-xl text-sm font-medium flex items-center gap-2">
                <IconAlert size={16} /> {submitError}
              </div>
            )}
          </form>
          ) : (
            <form
              id="tracking-step-form"
              onSubmit={handleTrackingSubmit}
              noValidate
              className="flex flex-col gap-5"
            >
              {trackingError && (
                <div
                  role="alert"
                  className="bg-red-50 text-red-800 border border-red-200 p-4 rounded-xl text-sm font-medium flex items-center gap-2"
                >
                  <IconAlert size={16} /> {trackingError}
                </div>
              )}
              {trackingNotice && (
                <div
                  role="status"
                  className="bg-amber-50 text-amber-900 border border-amber-200 p-4 rounded-xl text-sm font-medium flex items-start gap-2"
                >
                  <IconAlert size={16} />
                  <span>
                    <span className="block font-semibold mb-1">
                      The shipment was saved, but ShipSagar did not accept the tracking number.
                    </span>
                    {trackingNotice}
                  </span>
                </div>
              )}

              <div className="border border-slate-200 rounded-xl p-5 bg-white flex flex-col gap-4 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <IconTruck size={16} /> Tracking Number
                  </span>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Step 2 of 2
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tracking-no" className="text-xs font-semibold text-slate-700">
                    Tracking Number (Optional)
                  </label>
                  <Input
                    id="tracking-no"
                    className={inputClass}
                    placeholder="e.g. EG123456789IN"
                    value={trackingNo}
                    onChange={(e) => setTrackingNo(e.target.value)}
                  />
                  <span className="text-[11px] text-slate-500">
                    Tracking number issued by the India Post worker. This becomes the parcel
                    barcode and the AWB.
                  </span>
                </div>

                <div className="bg-sky-50 text-sky-900 border border-sky-200 px-3 py-2 rounded-lg text-xs font-medium">
                  Skip for now if the worker has not issued a number yet — the order is
                  already saved and you can add the shipment from the Orders table.
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          {step === "form" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                form="new-order-form"
                className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5"
                disabled={submitting}
              >
                <IconCheck size={14} />
                {submitting ? "Saving Order…" : "Save & Create Order"}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSkipTracking}
                disabled={trackingSubmitting}
              >
                Skip for now
              </Button>
              <Button
                type="submit"
                size="sm"
                form="tracking-step-form"
                className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5"
                disabled={trackingSubmitting}
              >
                <IconUpload size={14} />
                {trackingSubmitting ? "Pushing…" : "Save & push shipment"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
