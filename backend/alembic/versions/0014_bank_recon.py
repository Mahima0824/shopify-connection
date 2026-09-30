"""0014 bank reconciliation hardening: bank_accounts + statement_rows bank columns (#32/#33/#71/#72)."""
from alembic import op
import sqlalchemy as sa

revision = "0014_bank_recon"
down_revision = "0013_financial_ledger"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "bank_accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("name", sa.String(128), server_default="", nullable=False),
        sa.Column("bank_name", sa.String(128), server_default="", nullable=False),
        sa.Column("account_number_masked", sa.String(32), server_default="", nullable=False),
        sa.Column("ifsc", sa.String(16), nullable=True),
        sa.Column("currency", sa.String(8), server_default="INR", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.add_column("statement_rows", sa.Column("bank_account_id", sa.String(36),
                                              sa.ForeignKey("bank_accounts.id"), nullable=True))
    op.add_column("statement_rows", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("statement_rows", sa.Column("reference_number", sa.String(128), nullable=True))
    op.add_column("statement_rows", sa.Column("debit", sa.Numeric(18, 2), server_default="0",
                                              nullable=False))
    op.add_column("statement_rows", sa.Column("credit", sa.Numeric(18, 2), server_default="0",
                                              nullable=False))
    op.add_column("statement_rows", sa.Column("balance", sa.Numeric(18, 2), server_default="0",
                                              nullable=False))
    op.add_column("statement_rows", sa.Column("value_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("statement_rows", sa.Column("import_batch_id", sa.String(64), nullable=True))
    op.add_column("statement_rows", sa.Column("import_identity", sa.String(256), nullable=True))
    op.add_column("statement_rows", sa.Column("match_level", sa.String(8), nullable=True))
    op.add_column("statement_rows", sa.Column("matched_payment_id", sa.String(36), nullable=True))
    op.add_column("statement_rows", sa.Column("expected_amount", sa.Numeric(18, 2), server_default="0",
                                              nullable=False))
    op.add_column("statement_rows", sa.Column("difference", sa.Numeric(18, 2), server_default="0",
                                              nullable=False))
    # Existing reconciliation_status is String(16); POTENTIAL_MATCH needs 15 chars — fits, but
    # widen to 24 for safety.
    op.alter_column("statement_rows", "reconciliation_status", type_=sa.String(24),
                    existing_type=sa.String(16))
    op.create_index("ix_stmrow_ref", "statement_rows", ["reference_number"])
    op.create_index("ix_stmrow_bank", "statement_rows", ["bank_account_id"])
    op.create_unique_constraint("uq_stmrow_import_identity", "statement_rows", ["import_identity"])


def downgrade():
    op.drop_constraint("uq_stmrow_import_identity", "statement_rows", type_="unique")
    op.drop_index("ix_stmrow_bank", table_name="statement_rows")
    op.drop_index("ix_stmrow_ref", table_name="statement_rows")
    op.alter_column("statement_rows", "reconciliation_status", type_=sa.String(16),
                    existing_type=sa.String(24))
    for col in ("difference", "expected_amount", "matched_payment_id", "match_level",
                "import_identity", "import_batch_id", "value_date", "balance", "credit",
                "debit", "reference_number", "description", "bank_account_id"):
        op.drop_column("statement_rows", col)
    op.drop_table("bank_accounts")
