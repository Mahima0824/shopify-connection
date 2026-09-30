"""0013 financial ledger: immutable financial_transactions + indexes (#21, #70, #71)."""
from alembic import op
import sqlalchemy as sa

revision = "0013_financial_ledger"
down_revision = "0012_courier"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "financial_transactions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("transaction_id", sa.String(64), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("payment_id", sa.String(36), sa.ForeignKey("payments.id"), nullable=True),
        sa.Column("refund_id", sa.String(36), sa.ForeignKey("refunds.id"), nullable=True),
        sa.Column("expense_id", sa.String(64), nullable=True),
        sa.Column("transaction_type", sa.String(32), nullable=False),
        sa.Column("transaction_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("tax_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("net_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("currency", sa.String(8), server_default="INR", nullable=False),
        sa.Column("debit_account", sa.String(128), server_default="", nullable=False),
        sa.Column("credit_account", sa.String(128), server_default="", nullable=False),
        sa.Column("payment_method", sa.String(64), nullable=True),
        sa.Column("reference_number", sa.String(128), nullable=True),
        sa.Column("status", sa.String(32), server_default="POSTED", nullable=False),
        sa.Column("tally_voucher_type", sa.String(64), nullable=True),
        sa.Column("tally_voucher_number", sa.String(64), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("reversal_of_id", sa.String(36), sa.ForeignKey("financial_transactions.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "transaction_id", name="uq_fintxn_biz_txnid"),
        sa.UniqueConstraint("business_id", "idempotency_key", name="uq_fintxn_biz_idem"),
    )
    op.create_index("ix_fintxn_biz_order", "financial_transactions", ["business_id", "order_id"])
    op.create_index("ix_fintxn_biz_date", "financial_transactions", ["business_id", "transaction_date"])
    op.create_index("ix_fintxn_biz_type", "financial_transactions", ["business_id", "transaction_type"])
    op.create_index("ix_fintxn_biz_date_type", "financial_transactions",
                    ["business_id", "transaction_date", "transaction_type"])


def downgrade():
    op.drop_index("ix_fintxn_biz_date_type", table_name="financial_transactions")
    op.drop_index("ix_fintxn_biz_type", table_name="financial_transactions")
    op.drop_index("ix_fintxn_biz_date", table_name="financial_transactions")
    op.drop_index("ix_fintxn_biz_order", table_name="financial_transactions")
    op.drop_table("financial_transactions")
