const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'drafts.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS vouchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voucher_type TEXT NOT NULL,
        date TEXT,
        credit_ledger TEXT NOT NULL,
        debit_ledger TEXT NOT NULL,
        amount REAL NOT NULL,
        narration TEXT,
        status TEXT DEFAULT 'pending',
        tally_response TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run("ALTER TABLE vouchers ADD COLUMN discount_ledger TEXT", (err) => {
        // ignore error if column already exists
    });
    db.run("ALTER TABLE vouchers ADD COLUMN discount_amount REAL DEFAULT 0", (err) => {
        // ignore error if column already exists
    });
    db.run("ALTER TABLE vouchers ADD COLUMN voucher_number TEXT", (err) => {
        // ignore error if column already exists
    });
    
    db.run(`CREATE TABLE IF NOT EXISTS tool_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        user_id TEXT,
        tool_name TEXT NOT NULL,
        tool_args TEXT,
        tool_result TEXT,
        duration_ms INTEGER,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

function insertDraft(data) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO vouchers (voucher_type, date, credit_ledger, debit_ledger, amount, narration, discount_ledger, discount_amount, voucher_number)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        db.run(sql, [
            data.voucher_type,
            data.date,
            data.credit_ledger,
            data.debit_ledger,
            data.amount,
            data.narration,
            data.discount_ledger || null,
            data.discount_amount || 0,
            data.voucher_number || null
        ], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
}

function getPendingDrafts() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM vouchers WHERE status IN ('pending', 'failed') ORDER BY created_at DESC", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function updateDraftStatus(id, status, tallyResponse = null) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE vouchers SET status = ?, tally_response = ? WHERE id = ?", [status, tallyResponse, id], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

function updateDraftContent(id, data) {
    return new Promise((resolve, reject) => {
        const sql = `UPDATE vouchers 
                     SET voucher_type = ?, date = ?, credit_ledger = ?, debit_ledger = ?, amount = ?, narration = ?, discount_ledger = ?, discount_amount = ?, voucher_number = ?
                     WHERE id = ?`;
        db.run(sql, [
            data.voucher_type,
            data.date,
            data.credit_ledger,
            data.debit_ledger,
            data.amount,
            data.narration,
            data.discount_ledger || null,
            data.discount_amount || 0,
            data.voucher_number || null,
            id
        ], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

function getDraftById(id) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM vouchers WHERE id = ?", [id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

/**
 * Insert a tool call log entry.
 */
function insertToolLog(data) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT INTO tool_logs (request_id, user_id, tool_name, tool_args, tool_result, duration_ms, status, error_message)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        const args = JSON.stringify(data.args || {});
        const result = typeof data.result === 'string' ? data.result.substring(0, 2000) : JSON.stringify(data.result || '').substring(0, 2000);
        db.run(sql, [data.requestId, data.userId, data.toolName, args, result, data.durationMs, data.status || 'success', data.errorMessage || null], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
}

/**
 * Fetch tool logs with filters.
 */
function getToolLogs({ limit = 100, offset = 0, toolName, requestId, status } = {}) {
    return new Promise((resolve, reject) => {
        let sql = 'SELECT * FROM tool_logs WHERE 1=1';
        const params = [];
        
        if (toolName) { sql += ' AND tool_name = ?'; params.push(toolName); }
        if (requestId) { sql += ' AND request_id = ?'; params.push(requestId); }
        if (status) { sql += ' AND status = ?'; params.push(status); }
        
        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

module.exports = {
    db,
    insertDraft,
    getPendingDrafts,
    updateDraftStatus,
    updateDraftContent,
    getDraftById,
    insertToolLog,
    getToolLogs,
};
