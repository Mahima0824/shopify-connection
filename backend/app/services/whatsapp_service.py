import logging
import re
import urllib.parse
import urllib.request
import json
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

from app.config import settings
from app.models.order import Order, OrderItem
from app.models.shipment import Shipment
from app.models.whatsapp_notification import WhatsAppNotification

logger = logging.getLogger("app.services.whatsapp_service")


def normalize_phone_number(raw_phone: Optional[str]) -> Optional[str]:
    """Normalize phone number to international E.164 format without leading '+' (e.g. 919876543210).

    Default to India (+91) if 10-digit number is provided.
    """
    if not raw_phone:
        return None

    # Strip all non-digit characters
    digits = re.sub(r"\D", "", str(raw_phone))
    if not digits:
        return None

    # Strip leading zeros
    digits = digits.lstrip("0")

    # If 10 digits, assume India (+91)
    if len(digits) == 10:
        return f"91{digits}"
    # If 12 digits starting with 91, return as is
    elif len(digits) == 12 and digits.startswith("91"):
        return digits

    return digits


def get_carrier_display_name(carrier_code: Optional[str]) -> str:
    """Format courier code into clean, recognizable brand name."""
    if not carrier_code:
        return "Courier Partner"
    code = str(carrier_code).strip().upper()
    if code in ("IP", "INDIA_POST", "SPEED_POST"):
        return "India Post (Speed Post)"
    elif "DELHIVERY" in code or code == "DL":
        return "Delhivery"
    elif "DTDC" in code:
        return "DTDC Express"
    elif "BLUEDART" in code or code == "BD":
        return "Blue Dart Express"
    return code.replace("_", " ").title()


def get_carrier_tracking_url(
    carrier_code: Optional[str],
    awb_number: Optional[str],
    raw_tracking_url: Optional[str] = None
) -> str:
    """Generate or clean a valid tracking URL for the customer notification."""
    if raw_tracking_url and raw_tracking_url.startswith("http") and "example" not in raw_tracking_url:
        return raw_tracking_url

    awb = (awb_number or "").strip()
    if not awb:
        return "https://track.delhivery.com"

    code = (carrier_code or "").upper()
    if "DELHIVERY" in code or code == "DL":
        return f"https://www.delhivery.com/track/package/{awb}"
    elif "INDIA_POST" in code or code == "IP":
        return f"https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx"
    elif "DTDC" in code:
        return f"https://www.dtdc.in/tracking/tracking_results.asp?Tmode=3&strTrackNo={awb}"
    elif "BLUEDART" in code or code == "BD":
        return f"https://www.bluedart.com/tracking?id={awb}"

    return f"https://www.delhivery.com/track/package/{awb}"


def build_order_confirmation_message(order: Order, items: List[OrderItem]) -> str:
    """Build WhatsApp order confirmation message."""
    customer_name = getattr(order, "receiver_name", None) or "Valued Customer"
    order_name = order.shopify_order_name or order.internal_order_number or f"#{order.id[:8]}"
    
    item_titles = []
    for item in items:
        qty_str = f" (x{item.quantity})" if item.quantity > 1 else ""
        item_titles.append(f"• {item.title}{qty_str}")
    
    items_summary = "\n".join(item_titles) if item_titles else "• Ordered items"

    formatted_amount = f"{float(order.total_amount):,.2f}"

    return (
        f"🛍️ *Order Confirmed!*\n\n"
        f"Hi {customer_name},\n"
        f"Thank you for your order *{order_name}*!\n\n"
        f"💰 *Total Amount:* ₹{formatted_amount}\n"
        f"📦 *Items:* \n{items_summary}\n\n"
        f"We are preparing your package and will notify you as soon as it is dispatched with tracking details! 🚀"
    )


def build_order_dispatched_message(
    order: Order,
    shipment: Optional[Shipment] = None,
    carrier_name: Optional[str] = None,
    awb_number: Optional[str] = None,
    tracking_url: Optional[str] = None
) -> str:
    """Build WhatsApp order dispatch & tracking notification message."""
    customer_name = getattr(order, "receiver_name", None) or "Valued Customer"
    order_name = order.shopify_order_name or order.internal_order_number or f"#{order.id[:8]}"

    raw_carrier = carrier_name or (shipment.carrier_code if shipment else None) or "Courier Service"
    carrier_display = get_carrier_display_name(raw_carrier)

    awb = awb_number or (shipment.awb_number if shipment else None) or "N/A"
    
    raw_url = tracking_url or (shipment.tracking_url if shipment else None)
    resolved_url = get_carrier_tracking_url(raw_carrier, awb, raw_url)

    payment_info = ""
    cod_mode = (getattr(order, "cod_mode", "") or "PREPAID").upper()
    total_amt = float(getattr(order, "total_amount", 0) or 0)
    if cod_mode == "COD":
        payment_info = f"💰 *Payment Mode:* Cash on Delivery (₹{total_amt:,.2f})\n"
    else:
        payment_info = f"💳 *Payment Mode:* Prepaid\n"

    return (
        f"📦 *Order Dispatched!*\n\n"
        f"Hi {customer_name},\n"
        f"Great news! Your order *{order_name}* has been shipped and is on its way. 🚀\n\n"
        f"🚚 *Courier Partner:* {carrier_display}\n"
        f"📍 *Tracking ID (AWB):* {awb}\n"
        f"🔗 *Live Tracking Link:* {resolved_url}\n"
        f"{payment_info}\n"
        f"You can track your package anytime using the link above.\n"
        f"Thank you for shopping with us! 🙏"
    )


def send_whatsapp_notification(
    db: Session,
    business_id: str,
    phone_number: str,
    message_text: str,
    notification_type: str,
    order_id: Optional[str] = None,
    shipment_id: Optional[str] = None
) -> Dict[str, Any]:
    """Send WhatsApp notification via Meta Business Cloud API or generate fallback deep link."""
    normalized_phone = normalize_phone_number(phone_number)
    
    if not normalized_phone:
        logger.warning(f"Cannot send WhatsApp notification: invalid phone number {phone_number!r}")
        return {
            "success": False,
            "error": "Invalid or missing customer mobile number",
            "wa_me_url": None
        }

    # Pre-filled WhatsApp web/app link for fallback or instant 1-click dispatch
    encoded_text = urllib.parse.quote(message_text)
    wa_me_url = f"https://wa.me/{normalized_phone}?text={encoded_text}"

    phone_number_id = settings.whatsapp_phone_number_id
    access_token = settings.whatsapp_access_token

    provider_msg_id = None
    status = "SIMULATED"
    error_msg = None

    if settings.whatsapp_enabled and phone_number_id and access_token:
        # Send via Meta WhatsApp Business Cloud API
        meta_url = f"https://graph.facebook.com/v20.0/{phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": normalized_phone,
            "type": "text",
            "text": {
                "preview_url": True,
                "body": message_text
            }
        }
        
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        try:
            req = urllib.request.Request(
                meta_url,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                resp_data = json.loads(response.read().decode("utf-8"))
                if "messages" in resp_data and len(resp_data["messages"]) > 0:
                    provider_msg_id = resp_data["messages"][0].get("id")
                    status = "SENT"
                    logger.info(f"WhatsApp message sent to {normalized_phone} via Meta API (ID: {provider_msg_id})")
                else:
                    status = "FAILED"
                    error_msg = f"Unexpected Meta API response: {json.dumps(resp_data)}"
        except Exception as e:
            status = "FAILED"
            error_msg = f"Meta WhatsApp API call error: {str(e)}"
            logger.error(f"Failed to send Meta WhatsApp message to {normalized_phone}: {e}")
    else:
        error_msg = "Meta WhatsApp credentials (phone_number_id / access_token) not configured. Using simulated wa.me fallback."
        logger.info(f"Simulated WhatsApp alert recorded for {normalized_phone}. wa.me link: {wa_me_url}")

    # Record notification log in Database
    notif_log = WhatsAppNotification(
        business_id=business_id,
        order_id=order_id,
        shipment_id=shipment_id,
        phone_number=normalized_phone,
        notification_type=notification_type,
        message_text=message_text,
        status=status,
        provider_message_id=provider_msg_id,
        error_message=error_msg
    )
    db.add(notif_log)
    db.commit()
    db.refresh(notif_log)

    return {
        "success": True,
        "notification_id": notif_log.id,
        "status": status,
        "phone_number": normalized_phone,
        "wa_me_url": wa_me_url,
        "message_text": message_text,
        "error_message": error_msg
    }


def send_order_confirmation_whatsapp(db: Session, order: Order) -> Dict[str, Any]:
    """Helper to send WhatsApp confirmation for an order."""
    if not order or not getattr(order, "receiver_mobile", None):
        return {"success": False, "error": "Order has no customer mobile number"}

    items = db.query(OrderItem).filter(OrderItem.order_id == order.id).all()
    message = build_order_confirmation_message(order, items)
    
    return send_whatsapp_notification(
        db=db,
        business_id=order.business_id,
        phone_number=order.receiver_mobile,
        message_text=message,
        notification_type="order_confirmation",
        order_id=order.id
    )


def send_order_dispatched_whatsapp(
    db: Session,
    order: Order,
    shipment: Optional[Shipment] = None,
    carrier_name: Optional[str] = None,
    awb_number: Optional[str] = None,
    tracking_url: Optional[str] = None
) -> Dict[str, Any]:
    """Helper to send WhatsApp dispatch & tracking alert for an order."""
    if not order or not getattr(order, "receiver_mobile", None):
        return {"success": False, "error": "Order has no customer mobile number"}

    message = build_order_dispatched_message(
        order=order,
        shipment=shipment,
        carrier_name=carrier_name,
        awb_number=awb_number,
        tracking_url=tracking_url
    )

    shipment_id = shipment.id if shipment else None

    return send_whatsapp_notification(
        db=db,
        business_id=order.business_id,
        phone_number=order.receiver_mobile,
        message_text=message,
        notification_type="order_dispatched",
        order_id=order.id,
        shipment_id=shipment_id
    )
