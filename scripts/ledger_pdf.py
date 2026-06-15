# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "reportlab",
# ]
# ///
import sys
import json
import logging
import os
import re
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT

# --- LOGGING SETUP ---
logging.basicConfig(
    filename='logs/pdf_gen.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# --- CONFIGURATION ---

def format_amount(value):
    """Formats numeric values into absolute accounting format."""
    try:
        val = float(value)
        return f"{abs(val):,.2f}"
    except (ValueError, TypeError):
        return str(value)

def clean_text(text):
    """Removes or replaces problematic characters that cause PDF gibberish."""
    if not text: return ""
    return text.encode('ascii', 'ignore').decode('ascii')

def simplify_voucher_type(vtype):
    """Simplifies long voucher type names into clean categories."""
    vtype_lower = vtype.lower()
    if 'sale' in vtype_lower: return 'Sales'
    if 'receipt' in vtype_lower: return 'Receipt'
    if 'payment' in vtype_lower: return 'Payment'
    if 'purchase' in vtype_lower: return 'Purchase'
    if 'contra' in vtype_lower: return 'Contra'
    if 'journal' in vtype_lower: return 'Journal'
    if 'debit note' in vtype_lower: return 'Debit Note'
    if 'credit note' in vtype_lower: return 'Credit Note'
    return vtype[:15] # Fallback to first 15 chars if not matched

def generate_pdf(data, output_path):
    doc = SimpleDocTemplate(
        output_path, 
        pagesize=A4,
        rightMargin=30,
        leftMargin=30,
        topMargin=30,
        bottomMargin=30
    )
    
    styles = getSampleStyleSheet()
    
    # --- CUSTOM STYLES ---
    company_style = ParagraphStyle(
        'CompanyTitle',
        fontSize=22,
        textColor=colors.HexColor("#2B3A67"),
        spaceAfter=8,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER
    )
    
    report_title_style = ParagraphStyle(
        'ReportTitle',
        fontSize=14,
        textColor=colors.HexColor("#495057"),
        fontName="Helvetica",
        alignment=TA_CENTER,
        spaceAfter=15
    )

    story = []

    # --- TOP HEADER: COMPANY NAME ---
    company_name = data.get('companyName', 'Your Tally Company').upper()
    story.append(Paragraph(company_name, company_style))
    story.append(Paragraph("LEDGER STATEMENT", report_title_style))
    
    # --- PARTY DETAILS ---
    ledger_name = data.get('ledgerName', 'N/A')
    ledger_mobile = data.get('ledgerMobile', '')
    ledger_address = data.get('ledgerAddress', '')
    
    party_details_html = f"<font color='#212529'><b>{ledger_name}</b></font>"
    if ledger_mobile:
        party_details_html += f"<br/><font size=9 color='#6C757D'>Mob: {ledger_mobile}</font>"
    if ledger_address:
        party_details_html += f"<br/><font size=9 color='#6C757D'>Add: {ledger_address}</font>"

    party_info = [
        [
            Paragraph(party_details_html, styles['Normal']),
            Paragraph(f"<font color='#6C757D'><b>Period:</b></font> <font color='#212529'>{data.get('fromDate', 'N/A')} to {data.get('toDate', 'N/A')}</font>", styles['Normal'])
        ]
    ]
    info_table = Table(party_info, colWidths=[3.5 * inch, 3.5 * inch])
    story.append(info_table)
    story.append(Spacer(1, 0.2 * inch))

    # --- SUMMARY BOX ---
    def fmt_bal(val_str):
        try:
            fval = float(val_str)
            return f"{abs(fval):,.2f} {'Dr' if fval < 0 else 'Cr' if fval > 0 else ''}"
        except:
            return clean_text(str(val_str))

    ob = fmt_bal(data.get('openingBalance', '0.00'))
    cb = fmt_bal(data.get('closingBalance', '0.00'))
    
    summary_data = [
        [
            Paragraph("<b>Opening Balance</b>", styles['Normal']),
            Paragraph("<b>Closing Balance</b>", styles['Normal'])
        ],
        [
            Paragraph(f"<font size=12 color='#2B3A67'><b>{ob}</b></font>", styles['Normal']),
            Paragraph(f"<font size=12 color='#2B3A67'><b>{cb}</b></font>", styles['Normal'])
        ]
    ]
    
    summary_table = Table(summary_data, colWidths=[3.5 * inch, 3.5 * inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F8F9FA")),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#DEE2E6")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#DEE2E6")),
        ('PADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 0.3 * inch))

    # --- TRANSACTION TABLE ---
    table_data = [["Date", "Type", "Vch No.", "Narration", "Debit", "Credit"]]
    
    total_debit = 0.0
    total_credit = 0.0

    transactions = data.get('transactions', [])
    for tx in transactions:
        raw_amt = 0
        try:
            raw_amt = float(tx.get('amount', 0))
        except:
            pass

        debit_str = ""
        credit_str = ""
        if raw_amt < 0:
            total_debit += abs(raw_amt)
            debit_str = f"{abs(raw_amt):,.2f}"
        elif raw_amt > 0:
            total_credit += raw_amt
            credit_str = f"{abs(raw_amt):,.2f}"

        vtype = simplify_voucher_type(tx.get('voucher_type', ''))
        
        date_str = tx.get('date', '')
        if date_str and len(date_str) > 10:
            date_str = date_str[:10]

        table_data.append([
            date_str,
            vtype,
            tx.get('voucher_number', ''),
            Paragraph(tx.get('narration', '')[:100] if tx.get('narration') else "", styles['Normal']),
            Paragraph(f"<b>{debit_str}</b>", ParagraphStyle('Right', parent=styles['Normal'], alignment=TA_RIGHT)),
            Paragraph(f"<b>{credit_str}</b>", ParagraphStyle('Right', parent=styles['Normal'], alignment=TA_RIGHT))
        ])

    # Append Current Total
    table_data.append([
        "", "", "", 
        Paragraph("<b>Current Total</b>", ParagraphStyle('Right', parent=styles['Normal'], alignment=TA_RIGHT)), 
        Paragraph(f"<b>{total_debit:,.2f}</b>", ParagraphStyle('Right', parent=styles['Normal'], alignment=TA_RIGHT)), 
        Paragraph(f"<b>{total_credit:,.2f}</b>", ParagraphStyle('Right', parent=styles['Normal'], alignment=TA_RIGHT))
    ])

    # Append Closing Balance at the end of the table
    cb_val = clean_text(str(data.get('closingBalance', '0.00')))
    try:
        cb_float = float(cb_val)
        cb_fmt = f"{abs(cb_float):,.2f} {'Dr' if cb_float < 0 else 'Cr' if cb_float > 0 else ''}"
    except:
        cb_fmt = cb_val

    table_data.append([
        "", "", "", 
        Paragraph("<b>Closing Balance</b>", ParagraphStyle('Right', parent=styles['Normal'], alignment=TA_RIGHT)), 
        "", 
        Paragraph(f"<b>{cb_fmt}</b>", ParagraphStyle('Right', parent=styles['Normal'], alignment=TA_RIGHT))
    ])

    # Table Widths
    t = Table(table_data, colWidths=[0.8*inch, 0.9*inch, 0.8*inch, 2.7*inch, 1.1*inch, 1.1*inch], repeatRows=1)
    
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#2B3A67")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8F9FA")]),
        ('GRID', (0, 1), (-1, -1), 0.25, colors.lightgrey),
        ('LINEBELOW', (0, 0), (-1, 0), 1, colors.HexColor("#2B3A67")),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
    ]))
    
    story.append(t)

    # --- FOOTER ---
    def add_footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica-Oblique', 8)
        canvas.setStrokeColor(colors.lightgrey)
        canvas.line(30, 30, 565, 30)
        now = datetime.now().strftime("%d-%b-%Y %H:%M")
        canvas.drawString(30, 20, f"System Generated Statement | {now}")
        canvas.drawRightString(565, 20, f"Page {doc.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)

if __name__ == "__main__":
    try:
        input_data = json.load(sys.stdin)
        output_file = sys.argv[1] if len(sys.argv) > 1 else "statement.pdf"
        logging.info(f"Generating PDF for {input_data.get('ledgerName')} in {output_file}")
        generate_pdf(input_data, output_file)
        print(f"SUCCESS: {output_file}")
    except Exception as e:
        logging.error(f"PDF Error: {str(e)}", exc_info=True)
        print(f"ERROR: {str(e)}", file=sys.stderr)
        sys.exit(1)
