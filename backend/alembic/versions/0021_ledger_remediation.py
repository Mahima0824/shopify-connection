"""0021 ledger remediation: repair mis-encoded CANCELLATION amounts (wave A §10).

Deliberate, documented exception to the append-only rule: this migration UPDATEs
existing rows in place instead of posting ADJUSTMENT reversals. The amounts being
zeroed were never real economic events - they were a write-side encoding bug in
record_cancellation, which wrote the full order total on a paid cancellation
while the refund also wrote its own reversal. Posting reversals would double the
correction, so the wrong encoding is repaired directly. This alembic revision is
the audit trail for that change.

Before running, record the expected row count:
    SELECT count(*) FROM financial_transactions
     WHERE transaction_type = 'CANCELLATION' AND amount <> 0;
After running, that query must return 0.
"""
from alembic import op

revision = "0021_ledger_remediation"
down_revision = "0020_ledger_vouchers"
branch_labels = None
depends_on = None

REMEDIATION_SQL = [
    "UPDATE financial_transactions SET amount = 0, tax_amount = 0, net_amount = 0 "
    "WHERE transaction_type = 'CANCELLATION' AND amount <> 0",
]


def upgrade():
    for stmt in REMEDIATION_SQL:
        op.execute(stmt)


def downgrade():
    # Irreversible by design: the original amounts were wrong, so there is
    # nothing correct to restore.
    pass
