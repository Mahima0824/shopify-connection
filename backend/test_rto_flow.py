import sys
import time
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.database import SessionLocal, Base, engine
from app.models.business import Business
from app.models.order import Order, OrderItem
from app.models.shipment import Shipment
from app.models.product import Product
from app.models.parcel import Parcel
from app.api.rto import get_rto_summary, list_rto_shipments, process_rto_record, reconcile_rto_cod, RtoProcessRequest, RtoCodReconcileRequest

def test_rto_module_flow():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        biz = db.query(Business).first()
        if not biz:
            biz = Business(name="RTO Test Business", email="rto@biz.com")
            db.add(biz)
            db.commit()
            db.refresh(biz)

        ts = int(time.time())

        # 1. Create product
        prod = Product(
            business_id=biz.id,
            title="Banarasi Saree RTO Test",
            sku=f"SKU-RTO-{ts}",
            price=2999.0,
            stock_quantity=10
        )
        db.add(prod)
        db.commit()
        db.refresh(prod)

        initial_stock = prod.stock_quantity

        # 2. Create Order marked RTO
        order = Order(
            business_id=biz.id,
            internal_order_number=f"ORD-RTO-{ts}",
            shopify_order_id=f"999{ts}",
            shopify_order_name=f"#RTO-{ts}",
            order_date=datetime.now(timezone.utc),
            receiver_name="Ananya Roy",
            receiver_mobile="9876500112",
            receiver_city="Kolkata",
            receiver_pincode="700001",
            total_amount=2999.00,
            cod_mode="COD",
            cod_value=2999.00,
            operational_status="RTO"
        )
        db.add(order)
        db.commit()
        db.refresh(order)

        item = OrderItem(
            business_id=biz.id,
            order_id=order.id,
            product_id=prod.id,
            title=prod.title,
            quantity=1,
            price=2999.00
        )
        db.add(item)

        parcel = Parcel(
            id=order.id,
            business_id=biz.id,
            order_id=order.id,
            parcel_code=order.internal_order_number,
            barcode_value=order.internal_order_number
        )
        db.add(parcel)

        shipment = Shipment(
            business_id=biz.id,
            order_id=order.id,
            parcel_id=parcel.id,
            carrier_code="DELHIVERY",
            awb_number=f"DELHRTO{ts}",
            tracking_status="RTO_IN_TRANSIT"
        )
        db.add(shipment)
        db.commit()

        from app.models.user import User
        user = db.query(User).filter_by(business_id=biz.id).first()
        if not user:
            user = User(business_id=biz.id, name="RTO Tester", email="rtotester@biz.com", password_hash="hash", role="ADMIN")
            db.add(user)
            db.commit()
            db.refresh(user)

        user_mock = {"business_id": biz.id, "user_id": user.id}

        # 3. Test RTO Summary Endpoint
        summary = get_rto_summary(db=db, current_user=user_mock)
        assert summary["success"] == True
        assert summary["data"]["total_rto_orders"] >= 1
        print("[OK] RTO Summary endpoint test passed!")

        # 4. Test RTO List Shipments Endpoint
        shipment_list = list_rto_shipments(db=db, current_user=user_mock)
        assert shipment_list["success"] == True
        assert len(shipment_list["data"]["items"]) >= 1
        print("[OK] RTO List Shipments endpoint test passed!")

        # 5. Test Process RTO Record (restock inventory)
        proc_req = RtoProcessRequest(
            order_id=order.id,
            rto_reason="Customer Refused Delivery",
            item_condition="GOOD",
            restock_inventory=True,
            reverse_freight_charge=120.0,
            notes="Package in pristine condition"
        )
        proc_res = process_rto_record(payload=proc_req, db=db, current_user=user_mock)
        assert proc_res["success"] == True
        assert proc_res["data"]["operational_status"] == "RTO_DELIVERED"
        
        db.refresh(prod)
        assert prod.stock_quantity == initial_stock + 1, f"Expected stock {initial_stock + 1}, got {prod.stock_quantity}"
        print("[OK] RTO Processing & Inventory Restock test passed!")

        # 6. Test COD Reconciliation
        cod_req = RtoCodReconcileRequest(
            order_id=order.id,
            reverse_freight_charge=120.0,
            notes="COD zeroed out due to RTO"
        )
        cod_res = reconcile_rto_cod(payload=cod_req, db=db, current_user=user_mock)
        assert cod_res["success"] == True
        assert cod_res["data"]["cod_collected"] == 0.0
        print("[OK] RTO COD Reconciliation test passed!")

        print("\n[SUCCESS] ALL RTO BACKEND TESTS PASSED SUCCESSFULLY!")

    finally:
        db.close()

if __name__ == "__main__":
    test_rto_module_flow()
