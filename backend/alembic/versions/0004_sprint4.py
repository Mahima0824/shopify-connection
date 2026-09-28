"""sprint4 webhooks processing columns + refunds + reconciliations"""
from alembic import op
import sqlalchemy as sa
revision = "0004_sprint4"
down_revision = "0003_sprint3"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("refunds",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("shopify_refund_id", sa.String(64), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("status", sa.String(32), nullable=False, server_default="COMPLETED"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "shopify_refund_id", name="uq_refund_biz_shopify"))
    op.create_table("reconciliations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("reconciliation_status", sa.String(32), nullable=False, server_default="EXCEPTION"),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("issue_code", sa.String(64), nullable=False),
        sa.Column("issue_message", sa.Text(), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("resolved_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("order_id", "issue_code", name="uq_recon_order_issue"))
    op.create_index("ix_recon_resolved", "reconciliations", ["resolved"])
    op.create_index("ix_recon_issue", "reconciliations", ["issue_code"])
    op.add_column("shopify_webhook_events",
        sa.Column("processing_status", sa.String(16), nullable=False, server_default="RECEIVED"))
    op.add_column("shopify_webhook_events", sa.Column("error_message", sa.Text(), nullable=True))
    op.add_column("shopify_webhook_events", sa.Column("received_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("shopify_webhook_events", sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("shopify_webhook_events",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))

def downgrade():
    op.drop_column("shopify_webhook_events", "attempts")
    op.drop_column("shopify_webhook_events", "processed_at")
    op.drop_column("shopify_webhook_events", "received_at")
    op.drop_column("shopify_webhook_events", "error_message")
    op.drop_column("shopify_webhook_events", "processing_status")
    op.drop_index("ix_recon_issue", table_name="reconciliations")
    op.drop_index("ix_recon_resolved", table_name="reconciliations")
    op.drop_table("reconciliations")
    op.drop_table("refunds")
