# backend/app/services/export_service.py
import io
import csv
from sqlalchemy.orm import Session
from app.models.order import Order
from app.models.parcel import Parcel
from app.models.scan_event import ScanEvent
from app.models.return_record import ReturnRecord
from app.models.reconciliation import Reconciliation

def generate_excel_workbook(db: Session, business_id: str) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    
    # 1. SUMMARY
    writer.writerow(["=== SECTION: SUMMARY ==="])
    writer.writerow(["Generated At", "Business ID"])
    writer.writerow(["Now", business_id])
    writer.writerow([])
    
    # 2. ORDERS
    writer.writerow(["=== SECTION: ORDERS ==="])
    writer.writerow(["Order Name", "Financial Status", "Operational Status", "Subtotal", "Tax", "Shipping", "Total Amount", "Currency", "Created At"])
    orders = db.query(Order).filter_by(business_id=business_id).all()
    for o in orders:
        writer.writerow([
            o.shopify_order_name,
            o.financial_status,
            o.operational_status,
            o.subtotal_amount,
            o.tax_amount,
            o.shipping_amount,
            o.total_amount,
            o.currency,
            str(o.created_at)
        ])
    writer.writerow([])
    
    # 3. SCANS & PARCELS
    writer.writerow(["=== SECTION: SCANS ==="])
    writer.writerow(["Parcel ID", "Order ID", "Event Type", "Performed By", "Created At"])
    scans = db.query(ScanEvent).filter_by(business_id=business_id).all()
    for s in scans:
        writer.writerow([s.parcel_id, s.order_id, s.event_type, s.performed_by, str(s.created_at)])
    writer.writerow([])
    
    # 4. RETURNS
    writer.writerow(["=== SECTION: RETURNS ==="])
    writer.writerow(["Return ID", "Order ID", "Parcel ID", "Return Type", "Status", "Created At"])
    returns = db.query(ReturnRecord).filter_by(business_id=business_id).all()
    for ret in returns:
        writer.writerow([ret.id, ret.order_id, ret.parcel_id, ret.return_type, ret.status, str(ret.created_at)])
    writer.writerow([])
    
    # 5. RECONCILIATIONS
    writer.writerow(["=== SECTION: RECONCILIATIONS ==="])
    writer.writerow(["Order ID", "Issue Code", "Severity", "Resolved", "Issue Message"])
    recons = db.query(Reconciliation).filter_by(business_id=business_id).all()
    for r in recons:
        writer.writerow([r.order_id, r.issue_code, r.severity, r.resolved, r.issue_message])
        
    return output.getvalue().encode("utf-8")
