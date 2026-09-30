"""0018 GST report fields: line-item tax split + state jurisdiction (#49/#50)."""
from alembic import op
import sqlalchemy as sa

revision = "0018_gst_report_fields"
down_revision = "0017_accounting_controls"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("businesses", sa.Column("state_code", sa.String(8), nullable=True))
    op.add_column("customers", sa.Column("state_code", sa.String(8), nullable=True))
    op.add_column("customers", sa.Column("gstin", sa.String(32), nullable=True))
    op.add_column("orders", sa.Column("ship_state_code", sa.String(8), nullable=True))
    op.add_column("orders", sa.Column("place_of_supply", sa.String(8), nullable=True))
    op.add_column("orders", sa.Column("business_state_code", sa.String(8), nullable=True))
    for col, typ in (
        ("gst_rate", sa.Numeric(6, 2)),
        ("taxable_amount", sa.Numeric(12, 2)),
        ("cgst_amount", sa.Numeric(12, 2)),
        ("sgst_amount", sa.Numeric(12, 2)),
        ("igst_amount", sa.Numeric(12, 2)),
        ("tax_amount", sa.Numeric(12, 2)),
    ):
        op.add_column("order_items", sa.Column(col, typ, nullable=True))
    op.add_column("order_items", sa.Column("hsn_code", sa.String(32), nullable=True))


def downgrade():
    op.drop_column("order_items", "hsn_code")
    for col in ("tax_amount", "igst_amount", "sgst_amount", "cgst_amount",
                "taxable_amount", "gst_rate"):
        op.drop_column("order_items", col)
    for col in ("business_state_code", "place_of_supply", "ship_state_code"):
        op.drop_column("orders", col)
    op.drop_column("customers", "gstin")
    op.drop_column("customers", "state_code")
    op.drop_column("businesses", "state_code")
