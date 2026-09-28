"""sprint2 parcels + scan_events"""
from alembic import op
import sqlalchemy as sa
revision = "0002_sprint2"
down_revision = "0001_sprint1"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("parcels",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("parcel_code", sa.String(32), nullable=False),
        sa.Column("barcode_value", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), server_default="CREATED", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "barcode_value", name="uq_parcel_biz_barcode"))
    op.create_index("ix_parcels_barcode", "parcels", ["barcode_value"])
    op.create_index("ix_parcels_order", "parcels", ["order_id"])
    op.create_table("scan_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("parcel_id", sa.String(36), sa.ForeignKey("parcels.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("performed_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("device_id", sa.String(128), nullable=True),
        sa.Column("event_metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_scan_parcel_created", "scan_events", ["parcel_id", "created_at"])

def downgrade():
    op.drop_index("ix_scan_parcel_created", table_name="scan_events")
    op.drop_table("scan_events")
    op.drop_index("ix_parcels_order", table_name="parcels")
    op.drop_index("ix_parcels_barcode", table_name="parcels")
    op.drop_table("parcels")
