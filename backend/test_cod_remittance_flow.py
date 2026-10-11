import sys
import time
import io
import csv
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.database import SessionLocal, Base, engine
from app.models.business import Business
from app.models.order import Order, OrderItem
from app.models.shipment import Shipment
from app.models.parcel import Parcel
from app.models.user import User
from app.services import cod_remittance_service

def test_cod_remittance_flow():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        biz = db.query(Business).first()
        if not biz:
            biz = Business(name="COD Remittance Test Biz", email="cod@biz.com")
            db.add(biz)
            db.commit()
            db.refresh(biz)

        user = db.query(User).filter_by(business_id=biz.id).first()
        if not user:
            user = User(business_id=biz.id, name="COD Tester", email="codtester@biz.com", password_hash="hash", role="ADMIN")
            db.add(user)
            db.commit()
            db.refresh(user)

        ts = int(time.time())

        # 1. Create Order #1 (Exact Match Expected: ₹1,999)
        o1 = Order(
            business_id=biz.id,
            internal_order_number=f"ORD-COD1-{ts}",
            shopify_order_id=f"101{ts}",
            shopify_order_name=f"#COD-101-{ts}",
            order_date=datetime.now(timezone.utc),
            receiver_name="Rahul Verma",
            receiver_mobile="9876511111",
            total_amount=1999.00,
            cod_mode="COD",
            cod_value=1999.00,
            payment_status="PENDING",
            operational_status="DELIVERED"
        )
        db.add(o1)
        db.commit()

        p1 = Parcel(id=o1.id, business_id=biz.id, order_id=o1.id, parcel_code=o1.internal_order_number, barcode_value=o1.internal_order_number)
        db.add(p1)
        db.commit()

        s1 = Shipment(business_id=biz.id, order_id=o1.id, parcel_id=p1.id, carrier_code="DELHIVERY", awb_number=f"DELHCOD1{ts}", tracking_status="DELIVERED")
        db.add(s1)
        db.commit()

        # 2. Create Order #2 (Short Remittance Expected: ₹2,499)
        o2 = Order(
            business_id=biz.id,
            internal_order_number=f"ORD-COD2-{ts}",
            shopify_order_id=f"102{ts}",
            shopify_order_name=f"#COD-102-{ts}",
            order_date=datetime.now(timezone.utc),
            receiver_name="Sanjay Kapoor",
            receiver_mobile="9876522222",
            total_amount=2499.00,
            cod_mode="COD",
            cod_value=2499.00,
            payment_status="PENDING",
            operational_status="DELIVERED"
        )
        db.add(o2)
        db.commit()

        p2 = Parcel(id=o2.id, business_id=biz.id, order_id=o2.id, parcel_code=o2.internal_order_number, barcode_value=o2.internal_order_number)
        db.add(p2)
        db.commit()

        s2 = Shipment(business_id=biz.id, order_id=o2.id, parcel_id=p2.id, carrier_code="DELHIVERY", awb_number=f"DELHCOD2{ts}", tracking_status="DELIVERED")
        db.add(s2)
        db.commit()

        # 3. Test Summary API function
        summary = cod_remittance_service.get_cod_remittance_summary(db, biz.id)
        assert summary["total_cod_orders"] >= 2
        print("[OK] COD Remittance KPI Summary test passed!")

        # 4. Generate Mock Courier COD Remittance CSV File
        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)
        writer.writerow(["AWB Number", "Order Number", "Gross Amount", "Fee Amount", "Net Remittance", "UTR Number", "Transaction Date"])
        writer.writerow([s1.awb_number, o1.shopify_order_name, "1999.00", "50.00", "1949.00", f"UTR{ts}01", "2026-10-10"])
        writer.writerow([s2.awb_number, o2.shopify_order_name, "2000.00", "50.00", "1950.00", f"UTR{ts}02", "2026-10-10"])  # Short remittance (2000 vs 2499)

        csv_bytes = csv_buffer.getvalue().encode("utf-8")

        # 5. Test File Processing & Automated Matching
        proc_res = cod_remittance_service.process_cod_remittance_file(
            db=db,
            business_id=biz.id,
            user_id=user.id,
            content=csv_bytes,
            filename="delhivery_cod_remittance_test.csv"
        )

        print("proc_res:", proc_res)
        assert proc_res["success"] == True
        assert proc_res["matched_count"] >= 1
        assert proc_res["short_count"] >= 1
        print("[OK] COD Remittance CSV automated 4-level matching test passed!")

        # 6. Test Discrepancy Resolution (ACCEPT_SHORT)
        res_res = cod_remittance_service.resolve_cod_discrepancy(
            db=db,
            business_id=biz.id,
            user_id=user.id,
            order_id=o2.id,
            action="ACCEPT_SHORT",
            write_off_amount=499.00,
            notes="Shortfall accepted per courier settlement policy"
        )
        assert res_res["success"] == True
        assert res_res["data"]["status"] == "COD_SHORT_SETTLED"
        print("[OK] Discrepancy resolution test passed!")

        print("\n[SUCCESS] ALL COD REMITTANCE TESTS PASSED SUCCESSFULLY!")

    finally:
        db.close()

if __name__ == "__main__":
    test_cod_remittance_flow()
