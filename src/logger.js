const winston = require('winston');
const crypto = require('crypto');

/**
 * Structured logger with request-ID tracing and performance timing.
 * 
 * Usage:
 *   const { logger, createRequestLogger } = require('./logger');
 *   const rlog = createRequestLogger(userId);
 *   rlog.tool('search-ledgers', { query: 'Ajay' }, result, 120);
 */

const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const reqId = meta.requestId ? `[${meta.requestId}]` : '';
                    const duration = meta.durationMs ? ` (${meta.durationMs}ms)` : '';
                    return `${timestamp} ${level}: ${reqId} ${message}${duration}`;
                })
            )
        }),
        new winston.transports.File({ filename: 'logs/bot_error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/bot_activity.log' }),
        new winston.transports.File({ filename: 'logs/tool_calls.log', level: 'debug' }),
    ],
});

/**
 * Creates a request-scoped logger that automatically tags every log with a unique request ID.
 */
function createRequestLogger(userId) {
    const requestId = crypto.randomUUID().substring(0, 8);
    
    const rlog = {
        requestId,
        userId,
        
        info: (message, meta = {}) => {
            logger.info(message, { requestId, userId, ...meta });
        },
        
        warn: (message, meta = {}) => {
            logger.warn(message, { requestId, userId, ...meta });
        },
        
        error: (message, meta = {}) => {
            logger.error(message, { requestId, userId, ...meta });
        },
        
        debug: (message, meta = {}) => {
            logger.debug(message, { requestId, userId, ...meta });
        },
        
        /**
         * Log a tool call with full args, result preview, and duration.
         * @param {string} toolName 
         * @param {object} args - Tool arguments (logged in full)
         * @param {string} result - Tool result (truncated to 500 chars for log)
         * @param {number} durationMs - How long the call took
         * @param {'success'|'error'} status
         */
        tool: (toolName, args, result, durationMs, status = 'success') => {
            let finalStatus = status;
            let errorMessage = null;
            
            const resultStr = typeof result === 'string' 
                ? result 
                : (result && result.content ? result.content : JSON.stringify(result || ''));

            if (resultStr.startsWith('Error') || resultStr.startsWith('Failed') || resultStr.includes('<LINEERROR>')) {
                finalStatus = 'error';
                errorMessage = resultStr.substring(0, 500);
            }

            const resultPreview = resultStr.substring(0, 500);
            
            logger.info(`Tool: ${toolName} → ${finalStatus}`, {
                requestId,
                userId,
                toolName,
                toolArgs: args,
                resultPreview,
                durationMs,
                status: finalStatus,
            });

            // Write to SQLite database
            try {
                const { insertToolLog } = require('./db');
                insertToolLog({
                    requestId,
                    userId,
                    toolName,
                    args,
                    result: resultStr,
                    durationMs,
                    status: finalStatus,
                    errorMessage
                }).catch(err => logger.error(`Failed to save tool log to DB: ${err.message}`));
            } catch (dbErr) {
                logger.error(`SQLite db import error in logger: ${dbErr.message}`);
            }
        },
        
        /**
         * Log the user's incoming request.
         */
        request: (userMessage) => {
            const msgPreview = typeof userMessage === 'string' 
                ? userMessage.substring(0, 200) 
                : '[non-text content]';
            logger.info(`📩 Request from ${userId}: ${msgPreview}`, { requestId, userId });
        },
        
        /**
         * Log the final AI response sent to the user.
         */
        response: (finalContent) => {
            const preview = (finalContent || '').substring(0, 300);
            logger.info(`📤 Response to ${userId}: ${preview}`, { requestId, userId });
        },
    };
    
    return rlog;
}

module.exports = { logger, createRequestLogger };
