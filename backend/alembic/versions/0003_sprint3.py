"""sprint3 returns + audit_logs"""
from alembic import op
import sqlalchemy as sa
revision = "0003_sprint3"
down_revision = "0002_sprint2"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("returns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("parcel_id", sa.String(36), sa.ForeignKey("parcels.id"), nullable=False),
        sa.Column("return_type", sa.String(32), nullable=False),
        sa.Column("reason", sa.String(255), nullable=True),
        sa.Column("condition", sa.String(32), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("inspected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(32), server_default="RECEIVED", nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_returns_order", "returns", ["order_id"])
    op.create_index("ix_returns_parcel", "returns", ["parcel_id"])
    op.create_table("return_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("return_id", sa.String(36), sa.ForeignKey("returns.id"), nullable=False),
        sa.Column("order_item_id", sa.String(36), sa.ForeignKey("order_items.id"), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("condition", sa.String(32), nullable=True),
        sa.CheckConstraint("quantity >= 0", name="ck_return_item_qty"))
    op.create_index("ix_return_items_return", "return_items", ["return_id"])
    op.create_table("audit_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("old_data", sa.JSON(), nullable=True),
        sa.Column("new_data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.create_index("ix_audit_entity", "audit_logs", ["entity_type", "entity_id"])
    op.create_index("ix_audit_biz_created", "audit_logs", ["business_id", "created_at"])

def downgrade():
    op.drop_index("ix_audit_biz_created", table_name="audit_logs")
    op.drop_index("ix_audit_entity", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_return_items_return", table_name="return_items")
    op.drop_table("return_items")
    op.drop_index("ix_returns_parcel", table_name="returns")
    op.drop_index("ix_returns_order", table_name="returns")
    op.drop_table("returns")
