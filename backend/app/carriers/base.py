class CarrierError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class CarrierProvider:
    code: str = ""
    name: str = ""

    def capabilities(self) -> list[str]:
        return []

    def validate_credentials(self, creds: dict) -> bool:
        raise CarrierError("CARRIER_NOT_CONNECTED", f"{self.code} is not connected.")

    def get_tracking(self, awb: str, creds: dict | None = None) -> dict:
        raise CarrierError("CARRIER_NOT_CONNECTED", f"{self.code} is not connected.")

    def normalize_status(self, raw: str) -> str:
        return "UNKNOWN"

    def build_tracking_url(self, awb: str) -> str | None:
        return None
