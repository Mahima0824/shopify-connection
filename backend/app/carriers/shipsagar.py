"""ShipSagar aggregation provider.

ShipSagar proxies tracking for many carriers, so the registry key is
``SHIPSAGAR`` while the underlying courier (``IP``, ``FEDEX``, ``DTDC``, ...)
lives on the shipment. The courier is supplied per instance so status
normalization can pick the right matrix.

``track_shipment`` hands back ``datetime`` timestamps; the endpoints store each
event dict verbatim as JSON ``raw_payload``, so they are re-emitted as ISO
strings here — the same shape ``IndiaPostProvider`` already returns.
"""

from datetime import datetime

from .base import CarrierError, CarrierProvider
from app.services import shipsagar_service as ss


class ShipsagarProvider(CarrierProvider):
    code = "SHIPSAGAR"
    name = "ShipSagar"

    def __init__(self, courier: str = ""):
        self.courier = (courier or "").strip().upper()

    def capabilities(self) -> list[str]:
        return ["TRACKING"]

    def validate_credentials(self, creds: dict) -> bool:
        return ss.is_configured()

    def normalize_status(self, raw: str) -> str:
        return ss.normalize_shipsagar_status(self.courier, raw)

    def get_tracking(self, awb: str, creds: dict | None = None) -> dict:
        if not awb or not str(awb).strip():
            raise CarrierError("CARRIER_NOT_CONNECTED",
                               "ShipSagar needs a tracking number.")
        if not ss.is_configured():
            raise CarrierError("CARRIER_NOT_CONNECTED",
                               "ShipSagar is not connected. Set SHIPSAGAR_TOKEN "
                               "and SHIPSAGAR_CLIENT_CODE.")
        try:
            data = ss.track_shipment(str(awb).strip(), self.courier)
        except ss.ShipsagarError as exc:
            raise CarrierError(exc.code, exc.message) from exc
        events = []
        for raw in data.get("events") or []:
            ev = dict(raw or {})
            if isinstance(ev.get("event_time"), datetime):
                ev["event_time"] = ev["event_time"].isoformat()
            events.append(ev)
        return {"awb": data.get("awb") or str(awb).strip(), "events": events}