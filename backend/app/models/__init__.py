"""Import all domain models so Base.metadata is fully populated (Alembic + create_tables)."""

from app.models.base import Base  # noqa: F401
from app.models.business import Business  # noqa: F401
from app.models.customer import Customer  # noqa: F401
from app.models.order import Order, OrderItem  # noqa: F401
from app.models.parcel import Parcel  # noqa: F401
from app.models.parcel_item import ParcelItem  # noqa: F401
from app.models.scan_event import ScanEvent  # noqa: F401
from app.models.return_record import ReturnRecord, ReturnItem  # noqa: F401
from app.models.audit_log import AuditLog  # noqa: F401
from app.models.payment import Payment  # noqa: F401
from app.models.product import Product  # noqa: F401
from app.models.shopify_store import ShopifyStore  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.webhook_event import ShopifyWebhookEvent  # noqa: F401
from app.models.refund import Refund  # noqa: F401
from app.models.reconciliation import Reconciliation  # noqa: F401
from app.models.tally import TallyMapping, ExportBatch  # noqa: F401
from app.models.shipment import Shipment, ShipmentEvent, CarrierConnection  # noqa: F401
from app.models.sla import SLARule, ShipmentCase, ShipmentFinancial  # noqa: F401
from app.models.statement import StatementUpload, StatementRow  # noqa: F401
from app.models.cost import ProductCostHistory, CostRule  # noqa: F401
from app.models.courier_meta import (  # noqa: F401
    BookingIdempotency,
    ShipmentAttempt,
    CourierStatusMapping,
    CarrierFeature,
)
