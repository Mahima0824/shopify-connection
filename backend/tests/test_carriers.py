# backend/tests/test_carriers.py
def test_normalize_unknown():
    from app.carriers.registry import normalize_status
    assert normalize_status("DTDC", "Arrived at Ahmedabad DC") in ("AT_HUB", "UNKNOWN")


def test_stubs_raise_not_connected():
    from app.carriers.registry import get_provider
    from app.carriers.base import CarrierError
    import pytest
    with pytest.raises(CarrierError) as e:
        get_provider("DTDC").get_tracking("D1")
    assert e.value.code == "CARRIER_NOT_CONNECTED"


def test_manual_capabilities():
    from app.carriers.registry import get_provider
    assert "TRACKING" in get_provider("MANUAL").capabilities()
