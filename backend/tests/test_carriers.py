# backend/tests/test_carriers.py
import pytest
from app.services import shipsagar_service as ss


def test_normalize_unknown():
    from app.carriers.registry import normalize_status
    assert normalize_status("DTDC", "Manifested at origin") in ("READY_TO_SHIP", "BOOKED", "UNKNOWN")


def test_stubs_raise_not_connected(monkeypatch):
    monkeypatch.setattr(ss, "is_configured", lambda: False)
    from app.carriers.registry import get_provider
    from app.carriers.base import CarrierError
    with pytest.raises(CarrierError) as e:
        get_provider("DTDC").get_tracking("D1")
    assert e.value.code == "CARRIER_NOT_CONNECTED"


def test_manual_capabilities():
    from app.carriers.registry import get_provider
    assert "TRACKING" in get_provider("MANUAL").capabilities()
