from pathlib import Path


def _content():
    return (Path(__file__).parent / "fixtures" / "orders_export_1.csv").read_bytes()


def test_parse_sample():
    from app.services.csv_import_service import parse_shopify_csv
    payloads, errors = parse_shopify_csv(_content())
    assert errors == []
    assert len(payloads) == 4
    by_name = {p["name"]: p for p in payloads}
    assert by_name["#1004"]["financial_status"] == "refunded"
    assert by_name["#1004"]["id"] == "gid://shopify/Order/7193174442228"
    assert by_name["#1002"]["total_price"] == "25.00" or float(by_name["#1002"]["total_price"]) == 25.0
    assert len(by_name["#1001"]["line_items"]) == 1
    assert by_name["#1001"]["line_items"][0]["quantity"] in (1, "1")


def test_missing_name_skipped():
    from app.services.csv_import_service import parse_shopify_csv
    payloads, errors = parse_shopify_csv(b"Name,Email,Financial Status,Id,Created at,Total\n,,paid,1,2026-09-28 07:00:30 -0400,5.00\n")
    assert payloads == [] and len(errors) == 1 and errors[0]["row"] == 2
