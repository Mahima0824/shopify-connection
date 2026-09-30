# backend/tests/test_bank_recon.py — Task 2: bank reconciliation hardening (#32-#36, #83).
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
import app.models.business  # noqa: F401
import app.models.user  # noqa: F401
import app.models.order  # noqa: F401
import app.models.payment  # noqa: F401
import app.models.sla  # noqa: F401
import app.models.statement  # noqa: F401
import app.models.bank_account  # noqa: F401
import app.models.financial_transaction  # noqa: F401
from app.main import app
from app.database import get_db

D = lambda *a: datetime(*a, tzinfo=timezone.utc)


def _env():
    from app.models.business import Business
    from app.models.user import User
    from app.models.order import Order
    from app.models.payment import Payment
    from app.models.sla import ShipmentFinancial
    from app.models.bank_account import BankAccount
    from app.services.auth_service import hash_password
    from app.services import ledger_service as ls

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    b = Business(name="B", email="b@t.in")
    db.add(b)
    db.commit()
    db.refresh(b)
    u = User(business_id=b.id, name="A", email="a@t.in", password_hash=hash_password("x"),
             role="ACCOUNTANT")
    db.add(u)
    db.commit()
    acct = BankAccount(business_id=b.id, name="HDFC Current", bank_name="HDFC",
                       account_number_masked="XXXX5012", ifsc="HDFC0001234")
    db.add(acct)
    db.commit()

    def mk_order(name, total):
        o = Order(business_id=b.id, internal_order_number=f"ORD-{name}", shopify_order_id=f"gid://{name}",
                  shopify_order_name=f"#{name}", currency="INR", total_amount=total,
                  operational_status="DELIVERED", order_date=D(2026, 9, 5))
        db.add(o)
        db.commit()
        db.refresh(o)
        return o

    # #83 fixture: payment 1000, fee 20, settlement 980.
    o83 = mk_order("O83", 1000)
    db.add(Payment(business_id=b.id, order_id=o83.id, amount=1000, payment_status="PAID",
                   method="UPI", transaction_id="PAY-83"))
    ls.record_event(db, b.id, "PAYMENT_GATEWAY_FEE", 20, order_id=o83.id,
                    debit_account="Payment Gateway Fee", credit_account="Payment Gateway")
    db.add(ShipmentFinancial(business_id=b.id, shipment_id="shp-83", order_id=o83.id,
                             net_settlement=980, settlement_reference="SET-83",
                             settlement_date=D(2026, 9, 10), status="SETTLED"))
    # L1 fixture: payment ref, no shipment financial (ledger-derived expected 980).
    o_l1 = mk_order("OL1", 1000)
    db.add(Payment(business_id=b.id, order_id=o_l1.id, amount=1000, payment_status="PAID",
                   method="CARD", transaction_id="UTR-L1"))
    ls.record_event(db, b.id, "PAYMENT_GATEWAY_FEE", 20, order_id=o_l1.id,
                    debit_account="Payment Gateway Fee", credit_account="Payment Gateway")
    # L3 fixture: exact amount + date window, no refs.
    o_l3 = mk_order("OL3", 500)
    db.add(ShipmentFinancial(business_id=b.id, shipment_id="shp-l3", order_id=o_l3.id,
                             net_settlement=500, settlement_reference="SET-L3",
                             settlement_date=D(2026, 9, 10), status="SETTLED"))
    # Ambiguous fixtures: two identical expected settlements.
    for tag in ("A4", "A5"):
        o = mk_order(f"O{tag}", 750)
        db.add(ShipmentFinancial(business_id=b.id, shipment_id=f"shp-{tag.lower()}",
                                 order_id=o.id, net_settlement=750,
                                 settlement_reference=f"SET-{tag}",
                                 settlement_date=D(2026, 9, 12), status="SETTLED"))
    # L4 fixture: amount matches but date far outside window; description similar.
    o_l4 = mk_order("OL4", 1200)
    db.add(ShipmentFinancial(business_id=b.id, shipment_id="shp-l4", order_id=o_l4.id,
                             net_settlement=1200, settlement_reference="SET-L4",
                             settlement_date=D(2026, 8, 1), status="SETTLED"))
    db.commit()
    acct_id = acct.id
    db.close()
    app.dependency_overrides[get_db] = lambda: mk()
    c = TestClient(app)
    tok = c.post("/api/v1/auth/login", json={"email": "a@t.in", "password": "x"}).json()["data"]["token"]
    h = {"Authorization": f"Bearer {tok}"}
    return c, h, acct_id


BANK_HDR = "Date,Description,Reference,Debit,Credit,Balance"


def _upload_bank(c, h, acct_id, body_lines, name="bank.csv"):
    content = (BANK_HDR + "\n" + "\n".join(body_lines) + "\n").encode()
    return c.post("/api/v1/statements/upload?type=BANK_STATEMENT&provider=HDFC"
                  f"&bank_account_id={acct_id}", files={"file": (name, content, "text/csv")},
                  headers=h)


def _process(c, h, uid):
    return c.post(f"/api/v1/statements/{uid}/process", headers=h)


def _rows(c, h, uid):
    return c.get(f"/api/v1/statements/{uid}/results", headers=h).json()["data"]["rows"]


def test_83_full_match():
    c, h, acct = _env()
    uid = _upload_bank(c, h, acct, ["2026-09-10,Razorpay settlement SET-83,SET-83,,980,50000"]).json()["data"]["id"]
    out = _process(c, h, uid).json()["data"]["counts"]
    assert out["matched"] == 1, out
    r = _rows(c, h, uid)[0]
    assert r["reconciliation_status"] == "MATCHED"
    assert r["expected_amount"] == 980.0
    assert r["difference"] == 0.0


def test_83_mismatch_10():
    c, h, acct = _env()
    uid = _upload_bank(c, h, acct, ["2026-09-10,Razorpay settlement SET-83,SET-83,,970,49990"]).json()["data"]["id"]
    out = _process(c, h, uid).json()["data"]["counts"]
    assert out["mismatch"] == 1, out
    r = _rows(c, h, uid)[0]
    assert r["reconciliation_status"] == "MISMATCH"
    assert abs(r["difference"] - (-10.0)) < 0.01
    s = c.get("/api/v1/reconciliation/bank-summary", headers=h).json()["data"]
    assert s["mismatch"] == 1 and s["expected_settlement"] == "980.00"
    mm = c.get("/api/v1/reconciliation/bank-mismatches", headers=h).json()["data"]["items"]
    assert len(mm) == 1
    m = mm[0]
    for key in ("order_id", "payment", "gateway_settlement_reference", "expected_amount",
                "actual_amount", "bank_reference", "difference"):
        assert any(key in k or k in key for k in m), m
    assert m["order_name"] == "#O83" and m["expected_amount"] == 980.0
    assert m["actual_amount"] == 970.0 and abs(m["difference"] - (-10.0)) < 0.01


def test_l1_exact_utr_beats_amount():
    c, h, acct = _env()
    uid = _upload_bank(c, h, acct, ["2026-09-08,UPI collection UTR-L1,UTR-L1,,975,10000"]).json()["data"]["id"]
    _process(c, h, uid)
    r = _rows(c, h, uid)[0]
    assert r["match_level"] == "L1" and r["reconciliation_status"] == "MISMATCH"
    assert abs(r["difference"] - (-5.0)) < 0.01


def test_l3_amount_date_window_single_candidate():
    c, h, acct = _env()
    uid = _upload_bank(c, h, acct, ["2026-09-11,NEFT credit no ref,,,500,42000"]).json()["data"]["id"]
    _process(c, h, uid)
    r = _rows(c, h, uid)[0]
    assert r["match_level"] == "L3" and r["reconciliation_status"] == "MATCHED"


def test_ambiguous_never_auto_matched():
    c, h, acct = _env()
    uid = _upload_bank(c, h, acct, ["2026-09-12,Settlement credit no ref,,,750,43000"]).json()["data"]["id"]
    _process(c, h, uid)
    r = _rows(c, h, uid)[0]
    assert r["reconciliation_status"] == "POTENTIAL_MATCH", r
    assert r["matched_order_id"] is None


def test_l4_similarity_only_potential():
    c, h, acct = _env()
    uid = _upload_bank(
        c, h, acct, ["2026-09-20,NEFT settlement SET-L4 order OL4 bank credit received,,,1200,45000"],
        name="l4.csv").json()["data"]["id"]
    _process(c, h, uid)
    r = _rows(c, h, uid)[0]
    assert r["reconciliation_status"] == "POTENTIAL_MATCH" and r["match_level"] == "L4", r


def test_reimport_idempotent_and_reprocess_stable():
    c, h, acct = _env()
    body = ["2026-09-10,Razorpay settlement SET-83,SET-83,,980,50000"]
    uid = _upload_bank(c, h, acct, body).json()["data"]["id"]
    assert _process(c, h, uid).json()["data"]["counts"]["matched"] == 1
    again = _process(c, h, uid).json()["data"]["counts"]
    assert again["matched"] == 1  # settled rows never re-matched
    dup = _upload_bank(c, h, acct, body, name="bank2.csv")
    assert dup.status_code == 400 and "STATEMENT_ALREADY_IMPORTED" in dup.text


def test_dry_run_and_summary_counts():
    c, h, acct = _env()
    uid = _upload_bank(c, h, acct, ["2026-09-10,Razorpay settlement SET-83,SET-83,,980,50000"]).json()["data"]["id"]
    dry = c.post(f"/api/v1/statements/{uid}/dry-run", headers=h).json()["data"]
    assert dry["rows"] == 1 and dry["valid"] == 1 and dry["errors"] == 0
    _process(c, h, uid)
    s = c.get("/api/v1/reconciliation/bank-summary?from=2026-09-01T00:00:00%2B00:00"
              "&to=2026-10-01T00:00:00%2B00:00", headers=h).json()["data"]
    assert s["matched"] == 1 and s["actual_bank_credit"] == "980.00" and s["difference"] == "0.00"


def test_desc_similarity_unit():
    from app.services.bank_recon_service import desc_similarity
    assert desc_similarity("NEFT settlement SET-83 bank credit", "settlement SET-83 order credit") > 0.25
    assert desc_similarity("ATM withdrawal cash", "settlement SET-83 order credit") < 0.25
    assert desc_similarity("", "anything") == 0.0


def test_amount_alone_never_hard_matches():
    """No-date fallback: exact amount with a single candidate must not hard-MATCH (#35)."""
    c, h, acct = _env()
    uid = _upload_bank(c, h, acct, [",Cash deposit,,,500,42000"]).json()["data"]["id"]
    _process(c, h, uid)
    r = _rows(c, h, uid)[0]
    assert r["reconciliation_status"] != "MATCHED", r
    assert r["reconciliation_status"] == "UNMATCHED", r
    assert r["matched_order_id"] is None and r["matched_payment_id"] is None


def test_bank_envelope_errors():
    """New INVALID_BANK_ACCOUNT / INVALID_COLUMN_MAP errors use the envelope, not {detail}."""
    c, h, acct = _env()
    content = (BANK_HDR + "\n2026-09-10,Desc,SET-83,,980,1\n").encode()
    bad_acct = c.post("/api/v1/statements/upload?type=BANK_STATEMENT&bank_account_id=nope",
                      files={"file": ("b.csv", content, "text/csv")}, headers=h)
    assert bad_acct.status_code == 400
    body = bad_acct.json()
    assert body["success"] is False and body["error"]["code"] == "INVALID_BANK_ACCOUNT"
    for bad_map in ('{"oops": "Date"}', '{"description": "Nope"}', 'not-json'):
        r = c.post(f"/api/v1/statements/upload?type=BANK_STATEMENT&bank_account_id={acct}"
                   f"&column_map={bad_map}",
                   files={"file": ("b.csv", content, "text/csv")}, headers=h)
        assert r.status_code == 400, (bad_map, r.text)
        assert r.json()["error"]["code"] == "INVALID_COLUMN_MAP", r.text
