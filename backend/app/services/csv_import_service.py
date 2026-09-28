"""Parse Shopify orders-export CSV into API-shaped order payloads. Pure: no DB."""
import csv
import io
from datetime import datetime, timezone

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 5000

FINANCIAL = {"paid": "paid", "refunded": "refunded", "pending": "pending",
             "voided": "voided", "authorized": "authorized", "partially_paid": "partially_paid",
             "partially_refunded": "partially_refunded", "partially refunded": "partially_refunded"}
FULFILL = {"unfulfilled": "unfulfilled", "fulfilled": "fulfilled", "partial": "partial",
           "partially_fulfilled": "partial", "restocked": "unfulfilled"}


class FileTooLarge(Exception):
    pass


def _dt(raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M %z", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_shopify_csv(content: bytes):
    if len(content) > MAX_BYTES:
        raise FileTooLarge(f"File exceeds {MAX_BYTES} bytes.")
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    groups: dict[str, dict] = {}
    order: list[str] = []
    errors: list[dict] = []
    warnings: list[dict] = []
    for lineno, row in enumerate(reader, start=2):
        if lineno - 1 > MAX_ROWS:
            raise FileTooLarge(f"File exceeds {MAX_ROWS} rows.")
        name = (row.get("Name") or "").strip()
        if not name:
            errors.append({"row": lineno, "name": "", "reason": "Missing order Name."})
            continue
        if name not in groups:
            sid = (row.get("Id") or "").strip()
            fin = (row.get("Financial Status") or "pending").strip().lower()
            ful = (row.get("Fulfillment Status") or "unfulfilled").strip().lower()
            if fin not in FINANCIAL:
                warnings.append({"row": lineno, "name": name, "reason": f"Unknown financial status '{fin}', defaulted to pending."})
            if ful not in FULFILL:
                warnings.append({"row": lineno, "name": name, "reason": f"Unknown fulfillment status '{ful}', defaulted to unfulfilled."})
            created = _dt(row.get("Created at", ""))
            if row.get("Created at", "").strip() and created is None:
                warnings.append({"row": lineno, "name": name, "reason": "Unparseable Created at, using import time."})
            cancelled = _dt(row.get("Cancelled at", ""))
            email = (row.get("Email") or "").strip() or None
            phone = (row.get("Phone") or "").strip() or None
            bname = (row.get("Billing Name") or row.get("Shipping Name") or "").strip()
            parts = bname.split(None, 1)
            groups[name] = {
                "id": f"gid://shopify/Order/{sid}" if sid else f"csv:{name}",
                "name": name,
                "currency": (row.get("Currency") or "INR").strip() or "INR",
                "subtotal": (row.get("Subtotal") or "0").strip(),
                "total_discounts": (row.get("Discount Amount") or "0").strip(),
                "total_shipping": (row.get("Shipping") or "0").strip(),
                "total_tax": (row.get("Taxes") or "0").strip(),
                "total_price": (row.get("Total") or "0").strip(),
                "financial_status": FINANCIAL.get(fin, "pending"),
                "fulfillment_status": FULFILL.get(ful, "unfulfilled"),
                "created_at": row.get("Created at", "").strip(),
                "cancelled_at": row.get("Cancelled at", "").strip() or None,
                "cancel_reason": "imported cancelled" if (row.get("Cancelled at") or "").strip() else None,
                "refunded_amount": (row.get("Refunded Amount") or "0").strip(),
                "payment_method": (row.get("Payment Method") or "").strip() or None,
                "customer": {"id": None, "first_name": parts[0] if parts else "",
                             "email": email, "phone": phone},
                "line_items": [],
            }
            order.append(name)
        g = groups[name]
        title = (row.get("Lineitem name") or "").strip()
        if not title:
            continue
        try:
            qty = int(float(row.get("Lineitem quantity") or 1))
        except ValueError:
            errors.append({"row": lineno, "name": name, "reason": f"Bad lineitem quantity '{row.get('Lineitem quantity')}'."})
            continue
        g["line_items"].append({"title": title, "sku": (row.get("Lineitem sku") or "").strip() or None,
                                "quantity": qty, "price": (row.get("Lineitem price") or "0").strip()})
    return [groups[n] for n in order], errors + warnings
