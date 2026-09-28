# backend/tests/test_timeline.py
def test_timeline_ordered():
    from app.services.timeline_service import build_timeline
    import app.models.return_record  # noqa
    from test_returns import _mk
    from app.services.return_service import record_return
    db, b, u, o, i, p = _mk()
    record_return(db, b.id, p.barcode_value, u.id, "CUSTOMER_RETURN", "GOOD")
    tl = build_timeline(db, b.id, o.id)
    kinds = [n["kind"] for n in tl]
    assert kinds[0] == "CREATED"
    assert "DISPATCHED" in kinds and "RETURN" in kinds
    assert kinds.index("DISPATCHED") < kinds.index("RETURN")
    assert any(n["kind"] == "AUDIT" for n in tl)
