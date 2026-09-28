from .base import CarrierProvider


class TirupatiProvider(CarrierProvider):
    code = "TIRUPATI"
    name = "Shree Tirupati"

    def capabilities(self) -> list[str]:
        return ["TRACKING"]
