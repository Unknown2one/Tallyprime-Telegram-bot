require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    TALLY_PORT: process.env.TALLY_PORT || '9000',
    ALLOWED_IDS: (process.env.ALLOWED_USER_ID || '').split(',').map(id => id.trim()),
    LLM_BASE_URL: process.env.LLM_BASE_URL || 'http://127.0.0.1:3001/v1',
    LLM_API_KEY: process.env.LLM_API_KEY || 'freellmapi-bbc68c192e1b1ca83cc9c49eab4e0547b97bf4631d21a5e2',
    LLM_MODEL: process.env.LLM_MODEL || 'auto',
    DEFAULT_UPI_ID: process.env.DEFAULT_UPI_ID || 'mj738561@ybl',
    DASHBOARD_PORT: parseInt(process.env.DASHBOARD_PORT || '3002'),
    SARVAM_API_KEY: process.env.SARVAM_API_KEY || 'sk_f1k75b2i_A1eyCeWzheMI5C6epmyF5NFV',
    DISCOUNT_LEDGER: process.env.DISCOUNT_LEDGER || 'Discount Allowed',
};
