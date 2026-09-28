"""0006 shipments + shipment_events + carrier_connections."""
from alembic import op
import sqlalchemy as sa

revision = "0006_shipments"
down_revision = "0005_sprint5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "shipments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("parcel_id", sa.String(36), sa.ForeignKey("parcels.id"), nullable=False),
        sa.Column("carrier_code", sa.String(32), nullable=False),
        sa.Column("awb_number", sa.String(64), nullable=False),
        sa.Column("tracking_status", sa.String(32), server_default="BOOKED", nullable=False),
        sa.Column("carrier_status_raw", sa.String(255), nullable=True),
        sa.Column("current_location", sa.String(255), nullable=True),
        sa.Column("last_checkpoint_message", sa.Text(), nullable=True),
        sa.Column("last_checkpoint_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tracking_url", sa.Text(), nullable=True),
        sa.Column("estimated_delivery_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("shipped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rto_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "carrier_code", "awb_number", name="uq_ship_biz_carrier_awb"),
    )
    op.create_index("ix_ship_status", "shipments", ["business_id", "tracking_status"])
    op.create_table(
        "shipment_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("shipment_id", sa.String(36), sa.ForeignKey("shipments.id"), nullable=False),
        sa.Column("carrier_event_id", sa.String(128), server_default="", nullable=False),
        sa.Column("carrier_status_raw", sa.String(255), nullable=True),
        sa.Column("normalized_status", sa.String(32), server_default="UNKNOWN", nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("location", sa.String(255), nullable=True),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("source", sa.String(16), server_default="MANUAL", nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("shipment_id", "carrier_event_id", name="uq_shipev_ship_event"),
    )
    op.create_index("ix_shipev_time", "shipment_events", ["shipment_id", "event_time"])
    op.create_table(
        "carrier_connections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("carrier_code", sa.String(32), nullable=False),
        sa.Column("credentials_encrypted", sa.Text(), server_default="", nullable=False),
        sa.Column("environment", sa.String(16), server_default="LIVE", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "carrier_code", name="uq_carrier_biz_code"),
    )


def downgrade():
    op.drop_table("carrier_connections")
    op.drop_index("ix_shipev_time", table_name="shipment_events")
    op.drop_table("shipment_events")
    op.drop_index("ix_ship_status", table_name="shipments")
    op.drop_table("shipments")
