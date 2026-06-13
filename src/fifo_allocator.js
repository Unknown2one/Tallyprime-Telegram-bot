/**
 * FIFO Bill Allocator
 * Calculates pending invoices by allocating credits (receipts) to the oldest debits (sales).
 */

function parseTallyDate(dateStr) {
    if (dateStr && dateStr.length === 8 && /^\d+$/.test(dateStr)) {
        const y = parseInt(dateStr.substring(0, 4));
        const m = parseInt(dateStr.substring(4, 6)) - 1;
        const d = parseInt(dateStr.substring(6, 8));
        return new Date(y, m, d);
    }
    return new Date(dateStr);
}

function calculateFIFO(transactions) {
    let debits = [];
    let totalCredits = 0;

    // Tally often appends the Closing Balance row at the end or start. Filter it out.
    const validTransactions = transactions.filter(t => 
        t.voucher_type && 
        t.voucher_type !== 'Closing Balance' && 
        t.voucher_type !== 'Closing'
    );

    for (const t of validTransactions) {
        // Amount is negative for Debit (Sales/Dr Opening) and positive for Credit (Receipts/Cr Opening)
        const amt = parseFloat(t.amount) || 0;
        
        if (amt < 0) {
            // It's a Debit (Invoice or Opening Balance Dr)
            debits.push({
                date: t.date,
                voucher_type: t.voucher_type,
                voucher_number: t.voucher_number || '-',
                original_amount: Math.abs(amt),
                pending_amount: Math.abs(amt),
                narration: t.narration || ''
            });
        } else if (amt > 0) {
            // It's a Credit (Receipt, Credit Note, Opening Balance Cr)
            totalCredits += amt;
        }
    }

    // Sort debits chronologically just to be safe (oldest first)
    debits.sort((a, b) => parseTallyDate(a.date) - parseTallyDate(b.date));

    // Allocate totalCredits sequentially
    for (let i = 0; i < debits.length; i++) {
        if (totalCredits <= 0) break;

        const debit = debits[i];
        if (totalCredits >= debit.pending_amount) {
            // Fully paid
            totalCredits -= debit.pending_amount;
            debit.pending_amount = 0;
        } else {
            // Partially paid
            debit.pending_amount -= totalCredits;
            totalCredits = 0;
        }
    }

    // Filter out fully paid invoices
    const pendingInvoices = debits.filter(d => d.pending_amount > 0.01);

    // Calculate days outstanding
    const today = new Date();
    today.setHours(0,0,0,0);
    
    pendingInvoices.forEach(inv => {
        const invDate = parseTallyDate(inv.date);
        invDate.setHours(0,0,0,0);
        const diffTime = Math.abs(today - invDate);
        inv.days_old = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    });

    return pendingInvoices;
}

module.exports = { calculateFIFO, parseTallyDate };
