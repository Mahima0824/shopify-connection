from .base import CarrierError, CarrierProvider  # noqa: F401

KEYWORDS = [
    ("out for delivery", "OUT_FOR_DELIVERY"),
    ("ofd", "OUT_FOR_DELIVERY"),
    ("deliver", "DELIVERED"),
    ("rto", "RTO_INITIATED"),
    ("return", "RETURN_AT_HUB"),
    ("pickup", "PICKED_UP"),
    ("picked", "PICKED_UP"),
    ("transit", "IN_TRANSIT"),
    ("hub", "AT_HUB"),
    ("book", "BOOKED"),
    ("lost", "LOST"),
    ("damage", "DAMAGED"),
    ("exception", "DELIVERY_EXCEPTION"),
    ("fail", "DELIVERY_EXCEPTION"),
]


class ManualProvider(CarrierProvider):
    code = "MANUAL"
    name = "Manual entry"

    def capabilities(self) -> list[str]:
        return ["TRACKING"]

    def get_tracking(self, awb: str, creds: dict | None = None) -> dict:
        raise CarrierError(
            "TRACKING_PROVIDER_ERROR",
            "Manual provider has no live tracking; record checkpoints via the events API.",
        )

    def normalize_status(self, raw: str) -> str:
        r = (raw or "").lower()
        for kw, norm in KEYWORDS:
            if kw in r:
                return norm
        return "UNKNOWN"
