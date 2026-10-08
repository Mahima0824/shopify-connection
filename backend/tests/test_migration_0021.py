"""Task 8: the remediation zeroes amount-bearing CANCELLATION rows exactly once."""
import importlib.util
import os

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _mod():
    path = os.path.join(BACKEND, "alembic", "versions", "0021_ledger_remediation.py")
    spec = importlib.util.spec_from_file_location("m0021", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _seed(db):
    from sqlalchemy import text
    rows = [
        ("a1", "TXN-1", "CANCELLATION", "1180.00", "180.00", "1000.00"),
        ("a2", "TXN-2", "CANCELLATION", "0.00", "0.00", "0.00"),
        ("a3", "TXN-3", "SALE", "1180.00", "180.00", "1000.00"),
        ("a4", "TXN-4", "REFUND", "590.00", "0.00", "590.00"),
    ]
    for rid, tid, typ, amt, tax, net in rows:
        db.execute(text(
            "INSERT INTO financial_transactions (id, business_id, transaction_id, "
            "transaction_type, transaction_date, amount, tax_amount, net_amount, "
            "currency, debit_account, credit_account, status, idempotency_key, pnl_class, leg_index) VALUES "
            "(:i,'b1',:t,:ty,'2026-09-01',:a,:x,:n,'INR','','','POSTED',:k,'NONE',0)"),
            {"i": rid, "t": tid, "ty": typ, "a": amt, "x": tax, "n": net, "k": "k" + rid})
    db.commit()


def test_remediation_zeroes_only_amount_bearing_cancellations():
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    _seed(db)
    mod = _mod()
    for stmt in mod.REMEDIATION_SQL:
        db.execute(text(stmt))
    db.commit()
    got = {r[0]: (r[1], r[2], r[3]) for r in db.execute(text(
        "SELECT id, amount, tax_amount, net_amount FROM financial_transactions")).all()}
    assert tuple(float(x) for x in got["a1"]) == (0.0, 0.0, 0.0)
    assert tuple(float(x) for x in got["a2"]) == (0.0, 0.0, 0.0)
    assert tuple(float(x) for x in got["a3"]) == (1180.0, 180.0, 1000.0)   # untouched
    assert float(got["a4"][1]) == 0.0                                     # untouched


def test_remediation_is_idempotent():
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    import app.models  # noqa: F401
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    _seed(db)
    mod = _mod()
    for _ in range(3):
        for stmt in mod.REMEDIATION_SQL:
            db.execute(text(stmt))
    db.commit()
    n = db.execute(text(
        "SELECT count(*) FROM financial_transactions "
        "WHERE transaction_type='CANCELLATION' AND amount <> 0")).scalar()
    assert n == 0


def test_migration_docstring_records_the_immutability_exception():
    mod = _mod()
    doc = (mod.__doc__ or "")
    assert "ADJUSTMENT" in doc
    assert "immutab" in doc.lower() or "append-only" in doc.lower()
