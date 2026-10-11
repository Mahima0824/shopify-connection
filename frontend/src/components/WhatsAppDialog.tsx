import React, { useState, useEffect } from "react";
import { Button, Card, Badge } from "./primitives";
import { getWhatsAppHistory, sendWhatsAppAlert } from "../lib/api";
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconExternalLink,
  IconMessage,
  IconPackage,
  IconPhone,
  IconPlay,
  IconTruck,
} from "./icons";

interface WhatsAppDialogProps {
  open: boolean;
  order: any | null;
  onClose: () => void;
}

export default function WhatsAppDialog({ open, order, onClose }: WhatsAppDialogProps) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [data, setData] = useState<{
    customer_mobile: string | null;
    normalized_phone: string | null;
    quick_wa_me_url: string | null;
    dispatch_preview: string;
    history: Array<any>;
  } | null>(null);
  const [selectedType, setSelectedType] = useState<"order_dispatched" | "order_confirmation">("order_dispatched");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const loadHistory = async () => {
    if (!order) return;
    setLoading(true);
    setFeedback(null);
    try {
      const res = await getWhatsAppHistory(order.id);
      setData(res);
    } catch (err: any) {
      console.error("Failed to load WhatsApp history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && order) {
      loadHistory();
    }
  }, [open, order]);

  if (!open || !order) return null;

  const handleSendApi = async () => {
    setSending(true);
    setFeedback(null);
    try {
      const res = await sendWhatsAppAlert(order.id, selectedType);
      setFeedback({
        type: "success",
        msg: `WhatsApp ${selectedType === "order_dispatched" ? "Tracking & Dispatch" : "Confirmation"} notification processed (${res.data.status})!`,
      });
      await loadHistory();
    } catch (err: any) {
      setFeedback({
        type: "error",
        msg: err.message || "Failed to send WhatsApp alert",
      });
    } finally {
      setSending(false);
    }
  };

  const orderName = order.shopify_order_name || order.internal_order_number || order.id;
  const customerMobile = order.receiver_mobile || data?.customer_mobile;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-emerald-500/30 bg-card text-card-foreground shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 sm:px-6 py-3 sm:py-4 bg-emerald-950/40 text-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#25D366] flex items-center justify-center text-white text-lg font-bold shadow-md shrink-0">
              <IconMessage size={18} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-medium flex items-center gap-2 text-white">
                WhatsApp Order Notification
              </h2>
              <p className="text-xs text-emerald-200 font-mono flex items-center gap-1">
                <span>Order {orderName}</span>
                <span>•</span>
                {customerMobile ? (
                  <span className="flex items-center gap-1">
                    <IconPhone size={11} className="inline" />
                    <span>{customerMobile}</span>
                  </span>
                ) : (
                  <span>No Mobile Provided</span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-emerald-300 hover:bg-emerald-800/50 hover:text-white transition-colors"
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {feedback && (
            <div
              className={`p-3 rounded-xl text-xs font-medium border flex items-center gap-2 ${
                feedback.type === "success"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
              }`}
            >
              <span>{feedback.type === "success" ? <IconCheck size={14} /> : <IconAlert size={14} />}</span>
              <span>{feedback.msg}</span>
            </div>
          )}

          {/* Type Selector */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-1 bg-muted rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setSelectedType("order_dispatched")}
              className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                selectedType === "order_dispatched"
                  ? "bg-[#25D366] text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <IconTruck size={14} />
              <span>Order Dispatch & Tracking Alert</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedType("order_confirmation")}
              className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                selectedType === "order_confirmation"
                  ? "bg-[#25D366] text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <IconPackage size={14} />
              <span>Order Confirmation Alert</span>
            </button>
          </div>

          {/* Live Message Preview (WhatsApp Chat Bubble style) */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 dark:bg-emerald-950/40 p-4">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">
              <span>Message Preview</span>
              <span className="text-[11px] font-normal text-muted-foreground">Automated WhatsApp Template</span>
            </div>
            
            <div className="bg-[#0b141a] text-[#e9edef] rounded-xl p-4 font-sans text-xs sm:text-sm whitespace-pre-wrap leading-relaxed border border-[#233138] shadow-inner relative">
              <div className="absolute top-2 right-2 text-[10px] text-[#8696a0] font-mono flex items-center gap-1">
                <span>14:07</span>
                <span className="text-[#53bdeb] text-xs font-bold leading-none">✓✓</span>
              </div>
              {selectedType === "order_dispatched" ? (
                data?.dispatch_preview || (
                  `📦 *Order Dispatched!*\n\nHi ${order.receiver_name || "Valued Customer"},\nYour order *${orderName}* has been shipped!\n\n🚚 *Carrier:* ${order.shipment?.carrier_code || "Courier Service"}\n📍 *Tracking ID:* ${order.shipment?.awb_number || "Awaiting"}\n🔗 *Track Package:* https://www.delhivery.com/track/package/${order.shipment?.awb_number || ""}\n\nThank you for shopping with us! 🙏`
                )
              ) : (
                `🛍️ *Order Confirmed!*\n\nHi ${order.receiver_name || "Valued Customer"},\nThank you for your order *${orderName}*!\n\n💰 *Total Amount:* ₹${Number(order.total_amount || 0).toLocaleString()}\n\nWe are preparing your package and will send tracking details upon dispatch! 🚀`
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Meta Cloud API Auto-Send */}
            <Button
              type="button"
              disabled={sending || !customerMobile}
              onClick={handleSendApi}
              className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-xs h-9 flex items-center justify-center gap-2 shadow-md"
            >
              {sending ? (
                <span>Sending...</span>
              ) : (
                <>
                  <IconPlay size={14} />
                  <span>Send via Meta Cloud API</span>
                </>
              )}
            </Button>

            {/* wa.me Deep Link */}
            <a
              href={data?.quick_wa_me_url || `https://wa.me/${data?.normalized_phone || ""}`}
              target="_blank"
              rel="noreferrer"
              className={`w-full h-9 px-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold text-xs flex items-center justify-center gap-2 transition text-center ${
                !data?.normalized_phone ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <IconExternalLink size={14} />
              <span>Open in WhatsApp Web / App</span>
            </a>
          </div>

          {/* Log History */}
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 flex items-center justify-between">
              <span>Notification History</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {data?.history?.length || 0} alerts logged
              </span>
            </h4>

            {loading ? (
              <div className="text-center py-6 text-xs text-muted-foreground">Loading history...</div>
            ) : !data?.history || data.history.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                No WhatsApp notifications sent yet for this order. Click above to send one!
              </div>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {data.history.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl border border-border bg-muted/20 text-xs flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        <span className="capitalize">{log.notification_type.replace("_", " ")}</span>
                        <Badge
                          variant={
                            log.status === "SENT"
                              ? "default"
                              : log.status === "SIMULATED"
                              ? "secondary"
                              : "destructive"
                          }
                          className="text-[10px] px-2 py-0"
                        >
                          {log.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {log.created_at ? new Date(log.created_at).toLocaleString("en-IN") : ""} • To: +{log.phone_number}
                      </p>
                    </div>

                    {log.wa_me_url && (
                      <a
                        href={log.wa_me_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-bold text-[#25D366] hover:underline"
                      >
                        Resend
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 bg-muted/20 flex justify-end">
          <Button type="button" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

      </div>
    </div>
  );
}
