from .base import CarrierError, CarrierProvider  # noqa: F401
from .manual import ManualProvider
from .dtdc import DtdcProvider
from .tirupati import TirupatiProvider
from .india_post import IndiaPostProvider

PROVIDERS: dict[str, CarrierProvider] = {
    "MANUAL": ManualProvider(),
    "DTDC": DtdcProvider(),
    "TIRUPATI": TirupatiProvider(),
    "INDIA_POST": IndiaPostProvider(),
}


def get_provider(code: str) -> CarrierProvider:
    p = PROVIDERS.get((code or "").upper())
    if p is None:
        raise CarrierError("CARRIER_NOT_CONNECTED", f"Unknown carrier '{code}'.")
    return p


def normalize_status(code: str, raw: str) -> str:
    try:
        return get_provider(code).normalize_status(raw)
    except CarrierError:
        return "UNKNOWN"
