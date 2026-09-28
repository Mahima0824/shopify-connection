# backend/tests/test_barcode_format.py
def test_normalize_and_validate():
    from app.services.barcode_service import normalize_barcode, validate_barcode_format
    assert normalize_barcode("  p00000001 ") == "P00000001"
    assert validate_barcode_format("P00000001")
    assert validate_barcode_format("PKG-0000000001")
    assert not validate_barcode_format("P123")
    assert not validate_barcode_format("PKG-123")
    assert not validate_barcode_format("")


def test_parcel_items_synced():
    from test_returns import _mk
    from app.models.parcel_item import ParcelItem
    db, b, u, o, i, p = _mk()  # 1 item qty 3
    rows = db.query(ParcelItem).filter_by(parcel_id=p.id).all()
    assert len(rows) == 1 and rows[0].quantity == 3 and rows[0].order_item_id == i.id
