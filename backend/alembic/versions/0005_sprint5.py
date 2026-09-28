"""sprint5 tally mappings + export batches tables"""
from alembic import op
import sqlalchemy as sa

revision = "0005_sprint5"
down_revision = "0004_sprint4"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("tally_mappings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("voucher_sales", sa.String(64), nullable=False, server_default="Sales"),
        sa.Column("voucher_sales_return", sa.String(64), nullable=False, server_default="Sales Return"),
        sa.Column("voucher_credit_note", sa.String(64), nullable=False, server_default="Credit Note"),
        sa.Column("ledger_razorpay", sa.String(128), nullable=False, server_default="Razorpay Settlement"),
        sa.Column("ledger_cod", sa.String(128), nullable=False, server_default="COD Receivable"),
        sa.Column("ledger_sales", sa.String(128), nullable=False, server_default="Sales Account"),
        sa.Column("ledger_cgst", sa.String(128), nullable=False, server_default="Output CGST"),
        sa.Column("ledger_sgst", sa.String(128), nullable=False, server_default="Output SGST"),
        sa.Column("ledger_igst", sa.String(128), nullable=False, server_default="Output IGST"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", name="uq_tally_mapping_biz"))

    op.create_table("export_batches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("batch_reference", sa.String(64), nullable=False, unique=True),
        sa.Column("export_type", sa.String(32), nullable=False, server_default="TALLY_EXCEL"),
        sa.Column("record_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("generated_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="COMPLETED"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))

def downgrade():
    op.drop_table("export_batches")
    op.drop_table("tally_mappings")
