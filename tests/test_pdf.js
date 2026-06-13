const fs = require('fs');
const { execSync } = require('child_process');

const dummyData = {
    "companyName": "MANOJ ENTERPRISES",
    "ledgerName": "Pawan Cloth Store Baler",
    "ledgerMobile": "+91 98290 12345",
    "ledgerAddress": "Main Market, Baler, Rajasthan 322001",
    "fromDate": "2026-04-01",
    "toDate": "2027-03-31",
    "openingBalance": "10000.00",
    "closingBalance": "15500.50",
    "transactions": [
        {
            "date": "2026-05-01",
            "voucher_type": "Sales Automatic Computer",
            "voucher_number": "101",
            "narration": "Being goods sold",
            "amount": 5500.50
        },
        {
            "date": "2026-06-01",
            "voucher_type": "Receipt Book Bank",
            "voucher_number": "102",
            "narration": "Received payment",
            "amount": -5000.00
        }
    ]
};

fs.writeFileSync('test_data.json', JSON.stringify(dummyData));

try {
    execSync('python scripts/ledger_pdf.py test_statement.pdf < test_data.json', { 
        stdio: 'inherit',
        env: process.env
    });
    console.log("PDF generated at test_statement.pdf");
} catch (e) {
    console.error("Error generating PDF:", e.message);
}
