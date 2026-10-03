from .base import CarrierError, CarrierProvider  # noqa: F401
from .manual import ManualProvider
from .dtdc import DtdcProvider
from .tirupati import TirupatiProvider
from .india_post import IndiaPostProvider
from .shipsagar import ShipsagarProvider

PROVIDERS: dict[str, CarrierProvider] = {
    "MANUAL": ManualProvider(),
    "DTDC": DtdcProvider(),
    "TIRUPATI": TirupatiProvider(),
    "INDIA_POST": IndiaPostProvider(),
    "SHIPSAGAR": ShipsagarProvider(),
}


def get_provider(code: str) -> CarrierProvider:
    p = PROVIDERS.get((code or "").upper())
    if p is None:
        raise CarrierError("CARRIER_NOT_CONNECTED", f"Unknown carrier '{code}'.")
    return p


def provider_code_for_shipment(shipment) -> str:
    """Which provider owns this shipment's tracking.

    A shipment pushed through ShipSagar keeps the ShipSagar courier code
    (IP, FEDEX, ...) in carrier_code, so the carrier code alone cannot select a
    provider. shipsagar_tracking_id is the discriminator.
    """
    if (getattr(shipment, "shipsagar_tracking_id", "") or "").strip():
        return "SHIPSAGAR"
    return (getattr(shipment, "carrier_code", "") or "").strip().upper()


def provider_for_shipment(shipment) -> CarrierProvider:
    if provider_code_for_shipment(shipment) == "SHIPSAGAR":
        return ShipsagarProvider(courier=getattr(shipment, "carrier_code", "") or "")
    return get_provider(getattr(shipment, "carrier_code", "") or "")


def normalize_for_shipment(shipment, raw: str) -> str:
    if provider_code_for_shipment(shipment) == "SHIPSAGAR":
        return ShipsagarProvider(
            courier=getattr(shipment, "carrier_code", "") or "").normalize_status(raw)
    return normalize_status(getattr(shipment, "carrier_code", "") or "", raw)


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
