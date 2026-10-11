import React, { useEffect, useMemo, useState } from "react";
import SelectField from "../components/SelectField";
import { Link, useNavigate } from "react-router-dom";
import { api, pushShipment } from "../lib/api";
import { newOrderDefaults } from "../lib/india-post";
import { Button, Card, Badge, Input, Textarea } from "../components/primitives";
import { CarrierIcon } from "../components/CarrierIcon";
import {
  IconAlert,
  IconBox,
  IconCheck,
  IconChevronLeft,
  IconClose,
  IconCoin,
  IconMapPin,
  IconPackage,
  IconSearch,
  IconTruck,
} from "../components/icons";

interface SareeProduct {
  id: string;
  shopify_product_id?: string;
  title: string;
  sku?: string | null;
  price: number;
  image_url?: string | null;
}

interface SelectedItem {
  product: SareeProduct;
  quantity: number;
}

const FABRIC_FILTERS = [
  "All",
  "Bandhani",
  "Silk",
  "Banarasi",
  "Paithani",
  "Ajrakh",
  "Pichwai",
  "Georgette",
  "Kanjivaram",
];

export default function CreateOrder() {
  const navigate = useNavigate();

  // Products state
  const [products, setProducts] = useState<SareeProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  // Cart / Selected Sarees
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  // Form fields
  const [customerName, setCustomerName] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Gujarat");
  const [pincode, setPincode] = useState("");

  // Payment Mode: "COD" | "PREPAID"
  const [paymentMode, setPaymentMode] = useState<"COD" | "PREPAID">("COD");

  // Parcel & Courier Details
  const [weightGrams, setWeightGrams] = useState(930);
  const [lengthCm, setLengthCm] = useState(30);
  const [breadthCm, setBreadthCm] = useState(20);
  const [heightCm, setHeightCm] = useState(5);
  const [carrierCode, setCarrierCode] = useState("IP");

  // Submitting state & tracking step
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [createdOrder, setCreatedOrder] = useState<any | null>(null);

  // Tracking modal / step
  const [trackingNo, setTrackingNo] = useState("");
  const [trackingSubmitting, setTrackingSubmitting] = useState(false);
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);

  useEffect(() => {
    setLoadingProducts(true);
    api<any>("/api/v1/products")
      .then((res) => {
        const items = Array.isArray(res) ? res : res?.data?.items ?? res?.items ?? [];
        setProducts(items);
      })
      .catch((err) => {
        console.error("Failed to fetch products:", err);
        setProducts([]);
      })
      .finally(() => setLoadingProducts(false));
  }, []);

  // Filter products by search and category
  const filteredProducts = useMemo(() => {
    let list = products.filter(
      (p) => (p.price || 0) > 0 && !p.title.toLowerCase().includes("partial payment")
    );
    if (activeCategory !== "All") {
      const cat = activeCategory.toLowerCase();
      list = list.filter((p) => (p.title || "").toLowerCase().includes(cat));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          (p.title || "").toLowerCase().includes(q) ||
          (p.sku || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, activeCategory, searchQuery]);

  // Compute pricing totals
  const subtotal = useMemo(() => {
    return selectedItems.reduce((acc, it) => acc + it.product.price * it.quantity, 0);
  }, [selectedItems]);

  const totalSareeCount = useMemo(() => {
    return selectedItems.reduce((acc, it) => acc + it.quantity, 0);
  }, [selectedItems]);

  // Auto-adjust weight with quantity
  useEffect(() => {
    if (totalSareeCount > 0) {
      setWeightGrams(totalSareeCount * 930);
    }
  }, [totalSareeCount]);

  // COD Calculation Rule:
  // Customer pays ₹300 advance online.
  // Remaining = total - 300.
  // COD delivery charge = +₹50.
  // Cash on Delivery to collect = remaining + 50.
  const codAdvance = paymentMode === "COD" ? 300 : 0;
  const codRemaining = paymentMode === "COD" ? Math.max(0, subtotal - codAdvance) : 0;
  const codHandlingFee = paymentMode === "COD" ? 50 : 0;
  const codCollectableAmount = paymentMode === "COD" ? codRemaining + codHandlingFee : 0;

  const handleAddProduct = (prod: SareeProduct) => {
    setSelectedItems((prev) => {
      const idx = prev.findIndex((it) => it.product.id === prod.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { product: prod, quantity: 1 }];
    });
  };

  const handleUpdateQuantity = (prodId: string, delta: number) => {
    setSelectedItems((prev) => {
      return prev
        .map((it) => {
          if (it.product.id === prodId) {
            const nextQty = it.quantity + delta;
            return nextQty > 0 ? { ...it, quantity: nextQty } : null;
          }
          return it;
        })
        .filter(Boolean) as SelectedItem[];
    });
  };

  const handleRemoveItem = (prodId: string) => {
    setSelectedItems((prev) => prev.filter((it) => it.product.id !== prodId));
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!customerName.trim()) errs.customerName = "Customer name is required";
    const cleanMobile = customerMobile.replace(/\D/g, "");
    if (!cleanMobile || (cleanMobile.length !== 10 && cleanMobile.length !== 12)) {
      errs.customerMobile = "Please enter a valid 10-digit mobile number";
    }
    if (!addressLine1.trim()) errs.addressLine1 = "Street address is required";
    if (!city.trim()) errs.city = "City is required";
    if (!state.trim()) errs.state = "State is required";
    const cleanPin = pincode.replace(/\D/g, "");
    if (cleanPin.length !== 6) errs.pincode = "6-digit PIN code is required";
    if (selectedItems.length === 0) errs.items = "Please select at least one saree";

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateForm()) return;

    setSubmitting(true);
    const defaults = newOrderDefaults();

    const payload = {
      ...defaults,
      receiver_name: customerName.trim(),
      receiver_mobile: customerMobile.replace(/\D/g, "").slice(-10),
      receiver_email: customerEmail.trim() || undefined,
      receiver_add1: addressLine1.trim(),
      receiver_add2: addressLine2.trim() || undefined,
      receiver_city: city.trim(),
      receiver_state: state.trim(),
      receiver_pincode: pincode.trim(),
      weight_grams: weightGrams,
      length_cm: lengthCm,
      breadth_cm: breadthCm,
      height_cm: heightCm,
      shape: "NROL",
      cod_mode: paymentMode,
      total_amount: subtotal,
      cod_value: paymentMode === "COD" ? codCollectableAmount : 0,
      line_items: selectedItems.map((it) => ({
        id: it.product.shopify_product_id || it.product.id,
        title: it.product.title,
        sku: it.product.sku,
        price: it.product.price,
        quantity: it.quantity,
        image_url: it.product.image_url,
      })),
    };

    try {
      const res = await api<any>("/api/v1/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const order = res?.data || res;
      setCreatedOrder(order);
    } catch (err: any) {
      setError(err?.message || "Failed to create order. Please check inputs.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAttachTracking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingNo.trim() || !createdOrder?.id) return;
    setTrackingSubmitting(true);
    setTrackingNotice(null);
    try {
      const result = await pushShipment({
        order_id: createdOrder.id,
        tracking_no: trackingNo.trim(),
        courier_code: carrierCode,
      });
      if (!result.pushed) {
        setTrackingNotice(result.message || "Carrier did not acknowledge tracking number.");
      }
      navigate("/orders");
    } catch (err: any) {
      setTrackingNotice(err?.message || "Tracking registration queued.");
      setTimeout(() => navigate("/orders"), 2000);
    } finally {
      setTrackingSubmitting(false);
    }
  };

  return (
    <div className="page-shell py-6 space-y-6">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/orders" className="hover:text-foreground transition">
              Orders
            </Link>
            <span>/</span>
            <span className="text-foreground font-semibold">New Order</span>
          </div>
          <h1 className="text-2xl font-medium font-heading text-foreground tracking-tight flex items-center gap-2">
            <IconBox size={26} className="text-primary" /> Create New Order
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Select sarees from your store catalogue, enter customer details, and generate shipment.
          </p>
        </div>

        <Link to="/orders">
          <Button variant="outline" size="sm" className="gap-2">
            <IconChevronLeft size={14} />
            Back to Orders
          </Button>
        </Link>
      </div>

      {/* Main Order Creation Form */}
      <form onSubmit={handleCreateOrder} noValidate className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Saree Picker & Customer Details */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-8">
          
          {/* Section 1: Saree Selection */}
          <Card className="p-6 border-border/80 shadow-xs space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
              <div>
                <h2 className="text-lg font-medium font-heading text-foreground flex items-center gap-2">
                  <IconPackage size={18} className="text-primary" /> Select Sarees for Order
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Browse or search through your live store collection. Click to add sarees.
                </p>
              </div>

              {selectedItems.length > 0 && (
                <Badge variant="secondary" className="bg-primary/10 text-primary font-bold text-xs px-3 py-1 flex items-center gap-1">
                  <IconCheck size={12} />
                  <span>{totalSareeCount} Saree{totalSareeCount > 1 ? "s" : ""} Added</span>
                </Badge>
              )}
            </div>

            {/* Saree Search & Filter Bar */}
            <div className="space-y-3">
                <div className="relative flex items-center">
                  <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    type="text"
                    placeholder="Search sarees by title, colour, design, or SKU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 bg-background border border-border/80 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary shadow-2xs transition"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center p-1"
                      aria-label="Clear search"
                    >
                      <IconClose size={14} />
                    </button>
                  )}
                </div>

              {/* Category Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
                {FABRIC_FILTERS.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`px-3 py-1.5 rounded-full font-medium transition cursor-pointer shrink-0 ${
                      activeCategory === cat
                        ? "bg-primary text-primary-foreground shadow-2xs font-bold"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Error Message if no items */}
            {fieldErrors.items && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive text-xs p-3 rounded-lg flex items-center gap-2">
                <IconAlert size={14} /> {fieldErrors.items}
              </div>
            )}

            {/* Saree Grid (Large High-Resolution Cards & Large Typography) */}
            <div className="max-h-[520px] overflow-y-auto pr-1 no-scrollbar space-y-3">
              {loadingProducts ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Loading sarees from store catalogue...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No sarees matched your search query. Try another keyword.
                </div>
              ) : (
                filteredProducts.map((prod) => {
                  const selected = selectedItems.find((it) => it.product.id === prod.id);
                  const isSelected = !!selected;

                  return (
                    <div
                      key={prod.id}
                      onClick={() => !isSelected && handleAddProduct(prod)}
                      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 p-3.5 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary/40"
                          : "border-border/70 bg-card hover:border-primary/40 hover:bg-muted/30"
                      }`}
                    >
                      {/* Product Image & Information */}
                      <div className="flex items-center gap-3.5 flex-1 min-w-0 w-full sm:w-auto">
                        <div className="size-20 sm:size-24 rounded-xl overflow-hidden bg-muted/40 shrink-0 border border-border/60 shadow-2xs">
                          {prod.image_url ? (
                            <img
                              src={prod.image_url}
                              alt={prod.title}
                              className="size-full object-cover object-center transition hover:scale-105 duration-300"
                              loading="lazy"
                            />
                          ) : (
                            <div className="size-full flex items-center justify-center text-muted-foreground/60 bg-muted/60">
                              <IconPackage size={24} />
                            </div>
                          )}
                        </div>

                        {/* Saree Information & Large Typography */}
                        <div className="flex-1 min-w-0 pr-2">
                          <h3 className="text-sm sm:text-base font-medium font-heading text-foreground leading-snug line-clamp-2">
                            {prod.title}
                          </h3>
                          {prod.sku && (
                            <span className="font-mono text-xs text-muted-foreground mt-0.5 block truncate">
                              SKU: {prod.sku}
                            </span>
                          )}
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="font-mono text-sm sm:text-base font-extrabold text-primary">
                              ₹{Number(prod.price || 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Add Button or Quantity Controls */}
                      <div className="shrink-0 flex items-center self-end sm:self-center" onClick={(e) => e.stopPropagation()}>
                        {isSelected ? (
                          <div className="flex items-center gap-2 bg-background border border-primary/40 rounded-xl p-1 shadow-2xs">
                            <button
                              type="button"
                              onClick={() => handleUpdateQuantity(prod.id, -1)}
                              className="size-8 rounded-lg bg-muted flex items-center justify-center text-sm font-bold hover:bg-muted/80 text-foreground"
                              title="Decrease quantity"
                            >
                              -
                            </button>
                            <span className="font-mono font-bold text-sm px-1.5 min-w-[20px] text-center text-foreground">
                              {selected.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateQuantity(prod.id, 1)}
                              className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold hover:bg-primary/90"
                              title="Increase quantity"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddProduct(prod)}
                            className="px-4 py-2 bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground font-bold text-xs rounded-xl transition shadow-2xs"
                          >
                            + Select Saree
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* Section 2: Customer Shipping Address */}
          <Card className="p-6 border-border/80 shadow-xs space-y-5">
            <div className="border-b border-border/60 pb-3">
              <h2 className="text-lg font-medium font-heading text-foreground flex items-center gap-2">
                <IconMapPin size={18} className="text-primary" /> Customer & Delivery Address
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Exact shipping details where the saree parcel will be delivered.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Customer Name */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-foreground">Customer Full Name *</label>
                <Input
                  type="text"
                  placeholder="e.g. Sonal Sharma"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-primary shadow-2xs"
                  required
                />
                {fieldErrors.customerName && (
                  <span className="text-xs text-destructive font-medium block">
                    {fieldErrors.customerName}
                  </span>
                )}
              </div>

              {/* Mobile Phone */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Mobile Number (10 Digits) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-muted-foreground font-mono">
                    +91
                  </span>
                  <Input
                    type="tel"
                    placeholder="9016822651"
                    maxLength={10}
                    value={customerMobile}
                    onChange={(e) => setCustomerMobile(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 bg-background border border-border rounded-xl text-sm font-mono focus:ring-2 focus:ring-primary shadow-2xs"
                    required
                  />
                </div>
                {fieldErrors.customerMobile && (
                  <span className="text-xs text-destructive font-medium block">
                    {fieldErrors.customerMobile}
                  </span>
                )}
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Email Address (Optional)</label>
                <Input
                  type="email"
                  placeholder="customer@gmail.com"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-primary shadow-2xs"
                />
              </div>

              {/* Street Address Line 1 */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Address Line 1 (Flat / House No, Building, Road) *
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Flat 402, Royal Residency, Station Road"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-primary shadow-2xs"
                  required
                />
                {fieldErrors.addressLine1 && (
                  <span className="text-xs text-destructive font-medium block">
                    {fieldErrors.addressLine1}
                  </span>
                )}
              </div>

              {/* Street Address Line 2 */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Address Line 2 (Area, Colony, Landmark)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Near Shreyas School, Opp. City Mall"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-primary shadow-2xs"
                />
              </div>

              {/* City */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">City *</label>
                <Input
                  type="text"
                  placeholder="e.g. Surat"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-primary shadow-2xs"
                  required
                />
                {fieldErrors.city && (
                  <span className="text-xs text-destructive font-medium block">
                    {fieldErrors.city}
                  </span>
                )}
              </div>

              {/* State */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">State *</label>
                <Input
                  type="text"
                  placeholder="e.g. Gujarat"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-primary shadow-2xs"
                  required
                />
                {fieldErrors.state && (
                  <span className="text-xs text-destructive font-medium block">
                    {fieldErrors.state}
                  </span>
                )}
              </div>

              {/* PIN Code */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">PIN Code (6 Digits) *</label>
                <Input
                  type="text"
                  placeholder="395002"
                  maxLength={6}
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-sm font-mono focus:ring-2 focus:ring-primary shadow-2xs"
                  required
                />
                {fieldErrors.pincode && (
                  <span className="text-xs text-destructive font-medium block">
                    {fieldErrors.pincode}
                  </span>
                )}
              </div>

              {/* Preferred Courier */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Preferred Delivery Partner</label>
                <SelectField
                  ariaLabel="Preferred Delivery Partner"
                  value={carrierCode}
                  includeAll={false}
                  onChange={setCarrierCode}
                  triggerClassName="w-full px-3.5 py-2.5 rounded-xl bg-background"
                  options={[
                    { value: "IP", label: "India Post (Speed Post)", icon: <CarrierIcon code="INDIA_POST" /> },
                    { value: "DELHIVERY", label: "Delhivery (Surface/Express)", icon: <CarrierIcon code="DELHIVERY" /> },
                    { value: "BLUEDART", label: "Blue Dart Express", icon: <CarrierIcon code="BLUEDART" /> },
                    { value: "DTDC", label: "DTDC Express", icon: <CarrierIcon code="DTDC" /> },
                  ]}
                />
              </div>
            </div>
          </Card>

          {/* Section 3: Parcel Dimensions */}
          <Card className="p-6 border-border/80 shadow-xs space-y-4">
            <div className="border-b border-border/60 pb-3">
              <h2 className="text-lg font-medium font-heading text-foreground flex items-center gap-2">
                <IconTruck size={18} /> Parcel Package Specifications
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Dead weight and box dimensions for courier manifest generation.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Weight (Grams)</label>
                <Input
                  type="number"
                  value={weightGrams}
                  onChange={(e) => setWeightGrams(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Length (cm)</label>
                <Input
                  type="number"
                  value={lengthCm}
                  onChange={(e) => setLengthCm(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Breadth (cm)</label>
                <Input
                  type="number"
                  value={breadthCm}
                  onChange={(e) => setBreadthCm(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Height (cm)</label>
                <Input
                  type="number"
                  value={heightCm}
                  onChange={(e) => setHeightCm(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Order Summary, Advance & COD Breakdown */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-6">
          <div className="sticky top-6 space-y-6">
            
            {/* Order Summary & Pricing Breakdown Card */}
            <Card className="p-6 border-primary/30 bg-card shadow-md space-y-5">
              <div className="border-b border-border/80 pb-3">
                <h3 className="text-base font-medium font-heading text-foreground flex items-center justify-between">
                  <span>Order Summary</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {totalSareeCount} Item{totalSareeCount > 1 ? "s" : ""}
                  </Badge>
                </h3>
              </div>

              {/* Selected Items List */}
              {selectedItems.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border">
                  No sarees selected yet.
                  <br />
                  Select sarees from the catalogue on the left.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                  {selectedItems.map((it) => (
                    <div
                      key={it.product.id}
                      className="flex items-center gap-3 p-2 bg-muted/20 border border-border/60 rounded-xl text-xs"
                    >
                      <img
                        src={it.product.image_url || ""}
                        alt={it.product.title}
                        className="size-10 object-cover rounded-lg border border-border shrink-0 bg-muted"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-foreground truncate">{it.product.title}</p>
                        <p className="text-muted-foreground font-mono">
                          Qty: {it.quantity} × ₹{it.product.price}
                        </p>
                      </div>
                      <span className="font-mono font-bold text-foreground shrink-0">
                        ₹{(it.product.price * it.quantity).toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(it.product.id)}
                        className="text-muted-foreground hover:text-destructive p-1 rounded transition"
                        title="Remove"
                      >
                        <IconClose size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Payment Mode Selector */}
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="text-xs font-bold text-foreground uppercase tracking-wider block">
                  Payment Mode
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMode("COD")}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      paymentMode === "COD"
                        ? "border-amber-500 bg-amber-50/70 dark:bg-amber-950/20 text-foreground ring-1 ring-amber-500"
                        : "border-border bg-background hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <span className="font-bold text-sm flex items-center gap-1.5"><IconPackage size={14} /> COD Order</span>
                    <span className="text-[11px] text-muted-foreground block mt-0.5">
                      ₹300 Advance + Remainder on Delivery
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMode("PREPAID")}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                      paymentMode === "PREPAID"
                        ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/20 text-foreground ring-1 ring-emerald-500"
                        : "border-border bg-background hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <span className="font-bold text-sm flex items-center gap-1.5"><IconCoin size={14} /> Prepaid</span>
                    <span className="text-[11px] text-muted-foreground block mt-0.5">
                      Full Payment Collected Online
                    </span>
                  </button>
                </div>
              </div>

              {/* Transparent COD Financial Calculation Card */}
              {paymentMode === "COD" ? (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between font-semibold text-foreground">
                    <span>Saree Total Value</span>
                    <span className="font-mono">₹{subtotal.toLocaleString()}</span>
                  </div>

                  <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400 font-semibold">
                    <span>Advance Payment (Paid by Customer)</span>
                    <span className="font-mono">-₹{codAdvance.toLocaleString()}</span>
                  </div>

                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Remaining Balance</span>
                    <span className="font-mono">₹{codRemaining.toLocaleString()}</span>
                  </div>

                  <div className="flex items-center justify-between text-amber-800 dark:text-amber-300 font-semibold">
                    <span>COD Courier Handling Fee</span>
                    <span className="font-mono">+₹{codHandlingFee.toLocaleString()}</span>
                  </div>

                  <div className="pt-2 border-t border-amber-500/20 flex items-center justify-between font-extrabold text-sm text-foreground">
                    <span>Cash on Delivery to Collect</span>
                    <span className="font-mono text-base text-amber-700 dark:text-amber-400">
                      ₹{codCollectableAmount.toLocaleString()}
                    </span>
                  </div>

                  <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                    * Policy: ₹300 paid upfront. The courier will collect remaining ₹{codRemaining} + ₹50 handling charge (₹{codCollectableAmount}) on parcel delivery.
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold text-sm text-foreground">
                    <span>Total Amount Paid</span>
                    <span className="font-mono text-base text-emerald-600">
                      ₹{subtotal.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Collectable on Delivery</span>
                    <span className="font-mono font-bold text-foreground">₹0 (Prepaid)</span>
                  </div>
                </div>
              )}

              {/* Submit Error */}
              {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive text-xs p-3 rounded-xl flex items-center gap-2">
                  <IconAlert size={14} /> {error}
                </div>
              )}

              {/* Submit & Cancel Buttons */}
              <div className="space-y-2 pt-2">
                <Button
                  type="submit"
                  disabled={submitting || selectedItems.length === 0}
                  className="w-full h-11 text-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition disabled:opacity-50 gap-2"
                >
                  <IconCheck size={16} />
                  {submitting ? "Creating Order..." : "Create & Confirm Order"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/orders")}
                  disabled={submitting}
                  className="w-full text-xs font-semibold"
                >
                  Cancel
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </form>

      {/* Post-Creation Tracking Modal */}
      {createdOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in">
          <Card className="w-full max-w-md p-6 bg-card border-border shadow-2xl space-y-5">
            <div className="text-center space-y-1.5">
              <span className="size-12 rounded-full bg-emerald-500/10 text-emerald-600 text-2xl flex items-center justify-center mx-auto">
                <IconCheck size={24} />
              </span>
              <h3 className="text-lg font-medium font-heading text-foreground">
                Order Created Successfully!
              </h3>
              <p className="font-mono text-xs text-primary font-bold">
                Order ID: {createdOrder.shopify_order_name || createdOrder.internal_order_number || createdOrder.id}
              </p>
            </div>

            {paymentMode === "COD" && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs space-y-1 text-foreground">
                <p className="font-bold">COD Collection Summary:</p>
                <p>Advance: <strong>₹300 Paid</strong></p>
                <p>Collect on Delivery: <strong className="text-amber-600 font-mono">₹{codCollectableAmount}</strong></p>
              </div>
            )}

            <form onSubmit={handleAttachTracking} className="space-y-3">
              <label className="text-xs font-semibold text-foreground block">
                Have the AWB / Tracking Number now? (Optional)
              </label>
              <Input
                type="text"
                placeholder="e.g. EG080960145IN or 123456789"
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
              />

              {trackingNotice && (
                <p className="text-xs text-amber-600 font-medium">{trackingNotice}</p>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/orders")}
                  className="flex-1 text-xs"
                >
                  Skip & Go to Orders
                </Button>
                <Button
                  type="submit"
                  disabled={trackingSubmitting || !trackingNo.trim()}
                  className="flex-1 text-xs font-bold bg-primary"
                >
                  {trackingSubmitting ? "Pushing..." : "Attach Tracking"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
