from .base import CarrierProvider


class DtdcProvider(CarrierProvider):
    code = "DTDC"
    name = "DTDC"

    def capabilities(self) -> list[str]:
        return ["TRACKING"]
