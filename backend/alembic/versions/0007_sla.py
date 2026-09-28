"""0007 sla rules + shipment cases + shipment financials."""
from alembic import op
import sqlalchemy as sa

revision = "0007_sla"
down_revision = "0006_shipments"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "carrier_sla_rules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("carrier_code", sa.String(32), server_default="*", nullable=False),
        sa.Column("event_type", sa.String(32), server_default="RTO", nullable=False),
        sa.Column("start_event", sa.String(32), server_default="RTO_INITIATED", nullable=False),
        sa.Column("allowed_days", sa.Integer(), server_default="45", nullable=False),
        sa.Column("warning_days", sa.Integer(), server_default="7", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "carrier_code", "event_type", name="uq_sla_biz_carrier_event"),
    )
    op.create_table(
        "shipment_cases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("shipment_id", sa.String(36), sa.ForeignKey("shipments.id"), nullable=False),
        sa.Column("case_type", sa.String(32), nullable=False),
        sa.Column("priority", sa.String(16), server_default="MEDIUM", nullable=False),
        sa.Column("complaint_reference", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), server_default="OPEN", nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_followup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_followup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("resolved_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "shipment_financials",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("shipment_id", sa.String(36), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("expected_cod_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("collected_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("settled_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("fee_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("other_deduction", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("net_settlement", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("settlement_reference", sa.String(128), nullable=True),
        sa.Column("settlement_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(32), server_default="EXPECTED", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("shipment_id", name="uq_shipfin_shipment"),
    )


def downgrade():
    op.drop_table("shipment_financials")
    op.drop_table("shipment_cases")
    op.drop_table("carrier_sla_rules")
