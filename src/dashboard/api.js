const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('../config');
const { logger } = require('../logger');
const { getPendingDrafts, updateDraftStatus, getDraftById, getToolLogs } = require('../db');
const mcpManager = require('../mcp-manager');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../dashboard')));

// --- Voucher Drafts ---

app.get('/api/drafts', async (req, res) => {
    try {
        const drafts = await getPendingDrafts();
        res.json(drafts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/drafts/:id/approve', async (req, res) => {
    try {
        const id = req.params.id;
        const draft = await getDraftById(id);
        if (!draft) return res.status(404).json({ error: 'Draft not found' });
        
        const toolResponse = await tallyClient.callTool({
            name: 'create-voucher',
            arguments: {
                voucherType: draft.voucher_type,
                date: draft.date || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
                creditLedger: draft.credit_ledger,
                debitLedger: draft.debit_ledger,
                amount: draft.amount,
                narration: draft.narration,
                discountLedger: draft.discount_ledger || undefined,
                discountAmount: draft.discount_amount ? parseFloat(draft.discount_amount) : undefined,
                voucherNumber: draft.voucher_number || undefined
            }
        });
        
        const responseText = toolResponse.content.map(c => c.text).join('\n');
        if (responseText.includes('<CREATED>1</CREATED>') || !responseText.includes('<LINEERROR>')) {
            await updateDraftStatus(id, 'approved', responseText);
            res.json({ success: true, message: 'Posted to Tally', tallyResponse: responseText });
        } else {
            await updateDraftStatus(id, 'failed', responseText);
            res.status(500).json({ error: 'Failed to post to Tally', details: responseText });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/drafts/:id/cancel', async (req, res) => {
    try {
        await updateDraftStatus(req.params.id, 'cancelled');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Update Draft ---
app.put('/api/drafts/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const { voucher_type, date, credit_ledger, debit_ledger, amount, narration, discount_ledger, discount_amount, voucher_number } = req.body;
        
        const { updateDraftContent } = require('../db');
        await updateDraftContent(id, {
            voucher_type,
            date,
            credit_ledger,
            debit_ledger,
            amount: parseFloat(amount) || 0,
            narration,
            discount_ledger,
            discount_amount: parseFloat(discount_amount) || 0,
            voucher_number
        });
        res.json({ success: true, message: 'Draft updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Bulk Update Drafts ---
app.post('/api/drafts/bulk-update', async (req, res) => {
    try {
        const { drafts } = req.body;
        if (!Array.isArray(drafts)) {
            return res.status(400).json({ error: 'drafts must be an array' });
        }
        const { updateDraftContent } = require('../db');
        for (const draft of drafts) {
            await updateDraftContent(draft.id, {
                voucher_type: draft.voucher_type,
                date: draft.date,
                credit_ledger: draft.credit_ledger,
                debit_ledger: draft.debit_ledger,
                amount: parseFloat(draft.amount) || 0,
                narration: draft.narration,
                discount_ledger: draft.discount_ledger,
                discount_amount: parseFloat(draft.discount_amount) || 0,
                voucher_number: draft.voucher_number
            });
        }
        res.json({ success: true, message: 'Drafts updated successfully in bulk' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Bulk Approve Drafts ---
app.post('/api/drafts/bulk-approve', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
            return res.status(400).json({ error: 'ids must be an array' });
        }
        
        const tallyClient = mcpManager.getTallyClient();
        if (!tallyClient) {
            return res.status(500).json({ error: 'Tally client not connected' });
        }
        
        const results = [];
        for (const id of ids) {
            try {
                const draft = await getDraftById(id);
                if (!draft) {
                    results.push({ id, success: false, error: 'Draft not found' });
                    continue;
                }
                
                const toolResponse = await tallyClient.callTool({
                    name: 'create-voucher',
                    arguments: {
                        voucherType: draft.voucher_type,
                        date: draft.date || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
                        creditLedger: draft.credit_ledger,
                        debitLedger: draft.debit_ledger,
                        amount: draft.amount,
                        narration: draft.narration,
                        discountLedger: draft.discount_ledger || undefined,
                        discountAmount: draft.discount_amount ? parseFloat(draft.discount_amount) : undefined,
                        voucherNumber: draft.voucher_number || undefined
                    }
                });
                
                const responseText = toolResponse.content.map(c => c.text).join('\n');
                if (responseText.includes('<CREATED>1</CREATED>') || !responseText.includes('<LINEERROR>')) {
                    await updateDraftStatus(id, 'approved', responseText);
                    results.push({ id, success: true, message: 'Posted to Tally' });
                } else {
                    await updateDraftStatus(id, 'failed', responseText);
                    results.push({ id, success: false, error: 'Failed to post to Tally', details: responseText });
                }
            } catch (err) {
                results.push({ id, success: false, error: err.message });
            }
        }
        res.json({ success: true, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Bulk Cancel Drafts ---
app.post('/api/drafts/bulk-cancel', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
            return res.status(400).json({ error: 'ids must be an array' });
        }
        for (const id of ids) {
            await updateDraftStatus(id, 'cancelled');
        }
        res.json({ success: true, message: 'Drafts cancelled in bulk' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Fetch Ledgers from Tally ---
app.get('/api/ledgers', async (req, res) => {
    try {
        const tallyClient = mcpManager.getTallyClient();
        if (!tallyClient) {
            return res.json([]);
        }
        const toolResponse = await tallyClient.callTool({
            name: 'list-master',
            arguments: {
                collection: 'ledger'
            }
        });
        const responseText = toolResponse.content.map(c => c.text).join('\n');
        const data = JSON.parse(responseText);
        res.json(data.list || []);
    } catch (err) {
        logger.error(`Error loading ledgers from Tally: ${err.message}`);
        res.json([]); // Return empty fallback to avoid crashing dashboard if Tally is offline
    }
});

// --- Tool Logs ---

app.get('/api/logs', async (req, res) => {
    try {
        const { limit = 100, offset = 0, toolName, requestId, status } = req.query;
        const logs = await getToolLogs({ limit: parseInt(limit), offset: parseInt(offset), toolName, requestId, status });
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/logs/:requestId', async (req, res) => {
    try {
        const logs = await getToolLogs({ requestId: req.params.requestId, limit: 100 });
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- UPI Redirection ---

app.get('/pay', (req, res) => {
    try {
        const { pa, am, tn, mam, cu = 'INR' } = req.query;
        if (!pa) return res.status(400).send('Missing payee address (pa)');
        
        // Construct the upi:// link with mam=1 by default to allow amount customization in UPI apps
        const effectiveMam = mam || '1';
        const upiLink = `upi://pay?pa=${pa}&am=${am || ''}&mam=${effectiveMam}&cu=${cu}&tn=${encodeURIComponent(tn || '')}`;
        
        // Redirect client to open their native mobile UPI app chooser
        res.redirect(302, upiLink);
    } catch (err) {
        res.status(500).send(`Redirection error: ${err.message}`);
    }
});

// --- Start ---

function startDashboard() {
    app.listen(config.DASHBOARD_PORT, () => {
        logger.info(`🌐 Dashboard API running on port ${config.DASHBOARD_PORT}`);
    });
    return app;
}

module.exports = { startDashboard, app };
