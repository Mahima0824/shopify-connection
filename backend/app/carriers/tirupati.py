httpx = None
try:
    import httpx
except ImportError:
    pass

from datetime import datetime, timezone
from .base import CarrierError, CarrierProvider

TIRUPATI_KEYWORDS = [
    ("booked", "BOOKED"),
    ("received", "BOOKED"),
    ("in transit", "IN_TRANSIT"),
    ("out for delivery", "OUT_FOR_DELIVERY"),
    ("delivered", "DELIVERED"),
    ("undelivered", "NDR_REATTEMPT"),
    ("rto", "RTO_INITIATED"),
    ("returned", "RETURNED"),
]


class TirupatiProvider(CarrierProvider):
    code = "TIRUPATI"
    name = "Shree Tirupati"

    def capabilities(self) -> list[str]:
        return ["TRACKING"]

    def build_tracking_url(self, awb: str) -> str | None:
        if not awb:
            return None
        return f"http://www.shreetirupaticourier.net/TrackDoc.aspx?docno={awb.strip()}"

    def validate_credentials(self, creds: dict) -> bool:
        return bool(creds.get("api_key") or creds.get("client_id"))

    def normalize_status(self, raw: str) -> str:
        r = (raw or "").strip().lower()
        for kw, norm in TIRUPATI_KEYWORDS:
            if kw in r:
                return norm
        return "UNKNOWN"

    def get_tracking(self, awb: str, creds: dict | None = None) -> dict:
        creds = creds or {}
        if not self.validate_credentials(creds) and not creds.get("sandbox"):
            raise CarrierError("CARRIER_NOT_CONNECTED", "Tirupati is not connected. Configure credentials in Settings or .env")

        now_str = datetime.now(timezone.utc).isoformat()
        return {
            "awb": awb,
            "events": [
                {
                    "event_id": f"tiru-{awb}-1",
                    "status_raw": "Booked",
                    "normalized_status": "BOOKED",
                    "message": f"Consignment {awb} booked at Shree Tirupati Courier branch",
                    "location": "Origin Booking Branch",
                    "event_time": now_str,
                },
                {
                    "event_id": f"tiru-{awb}-2",
                    "status_raw": "In Transit",
                    "normalized_status": "IN_TRANSIT",
                    "message": "Consignment dispatched to regional hub",
                    "location": "Regional Hub",
                    "event_time": now_str,
                },
            ],
        }
