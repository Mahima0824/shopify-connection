"""0016 shipsagar: tracking-id column, provider idempotency, failure + retry tables."""
from alembic import op
import sqlalchemy as sa

revision = "0016_shipsagar"
down_revision = "0015_tally_hardening"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("shipments", sa.Column("shipsagar_tracking_id", sa.String(128), nullable=True))
    op.create_index("ix_ship_shipsagar_id", "shipments", ["shipsagar_tracking_id"])

    op.add_column("shipment_events", sa.Column("provider", sa.String(32),
                                               server_default="MANUAL", nullable=False))
    op.add_column("shipment_events", sa.Column("provider_event_id", sa.String(128), nullable=True))
    op.add_column("shipment_events", sa.Column("status", sa.String(32), nullable=True))
    op.add_column("shipment_events", sa.Column("sub_status", sa.String(128), nullable=True))
    # Backfill: legacy rows mirror existing source/event-id values.
    op.execute("UPDATE shipment_events SET status = normalized_status WHERE status IS NULL")
    op.execute("UPDATE shipment_events SET provider = source WHERE source IS NOT NULL AND source <> ''")
    op.create_unique_constraint("uq_shipev_provider_event", "shipment_events",
                                ["provider", "provider_event_id"])
    op.create_index("ix_shipev_provider", "shipment_events", ["provider", "provider_event_id"])

    op.create_table(
        "shipsagar_webhook_failures",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=True),
        sa.Column("reason", sa.String(64), server_default="", nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ssfail_biz_time", "shipsagar_webhook_failures", ["business_id", "created_at"])

    op.create_table(
        "shipsagar_retry_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=True),
        sa.Column("operation", sa.String(64), server_default="register_tracking", nullable=False),
        sa.Column("shipment_id", sa.String(36), sa.ForeignKey("shipments.id"), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("max_attempts", sa.Integer(), server_default="4", nullable=False),
        sa.Column("status", sa.String(16), server_default="PENDING", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ssretry_status_next", "shipsagar_retry_jobs", ["status", "next_retry_at"])


def downgrade():
    op.drop_index("ix_ssretry_status_next", table_name="shipsagar_retry_jobs")
    op.drop_table("shipsagar_retry_jobs")
    op.drop_index("ix_ssfail_biz_time", table_name="shipsagar_webhook_failures")
    op.drop_table("shipsagar_webhook_failures")
    op.drop_index("ix_shipev_provider", table_name="shipment_events")
    op.drop_constraint("uq_shipev_provider_event", "shipment_events", type_="unique")
    for col in ("sub_status", "status", "provider_event_id", "provider"):
        op.drop_column("shipment_events", col)
    op.drop_index("ix_ship_shipsagar_id", table_name="shipments")
    op.drop_column("shipments", "shipsagar_tracking_id")
