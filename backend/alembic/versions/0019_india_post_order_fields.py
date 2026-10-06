"""0019 India Post order fields: manual new-order receiver/sender/parcel/COD columns."""
from alembic import op
import sqlalchemy as sa

revision = "0019_india_post_order_fields"
down_revision = "0018_gst_report_fields"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("orders", sa.Column("receiver_name", sa.String(128), nullable=True))
    op.add_column("orders", sa.Column("receiver_company", sa.String(128), nullable=True))
    op.add_column("orders", sa.Column("receiver_add1", sa.String(255), nullable=True))
    op.add_column("orders", sa.Column("receiver_add2", sa.String(255), nullable=True))
    op.add_column("orders", sa.Column("receiver_city", sa.String(64), nullable=True))
    op.add_column("orders", sa.Column("receiver_state", sa.String(64), nullable=True))
    op.add_column("orders", sa.Column("receiver_pincode", sa.String(12), nullable=True))
    op.add_column("orders", sa.Column("receiver_mobile", sa.String(16), nullable=True))
    op.add_column("orders", sa.Column("receiver_email", sa.String(128), nullable=True))
    op.add_column("orders", sa.Column("sender_name", sa.String(128), nullable=True))
    op.add_column("orders", sa.Column("sender_add1", sa.String(255), nullable=True))
    op.add_column("orders", sa.Column("sender_city", sa.String(64), nullable=True))
    op.add_column("orders", sa.Column("sender_state", sa.String(64), nullable=True))
    op.add_column("orders", sa.Column("sender_pincode", sa.String(12), nullable=True))
    op.add_column("orders", sa.Column("sender_mobile", sa.String(16), nullable=True))
    op.add_column("orders", sa.Column("weight_grams", sa.Numeric(10, 2), nullable=True))
    op.add_column("orders", sa.Column("shape", sa.String(16), nullable=True))
    op.add_column("orders", sa.Column("length_cm", sa.Numeric(8, 2), nullable=True))
    op.add_column("orders", sa.Column("breadth_cm", sa.Numeric(8, 2), nullable=True))
    op.add_column("orders", sa.Column("height_cm", sa.Numeric(8, 2), nullable=True))
    op.add_column("orders", sa.Column("barcode_no", sa.String(32), nullable=True))
    op.add_column("orders", sa.Column("bulk_reference", sa.String(64), nullable=True))
    op.add_column("orders", sa.Column("cod_mode", sa.String(16), nullable=True))
    op.add_column("orders", sa.Column("cod_value", sa.Numeric(12, 2), nullable=True))
    op.add_column("orders", sa.Column("dropoff_pincode", sa.String(12), nullable=True))
    op.create_index("ix_orders_cod_mode", "orders", ["cod_mode"])
    op.create_index("ix_orders_receiver_pincode", "orders", ["receiver_pincode"])


def downgrade():
    op.drop_index("ix_orders_receiver_pincode", table_name="orders")
    op.drop_index("ix_orders_cod_mode", table_name="orders")
    for col in ("dropoff_pincode", "cod_value", "cod_mode", "bulk_reference",
                "barcode_no", "height_cm", "breadth_cm", "length_cm", "shape",
                "weight_grams", "sender_mobile", "sender_pincode", "sender_state",
                "sender_city", "sender_add1", "sender_name", "receiver_email",
                "receiver_mobile", "receiver_pincode", "receiver_state",
                "receiver_city", "receiver_add2", "receiver_add1",
                "receiver_company", "receiver_name"):
        op.drop_column("orders", col)
