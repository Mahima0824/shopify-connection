from .base import CarrierProvider


class IndiaPostProvider(CarrierProvider):
    code = "INDIA_POST"
    name = "India Post"

    def capabilities(self) -> list[str]:
        return ["TRACKING"]
