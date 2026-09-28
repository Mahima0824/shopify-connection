# backend/tests/test_concurrency.py
"""Task 5: concurrent double-scan yields exactly one DISPATCHED event.

Note: SQLite ignores SELECT ... FOR UPDATE, so the row-lock guard in
``dispatch_parcel`` only takes effect on Postgres (production). On SQLite
each thread gets its own connection (file-backed DB); the in-transaction
``prior = count(DISPATCHED)`` service-level check is what serialises the
common case here. Postgres ``FOR UPDATE`` is the production guard — see
README "Sprint 2 — Dispatch".
"""
from __future__ import annotations

import os
import tempfile
import threading

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
import app.models.business, app.models.user, app.models.order, app.models.parcel, app.models.scan_event  # noqa: F401


def _setup():
    from datetime import datetime, timezone
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.services.auth_service import hash_password
    from app.services.barcode_service import ensure_parcel_for_order
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 30})
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in"); db.add(b); db.commit(); db.refresh(b)
    u = User(business_id=b.id, name="W", email="w@t.in", password_hash=hash_password("x"), role="WAREHOUSE")
    db.add(u); db.commit(); db.refresh(u)
    o = Order(business_id=b.id, internal_order_number="ORD-9", shopify_order_id="gid://9",
              shopify_order_name="#9", currency="INR", subtotal_amount=10.0, discount_amount=0.0,
              shipping_amount=0.0, tax_amount=0.0, total_amount=10.0, payment_status="PAID",
              financial_status="PAID", fulfillment_status="UNFULFILLED", operational_status="NEW",
              order_date=datetime.now(timezone.utc))
    db.add(o); db.commit(); db.refresh(o)
    p = ensure_parcel_for_order(db, o.id)
    ids = (b.id, u.id, o.id, p.id, p.barcode_value)
    db.close()
    return eng, path, ids


def test_concurrent_double_scan_single_win():
    from app.services.scanning_service import dispatch_parcel, ScanError
    eng, path, (b_id, u_id, o_id, p_id, barcode) = _setup()
    try:
        results = []
        barrier = threading.Barrier(2)

        def worker():
            db = sessionmaker(bind=eng)()
            try:
                barrier.wait(timeout=10)
                dispatch_parcel(db, b_id, barcode, u_id)
                results.append("ok")
            except ScanError as e:
                results.append(e.code)
            except Exception as e:  # noqa: BLE001 — sqlite lock contention under threads
                results.append(f"CONTENTION:{type(e).__name__}")
            finally:
                db.close()

        ts = [threading.Thread(target=worker) for _ in range(2)]
        [t.start() for t in ts]; [t.join() for t in ts]
        # Exactly one winner; the loser must be rejected (duplicate guard) or
        # fail on sqlite write contention (Postgres FOR UPDATE serialises this).
        assert results.count("ok") == 1, results
        assert len(results) == 2, results
        loser = [r for r in results if r != "ok"][0]
        assert loser == "PARCEL_ALREADY_DISPATCHED" or loser.startswith("CONTENTION:"), results
        db = sessionmaker(bind=eng)()
        try:
            from app.models.scan_event import ScanEvent
            assert db.query(ScanEvent).filter_by(parcel_id=p_id, event_type="DISPATCHED").count() == 1
        finally:
            db.close()
    finally:
        eng.dispose()
        try:
            os.unlink(path)
        except OSError:
            pass
