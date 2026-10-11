from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database import Base
from app.models.business import Business
from app.models.order import Order, OrderItem
from app.services.invoice_service import generate_gst_invoice_pdf, number_to_words_indian


def test_number_to_words_indian():
    assert "Two Thousand Four Hundred Ninety Nine Only" in number_to_words_indian(2499.00)
    assert "One Thousand Five Hundred" in number_to_words_indian(1500.50)


def test_generate_gst_invoice_pdf():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = TestingSession()

    try:
        b = Business(name="Test Saree Store", email="test@store.com", gstin="24AAACR1234A1Z5", state_code="24")
        db.add(b)
        db.commit()
        db.refresh(b)

        o = Order(
            business_id=b.id,
            internal_order_number="ORD-TEST-101",
            shopify_order_id="1001",
            shopify_order_name="#1001",
            order_date=datetime.now(timezone.utc),
            total_amount=2500.0,
            receiver_name="Priya Sharma",
            receiver_add1="MG Road",
            receiver_city="Surat",
            receiver_state="Gujarat",
            receiver_pincode="395002",
            receiver_mobile="9876543210",
            financial_status="PAID",
            cod_mode="PREPAID",
        )
        db.add(o)
        db.commit()
        db.refresh(o)

        it = OrderItem(
            business_id=b.id,
            order_id=o.id,
            title="Red Silk Saree",
            hsn_code="5007",
            quantity=1,
            price=2500.0,
            gst_rate=5.0,
        )
        db.add(it)
        db.commit()

        pdf_bytes = generate_gst_invoice_pdf(db, b.id, o.id)
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 1000
        assert pdf_bytes.startswith(b"%PDF")
    finally:
        db.close()
