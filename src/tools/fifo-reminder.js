const axios = require('axios');
const { calculateFIFO } = require('../fifo_allocator');
const config = require('../config');
const { logger } = require('../logger');
const { addDraft, buildDraftButtons } = require('./whatsapp');
const mcpManager = require('../mcp-manager');

/**
 * Returns the constant payment gateway link.
 */
async function generateClickableUpiLink(upiId, amount, note, rlog) {
    return 'https://tinyurl.com/PaytoManojEnterprises';
}

/**
 * Handle the `send_fifo_reminder` tool call.
 */
async function handleFifoReminder(toolCall, ctx, rlog) {
    const userId = ctx.from.id.toString();
    const { ledgerName, upiId } = toolCall.args;
    const effectiveUpiId = upiId || config.DEFAULT_UPI_ID;
    
    rlog.info(`🧮 FIFO Reminder requested for: ${ledgerName}, UPI: ${effectiveUpiId}`);
    
    const tallyClient = mcpManager.getTallyClient();
    
    // Step 1: Fetch transactions (last 6 months)
    const toDate = new Date().toISOString().split('T')[0];
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const fromDate = sixMonthsAgo.toISOString().split('T')[0];
    
    rlog.info(`Fetching ledger-account: ${ledgerName} from ${fromDate} to ${toDate}`);
    const startFetch = Date.now();
    
    const resTrans = await tallyClient.callTool({
        name: 'ledger-account',
        arguments: { ledgerName, fromDate, toDate }
    });
    
    rlog.tool('ledger-account', { ledgerName, fromDate, toDate }, resTrans.content[0].text, Date.now() - startFetch);
    
    let tableIdObj;
    try {
        tableIdObj = JSON.parse(resTrans.content[0].text);
    } catch (parseErr) {
        throw new Error(`Failed to parse ledger-account response: ${resTrans.content[0].text}`);
    }
    
    if (!tableIdObj || !tableIdObj.tableID) {
        throw new Error(`ledger-account returned invalid tableID or error: ${resTrans.content[0].text}`);
    }
    
    rlog.info(`Querying database for transactions from table ${tableIdObj.tableID}`);
    const startDbQuery = Date.now();
    const dbRes = await tallyClient.callTool({
        name: 'query-database',
        arguments: { sql: `SELECT * FROM ${tableIdObj.tableID} ORDER BY date ASC` }
    });
    
    rlog.tool('query-database', { sql: `SELECT * FROM ${tableIdObj.tableID} ORDER BY date ASC` }, dbRes.content[0].text, Date.now() - startDbQuery);
    
    let transactions;
    try {
        transactions = JSON.parse(dbRes.content[0].text);
    } catch (parseErr) {
        throw new Error(`Failed to parse query-database response: ${dbRes.content[0].text}`);
    }
    
    if (!Array.isArray(transactions)) {
        throw new Error(`query-database response is not an array: ${dbRes.content[0].text}`);
    }
    
    // Step 2: Run FIFO
    const pendingInvoices = calculateFIFO(transactions);
    
    if (pendingInvoices.length === 0) {
        rlog.info(`No pending invoices for ${ledgerName} — fully paid.`);
        return `${ledgerName} का कोई बकाया नहीं है। सभी बिल का भुगतान हो चुका है। ✅`;
    }
    
    const totalPending = pendingInvoices.reduce((sum, inv) => sum + inv.pending_amount, 0);
    rlog.info(`FIFO Result: ${pendingInvoices.length} pending invoices, total ₹${Math.round(totalPending)}`);
    
    // Step 3: Generate Hindi message (Concise & Easy to Read)
    let msgText = `🙏 नमस्ते,\n\nआपका कुल बकाया: *₹${Math.round(totalPending).toLocaleString('en-IN')}*\n\n📋 *बकाया बिल विवरण:*\n`;
    
    for (const inv of pendingInvoices) {
        const d = inv.date;
        const formattedDate = d.length === 8 
            ? `${d.substring(6,8)}/${d.substring(4,6)}/${d.substring(0,4)}`
            : d; // already formatted
        
        const billAmt = Math.round(inv.pending_amount);
        
        if (pendingInvoices.length === 1) {
            // Only 1 bill: show payment link directly on the bill line
            const note = `Bill ${inv.voucher_number}`;
            const payLink = await generateClickableUpiLink(effectiveUpiId, billAmt, note, rlog);
            msgText += `• बिल ${inv.voucher_number} (${formattedDate}): ₹${billAmt.toLocaleString('en-IN')} [${inv.days_old} दिन]\n🔗 *भुगतान करने के लिए यहाँ क्लिक करें:* ${payLink}\n`;
        } else {
            // Multiple bills: show concise single line for each
            msgText += `• बिल ${inv.voucher_number} (${formattedDate}): ₹${billAmt.toLocaleString('en-IN')} [${inv.days_old} दिन]\n`;
        }
    }
    
    if (pendingInvoices.length > 1) {
        // Multiple bills: show single combined payment link at the bottom
        const totalNote = `Payment for Bills: ${pendingInvoices.map(i => i.voucher_number).filter(n => n && n !== '-').join(', ')}`.substring(0, 50);
        const totalPayLink = await generateClickableUpiLink(effectiveUpiId, totalPending, totalNote, rlog);
        msgText += `\n🔗 *कुल भुगतान करने के लिए यहाँ क्लिक करें:* ${totalPayLink}\n`;
    }
    
    msgText += `\nकृपया जल्द से जल्द भुगतान करें। धन्यवाद! 🙏`;
    
    // Step 4: Waterfall phone number resolution
    let phoneNumber = (toolCall.args && toolCall.args.phone) ? toolCall.args.phone : null;
    if (phoneNumber) {
        phoneNumber = String(phoneNumber).replace(/[\s-]/g, '').trim();
        if (/^\d{10}$/.test(phoneNumber)) phoneNumber = '+91' + phoneNumber;
        rlog.info(`📞 Phone from arguments: ${phoneNumber}`);
    }
    
    // 4a. Try Tally (pipeline-outstanding-balance returns mobile)
    if (!phoneNumber) {
        try {
            rlog.info(`Looking up phone number from Tally for: ${ledgerName}`);
            const startPhone = Date.now();
            const balRes = await tallyClient.callTool({
                name: 'pipeline-outstanding-balance',
                arguments: { 
                    ledgerName,
                    nature: 'receivable',
                    toDate: new Date().toISOString().split('T')[0]
                }
            });
            
            if (balRes && balRes.content && balRes.content.length > 0) {
                const balText = balRes.content[0].text || '';
                rlog.tool('pipeline-outstanding-balance', { ledgerName }, balText, Date.now() - startPhone);
                
                // Extract mobile from the response
                const mobileMatch = balText.match(/Mobile[:\s]*([+\d][\d\s-]{8,})/i);
                if (mobileMatch) {
                    phoneNumber = mobileMatch[1].replace(/[\s-]/g, '').trim();
                    if (/^\d{10}$/.test(phoneNumber)) phoneNumber = '+91' + phoneNumber;
                    rlog.info(`📞 Phone from Tally: ${phoneNumber}`);
                }
            } else {
                rlog.warn(`pipeline-outstanding-balance returned empty content`);
            }
        } catch (e) {
            rlog.warn(`Tally phone lookup failed: ${e.message}`);
        }
    }
    
    // 4b. Try WhatsApp contact search
    if (!phoneNumber) {
        try {
            const waClient = mcpManager.getWhatsAppClient();
            if (waClient) {
                rlog.info(`Looking up phone number from WhatsApp for: ${ledgerName}`);
                const startWa = Date.now();
                const waRes = await waClient.callTool({
                    name: 'search_contacts',
                    arguments: { query: ledgerName.split(' ')[0] } // first name only
                });
                
                if (waRes && waRes.content && waRes.content.length > 0) {
                    const waText = waRes.content[0].text || '';
                    rlog.tool('search_contacts', { query: ledgerName.split(' ')[0] }, waText, Date.now() - startWa);
                    
                    const waPhoneMatch = waText.match(/(\+?\d{10,13})/);
                    if (waPhoneMatch) {
                        phoneNumber = waPhoneMatch[1];
                        rlog.info(`📞 Phone from WhatsApp: ${phoneNumber}`);
                    }
                } else {
                    rlog.info(`WhatsApp search_contacts returned empty content`);
                }
            }
        } catch (e) {
            rlog.warn(`WhatsApp phone lookup failed: ${e.message}`);
        }
    }
    
    // Step 5: Queue as WhatsApp draft
    if (phoneNumber) {
        const draftId = addDraft(userId, 'send_message', {
            contact: phoneNumber,
            message: msgText,
        });
        
        const buttons = buildDraftButtons(draftId);
        await ctx.reply(
            `📋 *${ledgerName} के लिए Payment Reminder Draft:*\n📞 ${phoneNumber}\n\n${msgText}`,
            { parse_mode: 'Markdown', ...buttons }
        );
        
        return `FIFO Draft generated (ID: ${draftId}) for ${ledgerName} → ${phoneNumber}. User must tap Approve to send.`;
    } else {
        // 4c. No phone found — show draft and ask user for number
        await ctx.reply(
            `📋 *${ledgerName} के लिए Payment Reminder Draft:*\n\n${msgText}\n\n⚠️ *फोन नंबर नहीं मिला।* कृपया कस्टमर का WhatsApp नंबर बताएं (जैसे: +919876543210)`,
            { parse_mode: 'Markdown' }
        );
        
        return `FIFO Draft generated for ${ledgerName} but no phone number found. Ask the user to provide the customer's WhatsApp number.`;
    }
}

module.exports = { handleFifoReminder, generateClickableUpiLink };
