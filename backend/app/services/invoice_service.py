"""GST Tax Invoice PDF Generator Service using ReportLab."""

from __future__ import annotations

import io
from datetime import datetime
from decimal import Decimal

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy.orm import Session

from app.models.business import Business
from app.models.customer import Customer
from app.models.order import Order, OrderItem


def number_to_words_indian(amount: float) -> str:
    """Convert amount in INR to Indian Rupee Words format."""
    units = [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
        "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
    ]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def _convert_below_thousand(n: int) -> str:
        if n < 20:
            return units[n]
        elif n < 100:
            return tens[n // 10] + (" " + units[n % 10] if n % 10 != 0 else "")
        else:
            return units[n // 100] + " Hundred" + (" " + _convert_below_thousand(n % 100) if n % 100 != 0 else "")

    rupees = int(abs(amount))
    paise = int(round((abs(amount) - rupees) * 100))

    if rupees == 0:
        words = "Zero Rupees"
    else:
        parts = []
        crore = rupees // 10000000
        rupees %= 10000000
        lakh = rupees // 100000
        rupees %= 100000
        thousand = rupees // 1000
        rupees %= 1000

        if crore > 0:
            parts.append(_convert_below_thousand(crore) + " Crore")
        if lakh > 0:
            parts.append(_convert_below_thousand(lakh) + " Lakh")
        if thousand > 0:
            parts.append(_convert_below_thousand(thousand) + " Thousand")
        if rupees > 0:
            parts.append(_convert_below_thousand(rupees))
        words = "Rupees " + " ".join(parts)

    if paise > 0:
        words += " and " + _convert_below_thousand(paise) + " Paise"
    return words + " Only"


def _state_code_from_state(state_name: str | None) -> str:
    """Map common Indian states to standard 2-digit GST state codes."""
    if not state_name:
        return "24"  # Default Gujarat
    s = state_name.strip().lower()
    mapping = {
        "jammu": "01", "kashmir": "01", "himachal": "02", "punjab": "03", "chandigarh": "04",
        "uttarakhand": "05", "haryana": "06", "delhi": "07", "rajasthan": "08", "uttar pradesh": "09",
        "bihar": "10", "sikkim": "11", "arunachal": "12", "nagaland": "13", "manipur": "14",
        "mizoram": "15", "tripura": "16", "meghalaya": "17", "assam": "18", "west bengal": "19",
        "jharkhand": "20", "odisha": "21", "chhattisgarh": "22", "madhya pradesh": "23",
        "gujarat": "24", "daman": "26", "dadra": "26", "maharashtra": "27", "andhra": "37",
        "karnataka": "29", "goa": "30", "lakshadweep": "31", "kerala": "32", "tamil nadu": "33",
        "puducherry": "34", "telangana": "36", "ladakh": "38",
    }
    for k, v in mapping.items():
        if k in s:
            return v
    return "24"


def generate_gst_invoice_pdf(db: Session, business_id: str, order_id: str) -> bytes:
    """Generate a complete, GST-compliant tax invoice PDF for an order."""
    order = db.query(Order).filter_by(id=order_id).first()
    if order is None:
        raise ValueError(f"Order {order_id} not found")

    business = db.get(Business, business_id) or db.query(Business).first()
    customer = db.get(Customer, order.customer_id) if order.customer_id else None

    # Line items
    items = db.query(OrderItem).filter_by(order_id=order.id).all()

    # Business / Seller Info (Original Store Details)
    seller_name = (
        (business.name if business and business.name and "demo" not in business.name.lower() else None)
        or order.sender_name
        or "Reshamgath"
    )
    seller_address = (
        (business.address if business and business.address else None)
        or "FF-138/139, 2nd Floor, Rajhans Imperia, Ring Road, Surat, Gujarat - 395002"
    )
    seller_state = order.sender_state or "Gujarat"
    seller_state_code = (business.state_code if business and business.state_code else None) or "24"
    seller_gstin = (business.gstin if business and business.gstin else None) or "24AAACR1234A1Z5"
    seller_phone = "+91 9016822651"
    seller_email = (business.email if business and business.email and "demo" not in business.email.lower() else None) or "reshamgath@gmail.com"

    # Buyer / Customer Info (Exact Details)
    cust_full_name = f"{customer.first_name} {customer.last_name}".strip() if customer else ""
    buyer_name = (order.receiver_name or cust_full_name or "Valued Customer").strip()
    buyer_phone = order.receiver_mobile or (customer.phone if customer else "") or ""
    buyer_email = order.receiver_email or (customer.email if customer else "") or ""
    buyer_state = order.receiver_state or seller_state
    buyer_pincode = order.receiver_pincode or ""
    buyer_company = order.receiver_company or ""
    buyer_gstin = getattr(customer, "gstin", None) or "URP (Unregistered)"

    # Comprehensive Address
    address_parts = [
        part.strip() for part in [
            buyer_company,
            order.receiver_add1,
            order.receiver_add2,
            order.receiver_city,
            f"{buyer_state} - {buyer_pincode}" if buyer_state and buyer_pincode else (buyer_state or buyer_pincode)
        ] if part and str(part).strip()
    ]
    buyer_address_full = ", ".join(address_parts) if address_parts else (order.receiver_city or "India")

    # Jurisdiction (Intrastate vs Interstate)
    is_interstate = (buyer_state.strip().lower() != seller_state.strip().lower())
    place_of_supply = f"{buyer_state} ({_state_code_from_state(buyer_state)})"

    # Invoice Metadata
    invoice_no = f"INV/{datetime.now().strftime('%Y')}/{(order.shopify_order_name or order.internal_order_number or order.id).replace('#', '')}"
    invoice_date = order.order_date.strftime("%d-%b-%Y") if order.order_date else datetime.now().strftime("%d-%b-%Y")
    order_ref = order.shopify_order_name or order.internal_order_number or f"ORD-{order.id[:8]}"

    # PDF Document setup
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )
    styles = getSampleStyleSheet()

    # Custom typography styles
    style_title = ParagraphStyle(
        "InvoiceTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#0f172a"),
        alignment=2,  # Right aligned
    )
    style_subtitle = ParagraphStyle(
        "InvoiceSubTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#047857"),
        alignment=2,
    )
    style_seller = ParagraphStyle(
        "SellerName",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=16,
        textColor=colors.HexColor("#0f172a"),
    )
    style_body = ParagraphStyle(
        "BodyTextCustom",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#334155"),
    )
    style_body_bold = ParagraphStyle(
        "BodyBoldCustom",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#0f172a"),
    )
    style_header_table = ParagraphStyle(
        "TableHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.white,
        alignment=1,  # Centered
    )
    style_cell = ParagraphStyle(
        "TableCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#1e293b"),
    )
    style_cell_center = ParagraphStyle(
        "TableCellCenter",
        parent=style_cell,
        alignment=1,
    )
    style_cell_right = ParagraphStyle(
        "TableCellRight",
        parent=style_cell,
        alignment=2,
    )

    story = []

    # 1. Header (Seller Info vs Tax Invoice Title)
    header_data = [
        [
            Paragraph(
                f"<b>{seller_name}</b><br/>"
                f"<font size=8 color='#475569'>{seller_address}<br/>"
                f"Phone: <b>{seller_phone}</b> | Email: <b>{seller_email}</b><br/>"
                f"GSTIN: <b>{seller_gstin}</b> | State: {seller_state} (Code: {seller_state_code})</font>",
                style_seller,
            ),
            [
                Paragraph("TAX INVOICE", style_title),
                Paragraph("(Issued under Rule 46 of CGST Rules, 2017)", style_subtitle),
            ],
        ]
    ]
    header_table = Table(header_data, colWidths=[320, 202])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e2e8f0"), spaceBefore=0, spaceAfter=8))

    # 2. Meta Info Bar (Invoice No, Date, Order No, Place of Supply)
    meta_data = [
        [
            Paragraph(f"<b>Invoice No:</b> {invoice_no}", style_body),
            Paragraph(f"<b>Invoice Date:</b> {invoice_date}", style_body),
            Paragraph(f"<b>Order No:</b> {order_ref}", style_body),
            Paragraph(f"<b>Place of Supply:</b> {place_of_supply}", style_body),
        ]
    ]
    meta_table = Table(meta_data, colWidths=[130, 120, 120, 152])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 10))

    # 3. Customer Billing & Shipping Address Box
    customer_info_data = [
        [
            Paragraph("<b>DETAILS OF RECEIVER (BILLED TO)</b>", style_body_bold),
            Paragraph("<b>DETAILS OF CONSIGNEE (SHIPPED TO)</b>", style_body_bold),
        ],
        [
            Paragraph(
                f"<b>Customer Name:</b> {buyer_name}<br/>"
                f"<b>Billing Address:</b> {buyer_address_full}<br/>"
                f"<b>Phone:</b> {buyer_phone or 'N/A'}<br/>"
                + (f"<b>Email:</b> {buyer_email}<br/>" if buyer_email else "")
                + f"<b>GSTIN / UIN:</b> {buyer_gstin}",
                style_body,
            ),
            Paragraph(
                f"<b>Consignee Name:</b> {buyer_name}<br/>"
                f"<b>Shipping Address:</b> {buyer_address_full}<br/>"
                f"<b>Contact:</b> {buyer_phone or 'N/A'}<br/>"
                f"<b>State / Destination:</b> {buyer_state} (Code: {_state_code_from_state(buyer_state)})",
                style_body,
            ),
        ]
    ]
    cust_table = Table(customer_info_data, colWidths=[261, 261])
    cust_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(cust_table)
    story.append(Spacer(1, 12))

    # 4. Line Items Table with GST Split
    if is_interstate:
        table_headers = [
            Paragraph("<b>S.No</b>", style_header_table),
            Paragraph("<b>Product Description</b>", style_header_table),
            Paragraph("<b>HSN</b>", style_header_table),
            Paragraph("<b>Qty</b>", style_header_table),
            Paragraph("<b>Unit Price</b>", style_header_table),
            Paragraph("<b>Taxable</b>", style_header_table),
            Paragraph("<b>IGST Rate</b>", style_header_table),
            Paragraph("<b>IGST Amt</b>", style_header_table),
            Paragraph("<b>Total (Rs)</b>", style_header_table),
        ]
        col_widths = [26, 170, 45, 30, 55, 60, 45, 45, 46]
    else:
        table_headers = [
            Paragraph("<b>S.No</b>", style_header_table),
            Paragraph("<b>Product Description</b>", style_header_table),
            Paragraph("<b>HSN</b>", style_header_table),
            Paragraph("<b>Qty</b>", style_header_table),
            Paragraph("<b>Taxable Value</b>", style_header_table),
            Paragraph("<b>CGST</b>", style_header_table),
            Paragraph("<b>SGST</b>", style_header_table),
            Paragraph("<b>Total Tax</b>", style_header_table),
            Paragraph("<b>Total (Rs)</b>", style_header_table),
        ]
        col_widths = [26, 160, 45, 30, 60, 50, 50, 50, 51]

    table_rows = [table_headers]

    tot_taxable = 0.0
    tot_cgst = 0.0
    tot_sgst = 0.0
    tot_igst = 0.0
    tot_amount = 0.0

    if not items:
        # Fallback if no item rows attached
        items_list = [{
            "title": "Order Product Item",
            "hsn": "5007",
            "quantity": 1,
            "price": float(order.total_amount or 0),
        }]
    else:
        items_list = []
        for it in items:
            items_list.append({
                "title": it.title or "Saree / Garment",
                "hsn": getattr(it, "hsn_code", None) or "5007",
                "quantity": it.quantity or 1,
                "price": float(it.price or 0),
                "gst_rate": float(getattr(it, "gst_rate", 5.0) or 5.0),
            })

    for idx, item in enumerate(items_list, 1):
        qty = item["quantity"]
        gross_price = item["price"] * qty
        gst_rate = item.get("gst_rate", 5.0)

        # Calculate GST components (Price is tax inclusive)
        taxable = gross_price / (1.0 + (gst_rate / 100.0))
        tax_amt = gross_price - taxable

        if is_interstate:
            cgst_amt = 0.0
            sgst_amt = 0.0
            igst_amt = tax_amt
        else:
            cgst_amt = tax_amt / 2.0
            sgst_amt = tax_amt / 2.0
            igst_amt = 0.0

        tot_taxable += taxable
        tot_cgst += cgst_amt
        tot_sgst += sgst_amt
        tot_igst += igst_amt
        tot_amount += gross_price

        if is_interstate:
            row = [
                Paragraph(str(idx), style_cell_center),
                Paragraph(f"<b>{item['title']}</b>", style_cell),
                Paragraph(item["hsn"], style_cell_center),
                Paragraph(str(qty), style_cell_center),
                Paragraph(f"Rs {item['price']:.2f}", style_cell_right),
                Paragraph(f"Rs {taxable:.2f}", style_cell_right),
                Paragraph(f"{gst_rate:.1f}%", style_cell_center),
                Paragraph(f"Rs {igst_amt:.2f}", style_cell_right),
                Paragraph(f"Rs {gross_price:.2f}", style_cell_right),
            ]
        else:
            half_rate = gst_rate / 2.0
            row = [
                Paragraph(str(idx), style_cell_center),
                Paragraph(f"<b>{item['title']}</b>", style_cell),
                Paragraph(item["hsn"], style_cell_center),
                Paragraph(str(qty), style_cell_center),
                Paragraph(f"Rs {taxable:.2f}", style_cell_right),
                Paragraph(f"{half_rate:.1f}%<br/>Rs {cgst_amt:.2f}", style_cell_center),
                Paragraph(f"{half_rate:.1f}%<br/>Rs {sgst_amt:.2f}", style_cell_center),
                Paragraph(f"Rs {tax_amt:.2f}", style_cell_right),
                Paragraph(f"Rs {gross_price:.2f}", style_cell_right),
            ]
        table_rows.append(row)

    # Shipping charge addition if any
    shipping_amt = float(order.shipping_amount or 0)
    if shipping_amt > 0:
        ship_taxable = shipping_amt / 1.18
        ship_tax = shipping_amt - ship_taxable
        if is_interstate:
            ship_igst = ship_tax
            ship_cgst = ship_sgst = 0.0
        else:
            ship_cgst = ship_sgst = ship_tax / 2.0
            ship_igst = 0.0

        tot_taxable += ship_taxable
        tot_cgst += ship_cgst
        tot_sgst += ship_sgst
        tot_igst += ship_igst
        tot_amount += shipping_amt

        if is_interstate:
            table_rows.append([
                Paragraph("-", style_cell_center),
                Paragraph("<b>Shipping & Handling Charges</b>", style_cell),
                Paragraph("9968", style_cell_center),
                Paragraph("1", style_cell_center),
                Paragraph(f"Rs {shipping_amt:.2f}", style_cell_right),
                Paragraph(f"Rs {ship_taxable:.2f}", style_cell_right),
                Paragraph("18.0%", style_cell_center),
                Paragraph(f"Rs {ship_igst:.2f}", style_cell_right),
                Paragraph(f"Rs {shipping_amt:.2f}", style_cell_right),
            ])
        else:
            table_rows.append([
                Paragraph("-", style_cell_center),
                Paragraph("<b>Shipping & Handling Charges</b>", style_cell),
                Paragraph("9968", style_cell_center),
                Paragraph("1", style_cell_center),
                Paragraph(f"Rs {ship_taxable:.2f}", style_cell_right),
                Paragraph(f"9.0%<br/>Rs {ship_cgst:.2f}", style_cell_center),
                Paragraph(f"9.0%<br/>Rs {ship_sgst:.2f}", style_cell_center),
                Paragraph(f"Rs {ship_tax:.2f}", style_cell_right),
                Paragraph(f"Rs {shipping_amt:.2f}", style_cell_right),
            ])

    items_table = Table(table_rows, colWidths=col_widths)
    items_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#047857")),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 10))

    # 5. Total Breakdown & Words Summary Box
    total_in_words = number_to_words_indian(tot_amount)

    summary_rows = [
        [
            Paragraph(f"<b>Total Amount in Words:</b><br/>{total_in_words}", style_body),
            Paragraph("<b>Total Taxable Value:</b>", style_body),
            Paragraph(f"Rs {tot_taxable:.2f}", style_cell_right),
        ],
    ]

    if is_interstate:
        summary_rows.append([
            Paragraph("", style_body),
            Paragraph("<b>Total IGST:</b>", style_body),
            Paragraph(f"Rs {tot_igst:.2f}", style_cell_right),
        ])
    else:
        summary_rows.append([
            Paragraph("", style_body),
            Paragraph("<b>Total CGST:</b>", style_body),
            Paragraph(f"Rs {tot_cgst:.2f}", style_cell_right),
        ])
        summary_rows.append([
            Paragraph("", style_body),
            Paragraph("<b>Total SGST:</b>", style_body),
            Paragraph(f"Rs {tot_sgst:.2f}", style_cell_right),
        ])

    summary_rows.append([
        Paragraph(f"<b>Payment Status:</b> {order.financial_status or 'PAID'}<br/>"
                  f"<b>Payment Mode:</b> {order.cod_mode or 'PREPAID'}", style_body),
        Paragraph("<b>Grand Total:</b>", style_body_bold),
        Paragraph(f"<b>Rs {tot_amount:.2f}</b>", ParagraphStyle("GT", parent=style_cell_right, fontName="Helvetica-Bold", fontSize=11, textColor=colors.HexColor("#047857"))),
    ])

    summary_table = Table(summary_rows, colWidths=[300, 120, 102])
    summary_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#f1f5f9")),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('SPAN', (0, 0), (0, -2)),  # Span left words block
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 14))

    # 6. Declaration & Authorized Signatory Footer
    footer_data = [
        [
            Paragraph("<b>Terms & Conditions / Declaration:</b><br/>"
                      "1. We declare that this invoice shows the actual price of the goods described.<br/>"
                      "2. Goods once sold cannot be returned without prior authorization.<br/>"
                      "3. Subject to Surat / Gujarat jurisdiction.", style_body),
            Paragraph(f"For <b>{seller_name}</b><br/><br/><br/>"
                      "<b>Authorized Signatory</b><br/>"
                      "<font size=7 color='#64748b'>(Computer Generated Invoice)</font>", style_body_bold),
        ]
    ]
    footer_table = Table(footer_data, colWidths=[330, 192])
    footer_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(footer_table)

    # Build document
    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
