import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./primitives";
import { isAwaiting, pushStateLabel, statusTone, type OrderShipment } from "../lib/shipments";
import { IconEdit, IconMoreVertical, IconTrash } from "./icons";
import ProductAvatar from "./ProductAvatar";
import { downloadInvoicePdf } from "../lib/api";


const FINANCIAL_DOTS: Record<string, string> = {
  PAID: "var(--destructive)",
  PENDING: "var(--secondary-foreground)",
  REFUNDED: "var(--muted-foreground)",
};

function StatusBadge({ status, dotMap }: { status: string; dotMap: Record<string, string> }) {
  const dot = dotMap[status?.toUpperCase()] ?? "var(--muted-foreground)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-muted/60 border border-border/80 text-foreground">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: dot }}
      />
      {status}
    </span>
  );
}

function ShipmentCell({
  shipment,
  onAdd,
}: {
  shipment: OrderShipment | null | undefined;
  onAdd: () => void;
}) {
  if (!shipment) {
    return <span className="text-xs text-muted-foreground">{pushStateLabel("none")}</span>;
  }

  if (isAwaiting(shipment)) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 text-center" onClick={(e) => e.stopPropagation()}>
        <Button
          type="button"
          size="sm"
          onClick={onAdd}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
        >
          Add Shipment
        </Button>
        <span className="text-[11px] text-amber-600 font-medium">{pushStateLabel("awaiting")}</span>
      </div>
    );
  }

  if (shipment.push_state === "rejected") {
    return (
      <div className="flex flex-col items-center justify-center gap-1 text-center" onClick={(e) => e.stopPropagation()}>
        <span className="font-mono text-xs text-foreground font-medium">{shipment.awb_number}</span>
        <span className="text-[11px] text-destructive font-medium">{pushStateLabel("rejected")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-1 text-center" onClick={(e) => e.stopPropagation()}>
      {shipment.id ? (
        <Link
          to={`/shipments/${shipment.id}`}
          className="font-mono text-xs font-semibold text-primary hover:underline"
        >
          {shipment.awb_number}
        </Link>
      ) : (
        <span className="font-mono text-xs text-foreground font-medium">{shipment.awb_number}</span>
      )}
      {shipment.carrier_code && (
        <span className="text-[10px] font-semibold text-muted-foreground uppercase px-1.5 py-0.2 rounded bg-muted border border-border/60">
          {shipment.carrier_code === "IP" || shipment.carrier_code === "INDIA_POST"
            ? "India Post"
            : shipment.carrier_code}
        </span>
      )}
    </div>
  );
}

export default function OrderTable({
  orders,
  onAddShipment,
  onEditOrder,
  onDeleteOrder,
  onViewOrder,
  onWhatsApp,
}: {
  orders: any[];
  onAddShipment?: (order: any) => void;
  onEditOrder?: (order: any) => void;
  onDeleteOrder?: (order: any) => void;
  onViewOrder?: (order: any) => void;
  onWhatsApp?: (order: any) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  if (!orders || orders.length === 0) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-12 text-center text-sm text-muted-foreground shadow-xs">
        No orders found. Click &quot;Sync Shopify Orders&quot; to import data.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-left min-w-[200px]">Order & Item</TableHead>
          <TableHead className="text-center">Shipment</TableHead>
          <TableHead className="text-center">Financial Status</TableHead>
          <TableHead className="text-center">Total Amount</TableHead>
          <TableHead className="text-center">COD</TableHead>
          <TableHead className="text-center">City / Pincode</TableHead>
          <TableHead className="text-center">Date</TableHead>
          <TableHead className="text-center">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => {
          const items = Array.isArray(o.items) ? o.items : [];
          const itemCount = items.length;
          const firstItem = itemCount > 0 ? items[0] : null;
          const secondItem = itemCount > 1 ? items[1] : null;
          return (
            <TableRow
              key={o.id}
              onClick={() => onViewOrder?.(o)}
              className="cursor-pointer hover:bg-muted/40 transition-colors"
            >
              <TableCell className="text-left">
                <div className="flex items-center gap-3">
                  {/* Thumbnail(s) */}
                  <div className="relative flex items-center shrink-0">
                    {firstItem && (
                      <ProductAvatar
                        imageUrl={firstItem.image_url}
                        title={firstItem.title}
                        className="size-9 rounded-lg border border-border/60 shrink-0"
                      />
                    )}
                    {secondItem && (
                      <div className="-ml-3 relative z-10">
                        <ProductAvatar
                          imageUrl={secondItem.image_url}
                          title={secondItem.title}
                          className="size-7 rounded-lg border border-background shadow-xs shrink-0"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-xs font-bold text-foreground inline-block">
                        {o.shopify_order_name || o.internal_order_number || o.id}
                      </span>
                      {itemCount > 1 && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                          📦 {itemCount} Sarees
                        </span>
                      )}
                    </div>
                    {itemCount === 1 && firstItem && (
                      <span className="text-[11px] text-muted-foreground truncate max-w-[200px] mt-0.5" title={firstItem.title}>
                        {firstItem.title}
                      </span>
                    )}
                    {itemCount > 1 && (
                      <span className="text-[11px] text-muted-foreground truncate max-w-[220px] mt-0.5" title={items.map((i: any) => i.title).join(", ")}>
                        {firstItem?.title} + {itemCount - 1} other
                      </span>
                    )}
                  </div>
                </div>
              </TableCell>

              <TableCell className="text-center">
                <ShipmentCell shipment={o.shipment} onAdd={() => onAddShipment?.(o)} />
              </TableCell>

              <TableCell className="text-center">
                <div className="flex justify-center items-center">
                  <StatusBadge status={o.financial_status || "PENDING"} dotMap={FINANCIAL_DOTS} />
                </div>
              </TableCell>

              <TableCell className="text-center">
                <span className="font-semibold tabular-nums text-foreground block">
                  ₹{Number(o.total_amount || 0).toLocaleString()}
                </span>
                {itemCount > 1 && (
                  <span className="text-[10px] text-muted-foreground block font-normal">
                    Total ({itemCount} sarees)
                  </span>
                )}
              </TableCell>

              <TableCell className="text-center text-xs tabular-nums">
                {(() => {
                  if (!o.cod_mode || o.cod_mode.toUpperCase() !== "COD") {
                    return <span className="text-muted-foreground">{o.cod_mode || "PREPAID"}</span>;
                  }
                  const total = Number(o.total_amount || 0);
                  const collectable = total > 0 ? Math.max(0, total - 300) + 50 : Number(o.cod_value || 0);
                  return (
                    <div className="flex flex-col items-center">
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        COD ₹{collectable.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-normal">
                        (₹300 adv paid)
                      </span>
                    </div>
                  );
                })()}
              </TableCell>

              <TableCell className="text-center text-xs text-muted-foreground">
                {`${o.receiver_city ?? ""} ${o.receiver_pincode ?? ""}`.trim() || "-"}
              </TableCell>

              <TableCell className="text-center text-xs text-muted-foreground font-mono">
                {(o.order_date ?? o.shopify_created_at ?? o.created_at)
                  ? new Date(o.order_date ?? o.shopify_created_at ?? o.created_at).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: true,
                    })
                  : "-"}
              </TableCell>

              <TableCell className="text-center relative">
                <div className="flex justify-center items-center gap-1">
                  {onWhatsApp && (
                    <button
                      type="button"
                      title="Send WhatsApp Alert"
                      onClick={(e) => {
                        e.stopPropagation();
                        onWhatsApp(o);
                      }}
                      className="size-7 rounded-lg flex items-center justify-center text-xs hover:bg-emerald-500/10 text-[#25D366] transition cursor-pointer"
                    >
                      💬
                    </button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === o.id ? null : o.id);
                    }}
                    className="size-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                    aria-label="Order actions"
                  >
                    <IconMoreVertical size={16} />
                  </Button>
                </div>

                {openMenuId === o.id && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                      }}
                    />
                    <div
                      className="absolute right-0 top-10 z-50 min-w-[150px] rounded-xl border border-border bg-card p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100 text-left"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuId(null);
                          onViewOrder?.(o);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                      >
                        View Order Details
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          void downloadInvoicePdf(o.id, `GST_Tax_Invoice_${(o.shopify_order_name || o.internal_order_number || o.id).replace('#', '')}.pdf`);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50 transition-colors"
                      >
                        📄 Download GST Invoice
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          if (onWhatsApp) onWhatsApp(o);
                          else onViewOrder?.(o);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-bold text-[#25D366] hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors"
                      >
                        💬 WhatsApp Alert
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuId(null);
                          onEditOrder?.(o);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                      >
                        <IconEdit size={14} className="text-primary" />
                        Edit Order
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuId(null);
                          onDeleteOrder?.(o);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors mt-0.5"
                      >
                        <IconTrash size={14} />
                        Delete Order
                      </button>
                    </div>
                  </>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
