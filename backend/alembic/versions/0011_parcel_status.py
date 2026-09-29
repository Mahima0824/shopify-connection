"""0011 parcel status index."""
from alembic import op

revision = "0011_parcel_status"
down_revision = "0010_barcode"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_parcels_biz_status", "parcels", ["business_id", "status"])


def downgrade():
    op.drop_index("ix_parcels_biz_status", table_name="parcels")
