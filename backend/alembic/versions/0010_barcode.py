"""0010 barcode_format + parcel_items + client_scans."""
from alembic import op
import sqlalchemy as sa

revision = "0010_barcode"
down_revision = "0009_costs"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("parcels", sa.Column("barcode_format", sa.String(16), server_default="CODE128", nullable=False))
    op.create_table(
        "parcel_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("parcel_id", sa.String(36), sa.ForeignKey("parcels.id"), nullable=False),
        sa.Column("order_item_id", sa.String(36), sa.ForeignKey("order_items.id"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("quantity >= 0", name="ck_parcel_item_qty"),
    )
    op.add_column("scan_events", sa.Column("client_scan_id", sa.String(64), nullable=True))
    op.create_index("ix_scan_client", "scan_events", ["business_id", "client_scan_id"])


def downgrade():
    op.drop_index("ix_scan_client", table_name="scan_events")
    op.drop_column("scan_events", "client_scan_id")
    op.drop_table("parcel_items")
    op.drop_column("parcels", "barcode_format")
