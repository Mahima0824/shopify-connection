"""0022 schema drift: columns + table added to models without a migration.

Four sets of model columns/tables were added to app/models/ without a matching
alembic revision, so a database built from the migration chain was missing them
and every read of those attributes raised OperationalError:

  - businesses.gstin / address               (invoice_service renders both)
  - order_items.image_url                     (order_service, rto, shopify_service)
  - products.stock_quantity / image_url       (products API, order_service stock decrement)
  - whatsapp_notifications                    (whole table; whatsapp_service logs every send)

Every operation here is batched because SQLite cannot ALTER a column type or add
a constraint; batch mode is a no-op rewrite on Postgres.
"""
from alembic import op
import sqlalchemy as sa

revision = "0022_schema_drift"
down_revision = "0021_ledger_remediation"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("businesses") as batch_op:
        batch_op.add_column(sa.Column("gstin", sa.String(32), nullable=True))
        batch_op.add_column(sa.Column("address", sa.String(255), nullable=True))

    with op.batch_alter_table("order_items") as batch_op:
        batch_op.add_column(sa.Column("image_url", sa.String(512), nullable=True))

    # stock_quantity is NOT NULL in the model; existing rows need the default
    # backfilled before the NOT NULL is meaningful on a copied table.
    with op.batch_alter_table("products") as batch_op:
        batch_op.add_column(sa.Column("stock_quantity", sa.Integer(),
                                      server_default="50", nullable=False))
        batch_op.add_column(sa.Column("image_url", sa.String(512), nullable=True))

    op.create_table(
        "whatsapp_notifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("order_id", sa.String(36), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("shipment_id", sa.String(36), sa.ForeignKey("shipments.id"), nullable=True),
        sa.Column("phone_number", sa.String(32), nullable=False),
        sa.Column("notification_type", sa.String(32), nullable=False),
        sa.Column("message_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), server_default="SENT", nullable=False),
        sa.Column("provider_message_id", sa.String(128), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_whatsapp_notif_order_id", "whatsapp_notifications", ["order_id"])
    op.create_index("ix_whatsapp_notif_phone", "whatsapp_notifications", ["phone_number"])
    op.create_index("ix_whatsapp_notif_created_at", "whatsapp_notifications", ["created_at"])


def downgrade():
    op.drop_index("ix_whatsapp_notif_created_at", table_name="whatsapp_notifications")
    op.drop_index("ix_whatsapp_notif_phone", table_name="whatsapp_notifications")
    op.drop_index("ix_whatsapp_notif_order_id", table_name="whatsapp_notifications")
    op.drop_table("whatsapp_notifications")

    with op.batch_alter_table("products") as batch_op:
        batch_op.drop_column("image_url")
        batch_op.drop_column("stock_quantity")

    with op.batch_alter_table("order_items") as batch_op:
        batch_op.drop_column("image_url")

    with op.batch_alter_table("businesses") as batch_op:
        batch_op.drop_column("address")
        batch_op.drop_column("gstin")
