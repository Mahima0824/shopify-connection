"""0015 tally export hardening: export records + batch lifecycle + ledger mappings (#44/#45/#48)."""
from alembic import op
import sqlalchemy as sa

revision = "0015_tally_hardening"
down_revision = "0014_bank_recon"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tally_export_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("transaction_id", sa.String(64), nullable=False),
        sa.Column("export_batch_id", sa.String(36), sa.ForeignKey("export_batches.id"), nullable=True),
        sa.Column("voucher_type", sa.String(64), nullable=False),
        sa.Column("voucher_number", sa.String(64), nullable=True),
        sa.Column("exported_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("import_status", sa.String(32), server_default="EXPORTED", nullable=False),
        sa.Column("tally_reference", sa.String(128), nullable=True),
        sa.UniqueConstraint("business_id", "transaction_id", "voucher_type",
                            name="uq_tally_export_biz_txn_vtype"),
    )
    op.create_index("ix_tally_export_txn", "tally_export_records",
                    ["business_id", "transaction_id"])

    op.create_table(
        "tally_ledger_mappings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("internal_account", sa.String(64), nullable=False),
        sa.Column("tally_ledger_name", sa.String(128), server_default="", nullable=False),
        sa.Column("voucher_type", sa.String(64), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("business_id", "internal_account", name="uq_tally_ledgermap_biz_acct"),
    )

    # Batch lifecycle per #45 (additive; existing batches keep working).
    for col, typ in (
        ("batch_number", sa.String(64)),
        ("date_from", sa.DateTime(timezone=True)),
        ("date_to", sa.DateTime(timezone=True)),
        ("transaction_count", sa.Integer()),
        ("total_amount", sa.Numeric(18, 2)),
        ("file_name", sa.String(128)),
    ):
        try:
            op.add_column("export_batches", sa.Column(col, typ, nullable=True))
        except Exception:
            pass
    try:
        op.alter_column("export_batches", "status", type_=sa.String(32),
                        existing_type=sa.String(32))
    except Exception:
        pass


def downgrade():
    for col in ("file_name", "total_amount", "transaction_count", "date_to",
                "date_from", "batch_number"):
        try:
            op.drop_column("export_batches", col)
        except Exception:
            pass
    op.drop_table("tally_ledger_mappings")
    op.drop_index("ix_tally_export_txn", table_name="tally_export_records")
    op.drop_table("tally_export_records")
