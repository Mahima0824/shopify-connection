"""0020 ledger vouchers: leg grouping + per-leg pnl_class (wave A §3, §8).

Adds multi-leg voucher support to the financial ledger and classifies each leg's
P&L effect at post time. BACKFILL_SQL is module-level and self-contained so the
migration is a permanent record that does not import application code, and so
tests/test_ledger_vouchers.py can execute the exact statements against a seeded
database.
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_ledger_vouchers"
down_revision = "0019_india_post_order_fields"
branch_labels = None
depends_on = None

BACKFILL_SQL = [
    "UPDATE financial_transactions SET pnl_class = 'REVENUE' WHERE transaction_type = 'SALE'",
    "UPDATE financial_transactions SET pnl_class = 'REVERSAL' WHERE transaction_type IN ('REFUND', 'CARRIER_CLAIM')",
    "UPDATE financial_transactions SET pnl_class = 'COGS' WHERE transaction_type = 'COGS'",
    "UPDATE financial_transactions SET pnl_class = 'EXPENSE' WHERE transaction_type IN "
    "('SHIPPING_EXPENSE', 'PACKAGING_EXPENSE', 'PAYMENT_GATEWAY_FEE', 'OTHER_EXPENSE', 'TAX', 'ADJUSTMENT')",
    "UPDATE financial_transactions SET pnl_class = 'NONE' WHERE transaction_type IN "
    "('PAYMENT', 'COD_REMIT', 'REFUND_PAYOUT', 'COD_COLLECTION', 'CANCELLATION')",
]


def upgrade():
    op.add_column("financial_transactions", sa.Column("voucher_group_id", sa.String(128), nullable=True))
    op.add_column("financial_transactions", sa.Column("leg_index", sa.Integer(), server_default="0", nullable=False))
    op.add_column("financial_transactions", sa.Column("pnl_class", sa.String(16), server_default="NONE", nullable=False))
    op.create_index("ix_fintxn_biz_group", "financial_transactions", ["business_id", "voucher_group_id"])
    op.add_column("shipment_cases", sa.Column("claim_amount", sa.Numeric(12, 2), nullable=True))
    op.create_table(
        "ledger_posting_failures",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_id", sa.String(128), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="1", nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("business_id", "source_type", "source_id", "event_type",
                            name="uq_lpf_biz_source_event"),
    )
    op.create_index("ix_lpf_biz_resolved", "ledger_posting_failures",
                    ["business_id", "resolved_at"])
    for stmt in BACKFILL_SQL:
        op.execute(stmt)


def downgrade():
    op.drop_index("ix_lpf_biz_resolved", table_name="ledger_posting_failures")
    op.drop_table("ledger_posting_failures")
    op.drop_column("shipment_cases", "claim_amount")
    op.drop_index("ix_fintxn_biz_group", table_name="financial_transactions")
    op.drop_column("financial_transactions", "pnl_class")
    op.drop_column("financial_transactions", "leg_index")
    op.drop_column("financial_transactions", "voucher_group_id")
