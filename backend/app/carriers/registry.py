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


def db_normalize(db, business_id: str, provider: str, raw: str) -> str | None:
    from app.models.courier_meta import CourierStatusMapping
    code = (raw or "").strip()
    if not code:
        return None
    for bid in (business_id, None):
        q = db.query(CourierStatusMapping).filter_by(
            provider=(provider or "").upper(), provider_status_code=code)
        if bid is None:
            q = q.filter(CourierStatusMapping.business_id.is_(None))
        else:
            q = q.filter(CourierStatusMapping.business_id == bid)
        m = q.first()
        if m is not None:
            return m.normalized_status
    return None
