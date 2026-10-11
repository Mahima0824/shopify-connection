import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.database import SessionLocal, Base, engine
from app.models.business import Business
from app.models.order import Order, OrderItem
from app.models.shipment import Shipment
from app.models.whatsapp_notification import WhatsAppNotification
from app.services import whatsapp_service

def test_whatsapp_service_flow():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        biz = db.query(Business).first()
        if not biz:
            biz = Business(name="Test Biz", email="test@biz.com")
            db.add(biz)
            db.commit()
            db.refresh(biz)

        # 1. Test Phone Number Normalization
        p1 = whatsapp_service.normalize_phone_number("9876543210")
        assert p1 == "919876543210", f"Expected 919876543210, got {p1}"

        p2 = whatsapp_service.normalize_phone_number("+91 98765 43210")
        assert p2 == "919876543210", f"Expected 919876543210, got {p2}"

        p3 = whatsapp_service.normalize_phone_number("09876543210")
        assert p3 == "919876543210", f"Expected 919876543210, got {p3}"

        print("[OK] Phone normalization tests passed!")

        # 2. Test Carrier URL Resolution
        u1 = whatsapp_service.get_carrier_tracking_url("DELHIVERY", "123456789")
        assert "delhivery.com" in u1 and "123456789" in u1

        u2 = whatsapp_service.get_carrier_tracking_url("BLUEDART", "987654321")
        assert "bluedart.com" in u2 and "987654321" in u2

        print("[OK] Tracking URL resolution tests passed!")

        # 3. Create mock order and items
        import time
        from datetime import datetime, timezone
        ts = int(time.time())
        order = Order(
            business_id=biz.id,
            internal_order_number=f"ORD-TEST-{ts}",
            shopify_order_id=f"555{ts}",
            shopify_order_name=f"#{ts}",
            order_date=datetime.now(timezone.utc),
            receiver_name="Priya Sharma",
            receiver_mobile="9876543210",
            total_amount=4999.00
        )
        db.add(order)
        db.commit()
        db.refresh(order)

        item = OrderItem(
            business_id=biz.id,
            order_id=order.id,
            title="Banarasi Pure Silk Saree",
            quantity=1,
            price=4999.00
        )
        db.add(item)
        db.commit()

        # 4. Test Order Confirmation WhatsApp
        conf_res = whatsapp_service.send_order_confirmation_whatsapp(db, order)
        assert conf_res["success"] == True
        assert "Priya Sharma" in conf_res["message_text"]
        assert "4,999.00" in conf_res["message_text"]
        assert conf_res["wa_me_url"].startswith("https://wa.me/919876543210")
        print("[OK] Order Confirmation WhatsApp message test passed!")

        # 5. Test Order Dispatch WhatsApp
        from app.services.barcode_service import ensure_parcel_for_order
        parcel = ensure_parcel_for_order(db, order.id)
        db.commit()

        shipment = Shipment(
            business_id=biz.id,
            order_id=order.id,
            parcel_id=parcel.id,
            carrier_code="DELHIVERY",
            awb_number="DELH123456789"
        )
        db.add(shipment)
        db.commit()

        disp_res = whatsapp_service.send_order_dispatched_whatsapp(db, order, shipment)
        assert disp_res["success"] == True
        assert "DELH123456789" in disp_res["message_text"]
        assert "Delhivery" in disp_res["message_text"]
        assert disp_res["wa_me_url"].startswith("https://wa.me/919876543210")
        print("[OK] Order Dispatch WhatsApp message test passed!")

        # 6. Verify database log records
        logs = db.query(WhatsAppNotification).filter(WhatsAppNotification.order_id == order.id).all()
        assert len(logs) == 2, f"Expected 2 DB log records, got {len(logs)}"
        print("[OK] DB logging test passed!")

        print("\n[SUCCESS] ALL WHATSAPP TESTS PASSED SUCCESSFULLY!")

    finally:
        db.close()

if __name__ == "__main__":
    test_whatsapp_service_flow()
