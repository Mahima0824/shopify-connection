"""0008 statement uploads + rows."""
from alembic import op
import sqlalchemy as sa

revision = "0008_statements"
down_revision = "0007_sla"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "statement_uploads",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("statement_type", sa.String(32), nullable=False),
        sa.Column("provider", sa.String(64), server_default="", nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("original_filename", sa.String(255), server_default="", nullable=False),
        sa.Column("file_hash", sa.String(64), server_default="", nullable=False),
        sa.Column("row_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status", sa.String(16), server_default="READY", nullable=False),
        sa.Column("uploaded_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "statement_rows",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("statement_upload_id", sa.String(36), sa.ForeignKey("statement_uploads.id"), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("external_reference", sa.String(128), nullable=True),
        sa.Column("awb_number", sa.String(64), nullable=True),
        sa.Column("order_reference", sa.String(64), nullable=True),
        sa.Column("transaction_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("gross_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("fee_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("net_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("transaction_type", sa.String(64), nullable=True),
        sa.Column("status", sa.String(64), nullable=True),
        sa.Column("raw_data", sa.JSON(), nullable=True),
        sa.Column("reconciliation_status", sa.String(16), server_default="UNMATCHED", nullable=False),
        sa.Column("matched_order_id", sa.String(36), nullable=True),
        sa.Column("matched_shipment_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_stmrow_awb", "statement_rows", ["awb_number"])
    op.create_index("ix_stmrow_upload", "statement_rows", ["statement_upload_id"])


def downgrade():
    op.drop_index("ix_stmrow_upload", table_name="statement_rows")
    op.drop_index("ix_stmrow_awb", table_name="statement_rows")
    op.drop_table("statement_rows")
    op.drop_table("statement_uploads")
