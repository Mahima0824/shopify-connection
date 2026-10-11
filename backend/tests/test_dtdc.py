import pytest
from app.carriers.registry import get_provider
from app.carriers.shipsagar import ShipsagarProvider
from app.carriers.base import CarrierError
from app.services import shipsagar_service as ss


def test_dtdc_routes_through_shipsagar():
    provider = get_provider("DTDC")
    assert isinstance(provider, ShipsagarProvider)
    assert provider.courier == "DTDC"
    assert "TRACKING" in provider.capabilities()


def test_dtdc_unconnected_raises_error(monkeypatch):
    monkeypatch.setattr(ss, "is_configured", lambda: False)
    provider = get_provider("DTDC")
    with pytest.raises(CarrierError) as exc_info:
        provider.get_tracking("D12345678")
    assert exc_info.value.code == "CARRIER_NOT_CONNECTED"
