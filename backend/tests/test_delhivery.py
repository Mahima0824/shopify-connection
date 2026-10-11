import pytest
from app.carriers.registry import get_provider
from app.carriers.shipsagar import ShipsagarProvider
from app.carriers.base import CarrierError
from app.services import shipsagar_service as ss


def test_delhivery_routes_through_shipsagar():
    provider = get_provider("DELHIVERY")
    assert isinstance(provider, ShipsagarProvider)
    assert provider.courier == "DELHIVERY"
    assert "TRACKING" in provider.capabilities()


def test_delhivery_unconnected_raises_error(monkeypatch):
    monkeypatch.setattr(ss, "is_configured", lambda: False)
    provider = get_provider("DELHIVERY")
    with pytest.raises(CarrierError) as exc_info:
        provider.get_tracking("123456789")
    assert exc_info.value.code == "CARRIER_NOT_CONNECTED"
