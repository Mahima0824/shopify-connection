"""0012 courier booking idempotency, attempts, status mappings, feature flags."""
from alembic import op
import sqlalchemy as sa

revision = "0012_courier"
down_revision = "0011_parcel_status"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "booking_idempotency",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("shipment_id", sa.String(36), sa.ForeignKey("shipments.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "key", name="uq_bookidem_biz_key"),
    )
    op.create_table(
        "shipment_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("parcel_id", sa.String(36), sa.ForeignKey("parcels.id"), nullable=True),
        sa.Column("carrier_code", sa.String(32), server_default="", nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("provider_code", sa.String(128), nullable=True),
        sa.Column("provider_message", sa.Text(), nullable=True),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "courier_status_mappings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("provider_status_code", sa.String(128), nullable=False),
        sa.Column("normalized_status", sa.String(32), nullable=False),
        sa.Column("is_terminal", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("is_delivered", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("is_ndr", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("is_rto", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("is_hub_event", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("provider", "provider_status_code", name="uq_csmap_prov_code"),
    )
    op.create_table(
        "carrier_features",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("capability", sa.String(32), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "provider", "capability", name="uq_cfeat_biz_prov_cap"),
    )


def downgrade():
    op.drop_table("carrier_features")
    op.drop_table("courier_status_mappings")
    op.drop_table("shipment_attempts")
    op.drop_table("booking_idempotency")
