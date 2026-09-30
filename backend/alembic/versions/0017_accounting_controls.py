"""0017 accounting controls: periods + FY config + audit context (#66/#67/#76/#77/#95)."""
from alembic import op
import sqlalchemy as sa

revision = "0017_accounting_controls"
down_revision = "0016_shipsagar"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accounting_periods",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), server_default="OPEN", nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reopened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reopened_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("issue_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "year", "month", name="uq_acct_period_biz_ym"),
    )
    op.create_index("ix_acct_period_biz_status", "accounting_periods", ["business_id", "status"])

    # Business-configurable FY start month; India default April (#77).
    op.add_column("businesses", sa.Column("fy_start_month", sa.Integer(),
                                          server_default="4", nullable=False))

    # Audit context per #66 (additive; existing old_data/new_data kept).
    op.add_column("audit_logs", sa.Column("ip_address", sa.String(64), nullable=True))
    op.add_column("audit_logs", sa.Column("user_agent", sa.String(512), nullable=True))
    op.add_column("audit_logs", sa.Column("old_values", sa.JSON(), nullable=True))
    op.add_column("audit_logs", sa.Column("new_values", sa.JSON(), nullable=True))
    op.create_index("ix_audit_action", "audit_logs", ["action"])


def downgrade():
    op.drop_index("ix_audit_action", table_name="audit_logs")
    for col in ("new_values", "old_values", "user_agent", "ip_address"):
        op.drop_column("audit_logs", col)
    op.drop_column("businesses", "fy_start_month")
    op.drop_index("ix_acct_period_biz_status", table_name="accounting_periods")
    op.drop_table("accounting_periods")
