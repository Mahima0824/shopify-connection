from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models.order import Order
from app.models.shipment import Shipment
from app.models.whatsapp_notification import WhatsAppNotification
from app.services import whatsapp_service

router = APIRouter(prefix="/api/v1/whatsapp", tags=["whatsapp"])


class WhatsAppSendRequest(BaseModel):
    notification_type: str = "order_dispatched"  # 'order_confirmation' or 'order_dispatched'
    custom_message: Optional[str] = None
    carrier_name: Optional[str] = None
    awb_number: Optional[str] = None
    tracking_url: Optional[str] = None


class WhatsAppConfigUpdate(BaseModel):
    whatsapp_enabled: Optional[bool] = None
    whatsapp_phone_number_id: Optional[str] = None
    whatsapp_access_token: Optional[str] = None
    whatsapp_business_account_id: Optional[str] = None


@router.get("/config")
def get_whatsapp_config(current_user=Depends(get_current_user)):
    """Return WhatsApp Business API configuration status."""
    return {
        "success": True,
        "data": {
            "whatsapp_enabled": settings.whatsapp_enabled,
            "whatsapp_phone_number_id": settings.whatsapp_phone_number_id,
            "whatsapp_business_account_id": settings.whatsapp_business_account_id,
            "is_configured": bool(settings.whatsapp_phone_number_id and settings.whatsapp_access_token),
            "access_token_set": bool(settings.whatsapp_access_token),
        }
    }


@router.post("/config")
def update_whatsapp_config(payload: WhatsAppConfigUpdate, current_user=Depends(get_current_user)):
    """Update WhatsApp Business API settings at runtime."""
    if payload.whatsapp_enabled is not None:
        settings.whatsapp_enabled = payload.whatsapp_enabled
    if payload.whatsapp_phone_number_id is not None:
        settings.whatsapp_phone_number_id = payload.whatsapp_phone_number_id
    if payload.whatsapp_access_token is not None:
        settings.whatsapp_access_token = payload.whatsapp_access_token
    if payload.whatsapp_business_account_id is not None:
        settings.whatsapp_business_account_id = payload.whatsapp_business_account_id

    return {
        "success": True,
        "message": "WhatsApp configuration updated successfully",
        "data": {
            "whatsapp_enabled": settings.whatsapp_enabled,
            "whatsapp_phone_number_id": settings.whatsapp_phone_number_id,
            "whatsapp_business_account_id": settings.whatsapp_business_account_id,
            "is_configured": bool(settings.whatsapp_phone_number_id and settings.whatsapp_access_token),
        }
    }


@router.get("/orders/{order_id}/history")
def get_order_whatsapp_history(
    order_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Get all WhatsApp notification history for a specific order."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    logs = (
        db.query(WhatsAppNotification)
        .filter(WhatsAppNotification.order_id == order_id)
        .order_by(WhatsAppNotification.created_at.desc())
        .all()
    )

    normalized_phone = whatsapp_service.normalize_phone_number(order.receiver_mobile)
    
    # Pre-generate fresh wa.me links for existing messages
    result_logs = []
    for log in logs:
        encoded_text = whatsapp_service.urllib.parse.quote(log.message_text or "")
        wa_me_url = f"https://wa.me/{log.phone_number}?text={encoded_text}" if log.phone_number else None
        result_logs.append({
            "id": log.id,
            "notification_type": log.notification_type,
            "phone_number": log.phone_number,
            "message_text": log.message_text,
            "status": log.status,
            "provider_message_id": log.provider_message_id,
            "error_message": log.error_message,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "wa_me_url": wa_me_url
        })

    # Generate preview message for dispatch if customer mobile exists
    shipment = db.query(Shipment).filter(Shipment.order_id == order_id).first()
    dispatch_preview = whatsapp_service.build_order_dispatched_message(order, shipment)
    encoded_preview = whatsapp_service.urllib.parse.quote(dispatch_preview)
    quick_wa_me_url = f"https://wa.me/{normalized_phone}?text={encoded_preview}" if normalized_phone else None

    return {
        "success": True,
        "data": {
            "order_id": order_id,
            "customer_mobile": order.receiver_mobile,
            "normalized_phone": normalized_phone,
            "quick_wa_me_url": quick_wa_me_url,
            "dispatch_preview": dispatch_preview,
            "history": result_logs
        }
    }


@router.post("/orders/{order_id}/send")
def send_order_whatsapp(
    order_id: str,
    payload: WhatsAppSendRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Trigger WhatsApp order confirmation or tracking notification manually."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if not order.receiver_mobile:
        raise HTTPException(status_code=400, detail="Order has no customer mobile number configured")

    if payload.notification_type == "order_confirmation":
        res = whatsapp_service.send_order_confirmation_whatsapp(db, order)
    else:
        shipment = db.query(Shipment).filter(Shipment.order_id == order_id).first()
        res = whatsapp_service.send_order_dispatched_whatsapp(
            db=db,
            order=order,
            shipment=shipment,
            carrier_name=payload.carrier_name,
            awb_number=payload.awb_number,
            tracking_url=payload.tracking_url
        )

    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to send WhatsApp notification"))

    return {
        "success": True,
        "message": f"WhatsApp {payload.notification_type} processed successfully",
        "data": res
    }
