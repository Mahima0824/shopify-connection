"""RBAC matrix per #67. Admin everything; Accountant finance/reports/bank/tally/GST;
Warehouse orders/parcels/barcodes/dispatch; Viewer reports-only."""

ACCOUNTING_ROLES = ("ADMIN", "ACCOUNTANT")  # finance/ledger/bank/tally/close writes
WAREHOUSE_ROLES = ("ADMIN", "WAREHOUSE")  # parcels/dispatch writes
ADMIN_ONLY = ("ADMIN",)
STAFF_READ = ("ADMIN", "ACCOUNTANT", "WAREHOUSE", "VIEWER")  # reports/reads


def allowed(role: str | None, *role_sets: str) -> bool:
    return (role or "") in role_sets
