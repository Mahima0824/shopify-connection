import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db
from app.api.auth import get_current_user
from app.models.business import Business
from app.models.user import User
from app.models.order import Order
from app.models.whatsapp_notification import WhatsAppNotification
from app.services import shipsagar_service as ss


from sqlalchemy.pool import StaticPool


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_shipment_push_triggers_whatsapp_dispatch_notification(monkeypatch, db_session):
    # Setup test business, user and order
    b = Business(id="b_wa_test", name="WhatsApp Test Store", email="store@test.com")
    db_session.add(b)
    db_session.commit()

    u = User(id="u_wa_test", business_id=b.id, name="Warehouse Admin", email="warehouse@test.com", password_hash="dummy", role="ADMIN", is_active=True)
    db_session.add(u)
    db_session.commit()

    order = Order(
        id="ord_wa_123",
        business_id=b.id,
        shopify_order_id="sh_1088",
        shopify_order_name="#1088",
        internal_order_number="INT-1088",
        receiver_name="Ananya Sharma",
        receiver_mobile="9876543210",
        receiver_city="Surat",
        receiver_pincode="395006",
        total_amount=1999.0,
        cod_mode="COD",
        cod_value=1999.0,
        financial_status="PENDING",
        operational_status="NEW",
        order_date=datetime.now(timezone.utc),
    )
    db_session.add(order)
    db_session.commit()

    # Mock get_db and get_current_user dependencies
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    user_id = str(u.id)
    business_id = str(b.id)
    role = str(u.role)

    def override_get_current_user():
        return {"user_id": user_id, "business_id": business_id, "role": role}

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    # Mock ShipSagar push call to return success
    def fake_push_shipment(tracking_no, courier_code, order):
        return {"ok": True, "message": "Booked with courier"}

    monkeypatch.setattr(ss, "is_configured", lambda: True)
    monkeypatch.setattr(ss, "push_shipment", fake_push_shipment)
    monkeypatch.setattr(ss, "record_push_verdict", lambda *args, **kwargs: None)

    client = TestClient(app)

    try:
        res = client.post(
            "/api/v1/shipments/push",
            json={
                "order_id": order.id,
                "tracking_no": "EG987654321IN",
                "courier_code": "IP",
            },
        )
        assert res.status_code == 200, res.text
        data = res.json()["data"]

        # Check shipment fields
        assert data["awb_number"] == "EG987654321IN"
        assert data["carrier_code"] == "IP"
        assert data["pushed"] is True

        # Check WhatsApp payload in shipment response
        assert "whatsapp" in data
        wa = data["whatsapp"]
        assert wa["success"] is True
        assert wa["phone_number"] == "919876543210"
        assert "wa.me/919876543210" in wa["wa_me_url"]
        assert "Ananya Sharma" in wa["message_text"]
        assert "#1088" in wa["message_text"]
        assert "EG987654321IN" in wa["message_text"]
        assert "India Post" in wa["message_text"]
        assert "Cash on Delivery" in wa["message_text"]

        # Verify DB order status was updated to DISPATCHED
        refreshed_order = db_session.query(Order).filter_by(id=order.id).first()
        assert refreshed_order.operational_status == "DISPATCHED"

        # Verify WhatsApp notification log in database
        notif = (
            db_session.query(WhatsAppNotification)
            .filter_by(order_id=order.id, notification_type="order_dispatched")
            .first()
        )
        assert notif is not None
        assert notif.phone_number == "919876543210"
        assert notif.status in ("SIMULATED", "SENT")
        assert "EG987654321IN" in notif.message_text

        # Verify WhatsApp history API returns the logged dispatch notification
        history_res = client.get(f"/api/v1/whatsapp/orders/{order.id}/history")
        assert history_res.status_code == 200
        hdata = history_res.json()["data"]
        assert hdata["customer_mobile"] == "9876543210"
        assert len(hdata["history"]) >= 1
        assert hdata["history"][0]["notification_type"] == "order_dispatched"

    finally:
        app.dependency_overrides.clear()
