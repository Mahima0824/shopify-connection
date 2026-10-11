import pytest
from app.carriers.registry import get_provider
from app.carriers.shipsagar import ShipsagarProvider
from app.carriers.base import CarrierError
from app.services import shipsagar_service as ss


def test_bluedart_routes_through_shipsagar():
    provider = get_provider("BLUEDART")
    assert isinstance(provider, ShipsagarProvider)
    assert provider.courier == "BLUEDART"
    assert "TRACKING" in provider.capabilities()


def test_bluedart_unconnected_raises_error(monkeypatch):
    monkeypatch.setattr(ss, "is_configured", lambda: False)
    provider = get_provider("BLUEDART")
    with pytest.raises(CarrierError) as exc_info:
        provider.get_tracking("123456789")
    assert exc_info.value.code == "CARRIER_NOT_CONNECTED"
