"""India Post Excel export service matching 19082026.xlsx exact column sequence and formatting."""

from __future__ import annotations

from openpyxl import Workbook

INDIA_POST_HEADERS = [
    "SERIAL NUMBER",
    "BARCODE NO",
    "PHYSICAL WEIGHT",
    "SHAPE OF ARTICLE",
    "LENGTH ",
    "BREADTH/DIAMETER",
    "HEIGHT",
    "PRIORITY FLAG",
    "DELIVERY INSTRUCTION",
    "INSTRUCTION RTS",
    "SENDER NAME",
    "SENDER COMPANY",
    "SENDER ADD LINE 1",
    "SENDER ADD LINE 2",
    "SENDER CITY",
    "SENDER STATE",
    "SENDER PINCODE",
    "SENDER EMAILID",
    "SENDER ALT CONTACT",
    "SENDER KYC",
    "SENDER TAX REFERENCE",
    "RECEIVER NAME",
    "RECEIVER COMPANY",
    "RECEIVER ADD LINE 1",
    "RECEIVER ADD LINE 2",
    "RECEIVER CITY",
    "RECEIVER STATE",
    "RECEIVER PINCODE",
    "RECEIVER EMAILID",
    "RECEIVER ALT CONTACT",
    "RECEIVER KYC",
    "RECEIVER TAX REFERENCE",
    "ALT ADDRESS FLAG",
    "PICKUP ADDRESS FLAG",
    "DROP OFF PINCODE",
    "DROPOFF/PICKUP OFFICE ID",
    "SENDER MOBILE NO",
    "RECEIVER MOBILE NO",
    "PREPAYMENT CODE",
    "VALUE OF PREPAYMENT",
    "CODR/COD",
    "VALUE FOR CODR/COD",
    "INSURANCE TYPE",
    "VALUE OF INSURANCE",
    "ACK",
    "REGISTRATION",
    "OTP BASED DELIVERY",
    "BULK REFERENCE",
]

SENDER_DEFAULTS = {
    "SENDER NAME": "Reshamgath",
    "SENDER ADD LINE 1": "FF-138/139, 2nd Floor, Rajhans Imperia",
    "SENDER ADD LINE 2": "Ring Road",
    "SENDER CITY": "Surat",
    "SENDER STATE": "Gujarat",
    "SENDER PINCODE": 395002,
    "SENDER MOBILE NO": 9016822651,
    "DROP OFF PINCODE": 394210,
}


def _get(o, attr, default=None):
    if isinstance(o, dict):
        return o.get(attr, default)
    return getattr(o, attr, default)


def to_int_or_none(val):
    if val is None or val == "":
        return None
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return None


def to_num_or_none(val):
    if val is None or val == "":
        return None
    try:
        f = float(str(val).strip())
        return int(f) if f.is_integer() else f
    except (ValueError, TypeError):
        return None


def order_to_row(o, serial: int) -> list:
    def _sender_str(key: str, attr: str):
        v = _get(o, attr)
        return str(v) if v not in (None, "") else SENDER_DEFAULTS[key]

    def _sender_int(key: str, attr: str):
        v = _get(o, attr)
        res = to_int_or_none(v)
        return res if res is not None else SENDER_DEFAULTS[key]

    rec_city = _get(o, "receiver_city") or ""
    rec_state = _get(o, "receiver_state") or ""
    rec_add1 = _get(o, "receiver_add1") or rec_city or rec_state or "N/A"
    rec_add2 = _get(o, "receiver_add2") or rec_city or rec_state or ""

    dropoff = to_int_or_none(_get(o, "dropoff_pincode")) or SENDER_DEFAULTS["DROP OFF PINCODE"]

    return [
        serial,                                                          # 1. SERIAL NUMBER
        _get(o, "barcode_no"),                                          # 2. BARCODE NO
        to_num_or_none(_get(o, "weight_grams")) or 930,                 # 3. PHYSICAL WEIGHT
        _get(o, "shape") or "NROL",                                     # 4. SHAPE OF ARTICLE
        to_num_or_none(_get(o, "length_cm")) or 30,                     # 5. LENGTH 
        to_num_or_none(_get(o, "breadth_cm")) or 20,                    # 6. BREADTH/DIAMETER
        to_num_or_none(_get(o, "height_cm")) or 5,                      # 7. HEIGHT
        None,                                                            # 8. PRIORITY FLAG
        None,                                                            # 9. DELIVERY INSTRUCTION
        None,                                                            # 10. INSTRUCTION RTS
        _sender_str("SENDER NAME", "sender_name"),                      # 11. SENDER NAME
        None,                                                            # 12. SENDER COMPANY
        _sender_str("SENDER ADD LINE 1", "sender_add1"),                # 13. SENDER ADD LINE 1
        SENDER_DEFAULTS["SENDER ADD LINE 2"],                            # 14. SENDER ADD LINE 2
        _sender_str("SENDER CITY", "sender_city"),                      # 15. SENDER CITY
        _sender_str("SENDER STATE", "sender_state"),                    # 16. SENDER STATE
        _sender_int("SENDER PINCODE", "sender_pincode"),                # 17. SENDER PINCODE
        None,                                                            # 18. SENDER EMAILID
        None,                                                            # 19. SENDER ALT CONTACT
        None,                                                            # 20. SENDER KYC
        None,                                                            # 21. SENDER TAX REFERENCE
        _get(o, "receiver_name"),                                       # 22. RECEIVER NAME
        _get(o, "receiver_company"),                                    # 23. RECEIVER COMPANY
        rec_add1,                                                        # 24. RECEIVER ADD LINE 1
        rec_add2,                                                        # 25. RECEIVER ADD LINE 2
        rec_city,                                                        # 26. RECEIVER CITY
        rec_state,                                                       # 27. RECEIVER STATE
        to_int_or_none(_get(o, "receiver_pincode")),                    # 28. RECEIVER PINCODE
        _get(o, "receiver_email"),                                      # 29. RECEIVER EMAILID
        None,                                                            # 30. RECEIVER ALT CONTACT
        None,                                                            # 31. RECEIVER KYC
        None,                                                            # 32. RECEIVER TAX REFERENCE
        False,                                                           # 33. ALT ADDRESS FLAG
        False,                                                           # 34. PICKUP ADDRESS FLAG
        dropoff,                                                         # 35. DROP OFF PINCODE
        None,                                                            # 36. DROPOFF/PICKUP OFFICE ID
        _sender_int("SENDER MOBILE NO", "sender_mobile"),                # 37. SENDER MOBILE NO
        to_int_or_none(_get(o, "receiver_mobile")),                     # 38. RECEIVER MOBILE NO
        None,                                                            # 39. PREPAYMENT CODE
        None,                                                            # 40. VALUE OF PREPAYMENT
        _get(o, "cod_mode") or "COD",                                   # 41. CODR/COD
        to_num_or_none(_get(o, "cod_value")) or to_num_or_none(_get(o, "total_amount")), # 42. VALUE FOR CODR/COD
        None,                                                            # 43. INSURANCE TYPE
        None,                                                            # 44. VALUE OF INSURANCE
        False,                                                           # 45. ACK
        None,                                                            # 46. REGISTRATION
        False,                                                           # 47. OTP BASED DELIVERY
        _get(o, "bulk_reference"),                                      # 48. BULK REFERENCE
    ]


def build_workbook(orders) -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "ArticleDetails"
    ws.append(INDIA_POST_HEADERS)
    for i, o in enumerate(orders, start=1):
        ws.append(order_to_row(o, i))
    return wb
