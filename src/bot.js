/**
 * Tally AI Bot v5.0 — Multi-Agent Architecture
 * 
 * This is the slim entry point. All logic is delegated to modules in src/.
 */

const { Telegraf, Markup } = require('telegraf');
const { HumanMessage, SystemMessage, AIMessage, ToolMessage } = require('@langchain/core/messages');
const config = require('./config');
const { logger, createRequestLogger } = require('./logger');
const mcpManager = require('./mcp-manager');
const { model, getSystemPrompt } = require('./llm');
const { getSession, setSessionOptions, getSessionOption } = require('./session');
const { routeToolCall } = require('./tools/router');
const { getDraft, removeDraft } = require('./tools/whatsapp');
const { transcribeVoice } = require('./transcription');
const { processImage } = require('./image-handler');
const { startDashboard } = require('./dashboard/api');
const { insertToolLog } = require('./db');

const bot = new Telegraf(config.BOT_TOKEN);
let openAiToolsGlobal = [];

// ==================== CONCURRENCY LOCKS PER USER ====================

const userLocks = new Map();

/**
 * Acquire concurrency lock for a user.
 * Returns a release function when it is this request's turn to execute.
 * @param {string} userId 
 * @returns {Promise<Function>}
 */
async function acquireUserLock(userId) {
    const previousPromise = userLocks.get(userId) || Promise.resolve();
    
    let resolveLock;
    const currentPromise = new Promise((resolve) => {
        resolveLock = resolve;
    });
    
    userLocks.set(userId, currentPromise);
    
    await previousPromise;
    
    return () => {
        resolveLock();
        if (userLocks.get(userId) === currentPromise) {
            userLocks.delete(userId);
        }
    };
}

// ==================== MANUAL TOOL-CALL PARSER ====================

function parseManualToolCall(content) {
    if (!content) return null;
    if (content.includes('<longcat_tool_call>')) {
        const toolNameMatch = content.match(/<longcat_tool_call>(.*?)[\s\n<]/);
        const toolName = toolNameMatch ? toolNameMatch[1].trim() : null;
        const args = {};
        const keys = [...content.matchAll(/<longcat_arg_key>(.*?)<\/longcat_arg_key>/g)].map(m => m[1]);
        const values = [...content.matchAll(/<longcat_arg_value>(.*?)<\/longcat_arg_value>/g)].map(m => m[1]);
        keys.forEach((key, i) => { args[key] = values[i]; });
        if (toolName) return [{ name: toolName, args, id: 'lc_' + Date.now() }];
    }
    const openAiMatch = content.match(/function<\|tool▁sep\|>([\w-]+)\s+```json\s+({.*?})\s+```/s);
    if (openAiMatch) return [{ name: openAiMatch[1], args: JSON.parse(openAiMatch[2]), id: 'oa_' + Date.now() }];
    return null;
}

// ==================== RESILIENT MARKDOWN REPLY HELPER ====================

async function replyMarkdownSafely(ctx, text, extraArgs) {
    try {
        await ctx.replyWithMarkdown(text, extraArgs);
    } catch (err) {
        logger.warn(`Markdown reply failed, falling back to plain text: ${err.message}`);
        const plainText = text.replace(/[*_`\[\]()]/g, '');
        try {
            await ctx.reply(plainText, extraArgs);
        } catch (fallbackErr) {
            logger.error(`Fallback reply failed: ${fallbackErr.message}`);
            await ctx.reply("माफ करें, संदेश भेजने में कोई समस्या हुई।").catch(() => {});
        }
    }
}

// ==================== DYNAMIC TOOL BINDING ====================

function getRelevantTools(userMsg, allTools) {
    return allTools;
}

// ==================== MAIN MESSAGE HANDLER ====================

async function handleMessage(ctx, userMsg) {
    const userId = ctx.from.id.toString();
    if (!config.ALLOWED_IDS.includes(userId)) return;

    const rlog = createRequestLogger(userId);
    rlog.request(userMsg);

    const releaseLock = await acquireUserLock(userId);
    try {
        try {
            await ctx.sendChatAction('typing');

        // Check if this is a simple search or ledger resolution query
        const lowerMsg = userMsg.toLowerCase().trim();
        const greetings = ['hey', 'hello', 'hi', 'start', 'help', 'hola', 'namaste', 'good morning', 'good afternoon', 'good evening', 'नमस्ते', 'हेलो', 'हाय'];
        const isGreetingOrShort = greetings.includes(lowerMsg) || lowerMsg.length < 3;

        const hasDatePattern = /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(userMsg);
        
        // Match pronouns, verbs, question words, or accounting report terms that indicate an LLM instruction rather than a pure ledger name
        const hasLlmKeyword = /(statement|outstanding|balance|receipt|payment|bill|remind|reminder|voucher|pdf|excel|report|show|list|tell|what|how|get|send|check|create|add|find|query|search|view|draft|upi|cash|bank|group|trial|profit|loss|sheet|stock|item|gst|tax|sale|purchase|entries|ledger|customers|customer|parties|party|companies|company|ledgers|groups|group|kitna|kitne|kitni|kitno|apne|apna|apni|hamare|sabse|jyada|zyada|kam|दिखाओ|बताओ|भेजो|करो|कैसे|कितना|क्या|कब|कौन|लिस्ट|रिपोर्ट|बैलेंस|एंट्री)/i.test(userMsg);
        
        // Match sentence structure indicators (common prepositions, articles, pronouns, particles)
        const isSentence = /\b(is|the|of|in|to|for|on|with|a|an|at|and|or|me|my|our|us|you|your|he|she|they|it|this|that|these|those|ka|ki|ke|ko|se|par|me|aur|ya|details|mai|mein|mei|hai|he|h)\b/i.test(userMsg) ||
                           /[\s\n\r](का|की|के|को|से|पर|में|और|या|se|par|me|aur|ya|details|mai|mein|mei|hai|he|h)[\s\n\r]/i.test(userMsg);

        // If it's a greeting/short message, has a date pattern, contains out-of-the-box keywords, or is a full sentence, it should be processed by the LLM
        const isComplexOrOutOfTheBox = hasDatePattern || hasLlmKeyword || isSentence;

        if (!isGreetingOrShort && !isComplexOrOutOfTheBox) {
            try {
                const { resolveLedger } = require('./ledger-resolver');
                const resolveResult = await resolveLedger(userMsg);
                if (resolveResult.matched) {
                    await sendLedgerMenu(ctx, resolveResult.matched, userId, rlog);
                    return;
                } else if (resolveResult.options && resolveResult.options.length > 0) {
                    setSessionOptions(userId, resolveResult.options);
                    const buttons = resolveResult.options.map((opt, index) => [
                        Markup.button.callback(opt.substring(0, 40), `sel_${index}`)
                    ]);
                    await ctx.reply(`कृपया विकल्प चुनें:`, Markup.inlineKeyboard(buttons));
                    return;
                }
            } catch (resolveErr) {
                rlog.error(`Ledger resolver error: ${resolveErr.message}`);
            }
        }

        const history = getSession(userId);
        if (history.length > 25) {
            history.splice(0, history.length - 25);
        }
        
        const todayDate = new Date().toISOString().split('T')[0];
        const todayDateCompact = todayDate.replace(/-/g, '');
        const systemMsg = new SystemMessage(getSystemPrompt(todayDate, todayDateCompact));

        const userHumanMsg = new HumanMessage(userMsg);
        history.push(userHumanMsg);

        const messages = [systemMsg, ...history];
        const relevantTools = getRelevantTools(userMsg, openAiToolsGlobal);
        const modelWithTools = model.bindTools(relevantTools);

        let statusMsg = null;
        try {
            statusMsg = await ctx.reply('⏳ *AI is analyzing your request...*', { parse_mode: 'Markdown' });
        } catch (e) {}

        let iterations = 0;
        let responseSent = false;
        try {
            while (iterations < 15) {
                let res = await modelWithTools.invoke(messages);

                const manual = parseManualToolCall(res.content);
                if (manual && (!res.tool_calls || res.tool_calls.length === 0)) res.tool_calls = manual;

                if (res.tool_calls && res.tool_calls.length > 0) {
                    history.push(res);
                    messages.push(res);
                    
                    const toolPromises = res.tool_calls.map(async (toolCall) => {
                        rlog.info(`🔧 Dispatching tool: ${toolCall.name}`, { toolArgs: toolCall.args });
                        
                        // Update status message
                        if (statusMsg) {
                            const toolFriendlyName = toolCall.name.replace(/_/g, ' ').replace(/-/g, ' ');
                            ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null,
                                 `🔍 *चल रहा है:* ${toolFriendlyName}...`, { parse_mode: 'Markdown' }
                            ).catch(() => {});
                        }
                        const result = await routeToolCall(toolCall, ctx, rlog, { handleMessageFn: handleMessage, botInstance: bot });
                        return result;
                    });
                    
                    const toolResults = await Promise.all(toolPromises);
                    history.push(...toolResults);
                    messages.push(...toolResults);
                    iterations++;
                } else {
                    const finalContent = (res.content || '').trim();
                    if (finalContent) {
                        rlog.response(finalContent);
                        history.push(new AIMessage(finalContent));

                        let replyText = finalContent;
                        let extraArgs = undefined;
                        const optionsMatch = finalContent.match(/\[?OPTIONS:\s*([^\r\n\]]+)\]?/i);
                        if (optionsMatch) {
                            const rawOptions = optionsMatch[1];
                            const options = rawOptions.split(',').map(s => s.replace(/['"]/g, '').trim());
                            
                            // Cache options to prevent 64-byte Telegram callback data limit error
                            setSessionOptions(userId, options);
                            
                            // Use index keys for callback data
                            const buttons = options.map((opt, index) => [
                                Markup.button.callback(opt.substring(0, 40), `sel_${index}`)
                            ]);
                            extraArgs = Markup.inlineKeyboard(buttons);
                            replyText = finalContent.replace(optionsMatch[0], '').trim();
                            if (!replyText) {
                                replyText = 'कृपया विकल्प चुनें:';
                            }
                        }

                        if (statusMsg) {
                            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
                        }
                        await replyMarkdownSafely(ctx, replyText.replace(/_/g, '\\_'), extraArgs);
                    } else {
                        if (statusMsg) {
                            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
                        }
                        await ctx.reply('✅ पूरा हो गया।');
                    }
                    responseSent = true;
                    break;
                }
            }

            if (!responseSent) {
                rlog.info("Reached maximum iterations (15). Fetching final summary from model.");
                if (statusMsg) {
                    ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null,
                        `✍️ *अंतिम सारांश तैयार कर रहा हूँ...*`, { parse_mode: 'Markdown' }
                    ).catch(() => {});
                }
                const res = await model.invoke(messages);
                const finalContent = (res.content || '').trim();
                if (finalContent) {
                    rlog.response(finalContent);
                    history.push(new AIMessage(finalContent));

                    let replyText = finalContent;
                    let extraArgs = undefined;
                    const optionsMatch = finalContent.match(/\[?OPTIONS:\s*([^\r\n\]]+)\]?/i);
                    if (optionsMatch) {
                        const rawOptions = optionsMatch[1];
                        const options = rawOptions.split(',').map(s => s.replace(/['"]/g, '').trim());
                        setSessionOptions(userId, options);
                        const buttons = options.map((opt, index) => [
                            Markup.button.callback(opt.substring(0, 40), `sel_${index}`)
                        ]);
                        extraArgs = Markup.inlineKeyboard(buttons);
                        replyText = finalContent.replace(optionsMatch[0], '').trim() || 'कृपया विकल्प चुनें:';
                    }

                    if (statusMsg) {
                        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
                    }
                    await replyMarkdownSafely(ctx, replyText.replace(/_/g, '\\_'), extraArgs);
                } else {
                    if (statusMsg) {
                        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
                    }
                    await ctx.reply('✅ पूरा हो गया।');
                }
            }
        } catch (llmErr) {
            rlog.error(`LLM Error: ${llmErr.message}`);
            if (statusMsg) {
                try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            }
            await ctx.reply('⚠️ AI सर्वर से कनेक्ट नहीं हो पा रहा है। कृपया Local LLM Server चालू करें।');
        }
        } catch (err) {
            rlog.error(`Bot Error: ${err.message}`);
            ctx.reply(`⚠️ System Error: ${err.message}`);
        }
    } finally {
        releaseLock();
    }
}

// ==================== TELEGRAM HANDLERS ====================

const checkAuth = (ctx) => {
    if (config.ALLOWED_IDS.length > 0 && !config.ALLOWED_IDS.includes(ctx.from.id.toString())) {
        logger.warn(`Unauthorized access attempt from User ID: ${ctx.from.id}`);
        ctx.reply('❌ Unauthorized Access.');
        return false;
    }
    return true;
};

bot.on('text', async (ctx) => {
    if (!checkAuth(ctx)) return;
    handleMessage(ctx, ctx.message.text).catch(err => logger.error('Async text error: ' + err.message));
});

bot.on('voice', async (ctx) => {
    if (!checkAuth(ctx)) return;
    ctx.reply('🎤 आवाज़ पहचान रहा हूँ...');
    const transcribedText = await transcribeVoice(ctx);
    if (transcribedText) {
        ctx.reply(`📝 सुना: "${transcribedText}"`);
        handleMessage(ctx, transcribedText).catch(err => logger.error('Async voice error: ' + err.message));
    } else {
        ctx.reply('❌ माफ करें, आवाज़ समझ नहीं आयी।');
    }
});

bot.action(/^sel_(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        const userId = ctx.from.id.toString();
        const selectedIndexOrVal = ctx.match[1];
        
        let selected = selectedIndexOrVal;
        if (/^\d+$/.test(selectedIndexOrVal)) {
            const cached = getSessionOption(userId, parseInt(selectedIndexOrVal));
            if (cached) {
                selected = cached;
            }
        }
        handleMessage(ctx, selected).catch(err => logger.error('Async callback error: ' + err.message));
    } catch (err) {
        logger.error(`sel action error: ${err.message}`);
    }
});

bot.action(/^menu_(.+):(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        const action = ctx.match[1];
        const stateId = ctx.match[2];
        
        const userId = ctx.from.id.toString();
        const rlog = createRequestLogger(userId);
        
        try {
            await handleMenuAction(ctx, action, stateId, userId, rlog);
        } catch (err) {
            rlog.error(`Menu Action Error: ${err.message}`);
            ctx.reply(`⚠️ Action error: ${err.message}`);
        }
    } catch (err) {
        logger.error(`menu action error: ${err.message}`);
    }
});

// Voucher draft approval/cancellation
bot.action(/^vch_(post|wasend|cancel):(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        const action = ctx.match[1];
        const draftId = ctx.match[2];
        const userId = ctx.from.id.toString();
        const rlog = createRequestLogger(userId);
        
        const { handleVoucherApproval } = require('./tools/voucher-draft');
        await handleVoucherApproval(ctx, action, draftId, userId, rlog);
    } catch (err) {
        logger.error(`vch callback error: ${err.message}`);
    }
});

// WhatsApp draft approval — now uses draft ID instead of user ID
bot.action(/^wa_send_(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery().catch(() => {});
        const draftId = ctx.match[1];
        const draft = getDraft(draftId);
        if (!draft) return ctx.reply('❌ ड्राफ्ट expire हो गया या पहले ही भेज दिया गया।');
        
        ctx.reply('📤 WhatsApp पर भेज रहा हूँ...');
        try {
            const waClient = mcpManager.getWhatsAppClient();
            const response = await waClient.callTool({ name: draft.name, arguments: draft.args });
            const resultText = response.content.map(c => c.text).join('\n');
            ctx.reply(`✅ WhatsApp भेज दिया: ${resultText}`);
            removeDraft(draftId);
        } catch (err) {
            ctx.reply(`❌ WhatsApp भेजने में दिक्कत: ${err.message}`);
        }
    } catch (err) {
        logger.error(`wa_send action error: ${err.message}`);
    }
});

bot.action(/^wa_cancel_(.+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery('Draft cancelled.').catch(() => {});
        const draftId = ctx.match[1];
        removeDraft(draftId);
        ctx.reply('❌ WhatsApp Draft रद्द कर दिया।');
    } catch (err) {
        logger.error(`wa_cancel action error: ${err.message}`);
    }
});

bot.on('photo', async (ctx) => {
    if (!checkAuth(ctx)) return;
    ctx.reply('🖼️ इमेज प्रोसेस कर रहा हूँ...');
    try {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        const messageContent = await processImage(ctx, fileId, ctx.message.caption);
        await handleMessage(ctx, messageContent);
    } catch (err) {
        logger.error(`Image Processing Error: ${err.message}`);
        ctx.reply('❌ इमेज प्रोसेस करने में दिक्कत।');
    }
});

bot.on('document', async (ctx) => {
    const mime = ctx.message.document.mime_type;
    if (mime.startsWith('image/')) {
        ctx.reply('🖼️ इमेज प्रोसेस कर रहा हूँ...');
        try {
            const messageContent = await processImage(ctx, ctx.message.document.file_id, ctx.message.caption);
            await handleMessage(ctx, messageContent);
        } catch (err) {
            logger.error(`Document Processing Error: ${err.message}`);
            ctx.reply('❌ डॉक्यूमेंट प्रोसेस करने में दिक्कत।');
        }
    } else {
        ctx.reply('❌ इस तरह का डॉक्यूमेंट सपोर्ट नहीं है। कृपया इमेज भेजें।');
    }
});

// ==================== STARTUP ====================

async function startBot() {
    // Start Dashboard API
    startDashboard();
    
    // Connect MCP Servers
    const tallyTools = await mcpManager.connectTally();
    const whatsappTools = await mcpManager.connectWhatsApp();
    
    // Build OpenAI tool definitions
    const combinedTools = [...tallyTools, ...whatsappTools];
    openAiToolsGlobal = combinedTools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
        }
    }));

    // Add custom tools
    openAiToolsGlobal.push({
        type: 'function',
        function: {
            name: 'save_draft_voucher',
            description: 'Save a drafted voucher (e.g. Receipt) into the database for the user to review on their Web Dashboard.',
            parameters: {
                type: 'object',
                properties: {
                    voucherType: { type: 'string', description: 'Receipt or Receipt Book' },
                    date: { type: 'string', description: 'YYYYMMDD format' },
                    creditLedger: { type: 'string', description: 'Precise Tally ledger name giving money' },
                    debitLedger: { type: 'string', description: 'Precise Tally ledger name receiving money' },
                    amount: { type: 'number', description: 'Positive cash/bank amount received' },
                    narration: { type: 'string', description: 'Any narration or remarks' },
                    discountLedger: { type: 'string', description: `Optional Tally ledger name for discount (default: ${config.DISCOUNT_LEDGER})` },
                    discountAmount: { type: 'number', description: 'Optional discount amount given (positive)' },
                    voucherNumber: { type: 'string', description: 'Optional voucher number/receipt number' }
                },
                required: ['voucherType', 'date', 'creditLedger', 'debitLedger', 'amount']
            }
        }
    });

    openAiToolsGlobal.push({
        type: 'function',
        function: {
            name: 'send_fifo_reminder',
            description: 'MANDATORY for all payment reminders. Sends a smart FIFO payment reminder to a customer via WhatsApp with bill breakdown and UPI payment links. ALWAYS use this for reminders.',
            parameters: {
                type: 'object',
                properties: {
                    ledgerName: { type: 'string', description: 'EXACT name of the customer ledger from Tally (use search-ledgers first!)' },
                    upiId: { type: 'string', description: `UPI ID to receive payments. Default: ${config.DEFAULT_UPI_ID}` },
                    phone: { type: 'string', description: 'Optional contact number/WhatsApp number of the customer if known or provided by the user.' }
                },
                required: ['ledgerName']
            }
        }
    });

    openAiToolsGlobal.push({
        type: 'function',
        function: {
            name: 'schedule_report',
            description: 'Schedule an automated recurring report or query using a cron expression.',
            parameters: {
                type: 'object',
                properties: {
                    cronTime: { type: 'string', description: 'Cron expression (e.g., "0 9 * * *" for daily 9am)' },
                    prompt: { type: 'string', description: 'The query/report to run on schedule' }
                },
                required: ['cronTime', 'prompt']
            }
        }
    });

    logger.info(`✅ Loaded ${openAiToolsGlobal.length} tools.`);

    bot.launch();
    logger.info('🚀 Tally AI Bot (v5.0 - Multi-Agent Architecture) Ready!');
}

if (require.main && require.main.filename && require.main.filename.endsWith('bot.js')) {
    startBot().catch(err => logger.error('Fatal Start Error', err));
}

module.exports = {
    handleMessage,
    handleMenuAction,
    acquireUserLock,
    userLocks
};


// ==================== HELPER FUNCTIONS FOR LEDGER INTERACTION ====================

function getFinancialYearDates() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-indexed: 0 = Jan, 11 = Dec
    
    let currentFYStart, currentFYEnd;
    let prevFYStart, prevFYEnd;
    
    if (currentMonth >= 3) { // April to December
        currentFYStart = `${currentYear}-04-01`;
        currentFYEnd = `${currentYear + 1}-03-31`;
        
        prevFYStart = `${currentYear - 1}-04-01`;
        prevFYEnd = `${currentYear}-03-31`;
    } else { // January to March
        currentFYStart = `${currentYear - 1}-04-01`;
        currentFYEnd = `${currentYear}-03-31`;
        
        prevFYStart = `${currentYear - 2}-04-01`;
        prevFYEnd = `${currentYear - 1}-03-31`;
    }
    
    return {
        current: { from: currentFYStart, to: currentFYEnd },
        previous: { from: prevFYStart, to: prevFYEnd }
    };
}

async function sendLedgerMenu(ctx, ledgerName, userId, rlog) {
    let statusMsg = await ctx.reply('⏳ *लेजर की जानकारी प्राप्त कर रहा हूँ...*', { parse_mode: 'Markdown' });
    
    try {
        const tallyClient = mcpManager.getTallyClient();
        const todayStr = new Date().toISOString().split('T')[0];
        const ledgerCollRes = await tallyClient.callTool({
            name: 'query-collection',
            arguments: {
                collection: 'Ledger',
                fields: ['Name', 'Parent', 'LedgerMobile', 'ClosingBalance'],
                toDate: todayStr
            }
        });
        if (ledgerCollRes.isError) {
            throw new Error(ledgerCollRes.content ? ledgerCollRes.content[0].text : 'Tally error querying collection');
        }
        const tableID = JSON.parse(ledgerCollRes.content[0].text).tableID;
        
        const queryRes = await tallyClient.callTool({
            name: 'query-database',
            arguments: {
                sql: `SELECT * FROM ${tableID} WHERE LOWER("Name") = '${ledgerName.toLowerCase().replace(/'/g, "''")}'`
            }
        });
        if (queryRes.isError) {
            throw new Error(queryRes.content ? queryRes.content[0].text : 'Database error querying ledger');
        }
        const rows = JSON.parse(queryRes.content[0].text);
        
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
        
        if (!rows || rows.length === 0) {
            await ctx.reply(`❌ लेजर जानकारी नहीं मिली: ${ledgerName}`);
            return;
        }
        
        const ledgerInfo = rows[0];
        let bal = ledgerInfo.ClosingBalance || 0;
        try {
            const balRes = await tallyClient.callTool({
                name: 'ledger-balance',
                arguments: {
                    ledgerName: ledgerInfo.Name,
                    toDate: todayStr
                }
            });
            if (!balRes.isError && balRes.content && balRes.content[0]) {
                const balData = JSON.parse(balRes.content[0].text);
                if (balData && typeof balData.amount === 'number') {
                    bal = balData.amount;
                }
            }
        } catch (balErr) {
            rlog.warn(`Failed to fetch live ledger balance: ${balErr.message}`);
        }
        const formattedAmt = `₹${Math.abs(bal).toLocaleString('en-IN')} ${bal < 0 ? 'Dr' : 'Cr'}`;
        
        const { saveState } = require('./callback-state');
        const stateId = saveState(ledgerName, { parent: ledgerInfo.Parent, mobile: ledgerInfo.LedgerMobile });
        
        const msgText = `💼 **लेजर:** *${ledgerInfo.Name}*\n` +
                        `📁 **ग्रुप:** ${ledgerInfo.Parent || '-'}\n` +
                        `📱 **मोबाइल:** ${ledgerInfo.LedgerMobile || '-'}\n` +
                        `💰 **क्लोजिंग बैलेंस:** *${formattedAmt}*`;
                        
        const menuButtons = Markup.inlineKeyboard([
            [
                Markup.button.callback('📊 Outstanding Bills', `menu_b2b:${stateId}`),
                Markup.button.callback('🧾 Last 5 Receipts', `menu_l5r:${stateId}`)
            ],
            [
                Markup.button.callback('📅 Current Year PDF', `menu_cypdf:${stateId}`),
                Markup.button.callback('📅 Prev Year PDF', `menu_pypdf:${stateId}`)
            ],
            [
                Markup.button.callback('📅 Complete PDF (All-Time)', `menu_allpdf:${stateId}`)
            ],
            [
                Markup.button.callback('💬 Send Current FY to WhatsApp', `menu_wasend:${stateId}`)
            ],
            [
                Markup.button.callback('⏰ WhatsApp Reminder', `menu_wareminder:${stateId}`),
                Markup.button.callback('🔗 UPI Payment Link', `menu_paylink:${stateId}`)
            ]
        ]);
        
        await replyMarkdownSafely(ctx, msgText.replace(/_/g, '\\_'), menuButtons);
    } catch (err) {
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
        rlog.error(`sendLedgerMenu error: ${err.message}`);
        await ctx.reply(`❌ लेजर विवरण लोड करने में त्रुटि: ${err.message}`);
    }
}

async function handleLedgerStatementResult(ctx, toolOutputText, ledgerName, fromDate, toDate, userId) {
    const pdfMatch = toolOutputText.match(/PDF generated instantly at: (.+)/);
    if (!pdfMatch || !pdfMatch[1]) {
        await ctx.reply(`❌ PDF जनरेट करने में असमर्थ। विवरण: ${toolOutputText}`);
        return;
    }
    const finalPdfPath = pdfMatch[1].trim();
    
    const mobileMatch = toolOutputText.match(/Mobile:\s*(.*)/i);
    const closingMatch = toolOutputText.match(/Closing:\s*(.*)/i);
    const ledgerMatch = toolOutputText.match(/Ledger:\s*(.*)/i);
    
    const rawMobile = mobileMatch ? mobileMatch[1].trim() : '';
    const rawClosing = closingMatch ? parseFloat(closingMatch[1].trim()) : 0;
    const resolvedLedgerName = ledgerMatch ? ledgerMatch[1].trim() : ledgerName;
    
    const formattedFrom = new Date(fromDate).toLocaleDateString('en-IN');
    const formattedTo = new Date(toDate).toLocaleDateString('en-IN');
    await ctx.replyWithDocument({
        source: finalPdfPath,
        filename: `${resolvedLedgerName.replace(/\s+/g, '_')}_Statement.pdf`
    }, {
        caption: `📄 **${resolvedLedgerName}** का स्टेटमेंट\n📅 अवधि: **${formattedFrom}** से **${formattedTo}**`
    });
    
    if (rawMobile) {
        const amount = Math.abs(rawClosing);
        const type = rawClosing < 0 ? 'Dr' : 'Cr';
        const formattedAmt = `₹${amount.toLocaleString('en-IN')} ${type}`;
        
        let phoneNumber = rawMobile.replace(/[\s-]/g, '').trim();
        if (/^\d{10}$/.test(phoneNumber)) phoneNumber = '+91' + phoneNumber;
        
        const note = `Statement Payment`;
        const { generateClickableUpiLink } = require('./tools/fifo-reminder');
        const rlog = createRequestLogger(userId);
        
        const payLink = await generateClickableUpiLink(config.DEFAULT_UPI_ID, amount, note, rlog);
        
        const { addDraft, buildDraftButtons } = require('./tools/whatsapp');
        const caption = `You can do the payment on this LINK: ${payLink}`;
        
        const draftId = addDraft(userId, 'send_file', {
            recipient: phoneNumber,
            media_path: finalPdfPath,
            caption: caption
        });
        
        const buttons = buildDraftButtons(draftId);
        
        await ctx.reply(
            `*${resolvedLedgerName}* का क्लोजिंग बैलेंस: *${formattedAmt}*\n\nक्या आप यह PDF कस्टमर (${phoneNumber}) को भुगतान लिंक के साथ WhatsApp पर भेजना चाहते हैं?\n\n🔗 *भुगतान लिंक:* ${payLink}`,
            { parse_mode: 'Markdown', ...buttons }
        );
    } else {
        await ctx.reply(`⚠️ इस लेजर के लिए कोई मोबाइल नंबर नहीं मिला, इसलिए WhatsApp ड्राफ्ट नहीं बनाया गया।`);
    }
}

async function handleMenuAction(ctx, action, stateId, userId, rlog) {
    const releaseLock = await acquireUserLock(userId);
    try {
        const { getState, saveState } = require('./callback-state');
        const state = getState(stateId);
        if (!state) {
            return ctx.reply('⚠️ सत्र (Session) समाप्त हो गया है। कृपया लेजर दोबारा खोजें।');
        }
        
        const { ledgerName, parent } = state;
        const tallyClient = mcpManager.getTallyClient();
        await ctx.sendChatAction('typing');
    
    if (action === 'b2b') {
        const nature = (parent && parent.toLowerCase().includes('creditor')) ? 'payable' : 'receivable';
        const toDate = new Date().toISOString().split('T')[0];
        
        let statusMsg = await ctx.reply('⏳ *Outstanding बिलों की जानकारी निकाल रहा हूँ...*', { parse_mode: 'Markdown' });
        try {
            const res = await tallyClient.callTool({
                name: 'pipeline-outstanding-balance',
                arguments: { ledgerName, nature, toDate }
            });
            const outputText = res.content[0].text;
            
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            await replyMarkdownSafely(ctx, outputText.replace(/_/g, '\\_'));
        } catch (err) {
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            throw err;
        }
    }
    
    else if (action === 'l5r' || action === 'allr') {
        const limitVal = action === 'allr' ? 20 : 5;
        let statusMsg = await ctx.reply(action === 'allr' ? '⏳ *सभी पेमेंट्स रसीद खोज रहा हूँ...*' : '⏳ *पिछले 5 पेमेंट्स रसीद खोज रहा हूँ...*', { parse_mode: 'Markdown' });
        
        try {
            const today = new Date();
            const toDateStr = today.toISOString().split('T')[0];
            const threeYearsAgo = new Date();
            threeYearsAgo.setFullYear(today.getFullYear() - 3);
            const fromDateStr = threeYearsAgo.toISOString().split('T')[0];
            
            const res = await tallyClient.callTool({
                name: 'ledger-account',
                arguments: { ledgerName, fromDate: fromDateStr, toDate: toDateStr }
            });
            const tableID = JSON.parse(res.content[0].text).tableID;
            
            const queryRes = await tallyClient.callTool({
                name: 'query-database',
                arguments: {
                    sql: `SELECT * FROM ${tableID} WHERE LOWER("voucher_type") LIKE '%receipt%' ORDER BY "date" DESC LIMIT ${limitVal}`
                }
            });
            const rows = JSON.parse(queryRes.content[0].text);
            
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            
            if (!rows || rows.length === 0) {
                await ctx.reply(`इस लेजर के लिए पिछले 3 सालों में कोई रसीद (Receipt) नहीं मिली।`);
                return;
            }
            
            let replyText = `🧾 **${ledgerName} के पिछले ${rows.length} पेमेंट रसीद (Receipts):**\n\n`;
            rows.forEach((r, i) => {
                const dateVal = r.date;
                const formattedDate = dateVal ? new Date(dateVal).toLocaleDateString('en-IN') : '-';
                replyText += `${i+1}. 📅 **${formattedDate}**\n   📄 रसीद नंबर: **${r.voucher_number || '-'}**\n   💰 राशि: **₹${Math.abs(r.amount).toLocaleString('en-IN')}**\n   📝 विवरण: *${r.narration || 'कोई विवरण नहीं'}*\n\n`;
            });
            
            let extraArgs = undefined;
            if (action === 'l5r' && rows.length === 5) {
                const nextStateId = saveState(ledgerName, { parent });
                extraArgs = Markup.inlineKeyboard([
                    [Markup.button.callback('🧾 Show More Receipts', `menu_allr:${nextStateId}`)]
                ]);
            }
            
            await replyMarkdownSafely(ctx, replyText.replace(/_/g, '\\_'), extraArgs);
        } catch (err) {
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            throw err;
        }
    }
    
    else if (action === 'cypdf' || action === 'pypdf') {
        const isCurrent = action === 'cypdf';
        let statusMsg = await ctx.reply(`⏳ *स्टेटमेंट PDF जनरेट कर रहा हूँ...*`, { parse_mode: 'Markdown' });
        
        try {
            const dates = getFinancialYearDates();
            const range = isCurrent ? dates.current : dates.previous;
            
            const res = await tallyClient.callTool({
                name: 'pipeline-ledger-statement',
                arguments: { ledgerName, fromDate: range.from, toDate: range.to }
            });
            const toolOutputText = res.content[0].text;
            
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            await handleLedgerStatementResult(ctx, toolOutputText, ledgerName, range.from, range.to, userId);
        } catch (err) {
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            throw err;
        }
    }
    
    else if (action === 'allpdf') {
        let statusMsg = await ctx.reply(`⏳ *शुरुआत से स्टेटमेंट PDF जनरेट कर रहा हूँ...*`, { parse_mode: 'Markdown' });
        try {
            const companyCollRes = await tallyClient.callTool({
                name: 'query-collection',
                arguments: {
                    collection: 'Company',
                    fields: ['Name', 'BooksFrom', 'IsActiveCompany']
                }
            });
            if (companyCollRes.isError) {
                throw new Error(companyCollRes.content ? companyCollRes.content[0].text : 'Tally error querying company collection');
            }
            const tableID = JSON.parse(companyCollRes.content[0].text).tableID;
            const companyQueryRes = await tallyClient.callTool({
                name: 'query-database',
                arguments: {
                    sql: `SELECT * FROM ${tableID}`
                }
            });
            if (companyQueryRes.isError) {
                throw new Error(companyQueryRes.content ? companyQueryRes.content[0].text : 'Database error querying company table');
            }
            const companyData = JSON.parse(companyQueryRes.content[0].text);
            const activeCo = companyData.find(c => c.IsActiveCompany || c.IsActiveCompany === 'Yes' || String(c.IsActiveCompany).toLowerCase() === 'true') || companyData[0];
            const booksFromVal = activeCo ? activeCo.BooksFrom : null;
            
            let fromDateStr = '2020-04-01';
            if (booksFromVal) {
                try {
                    const d = new Date(booksFromVal);
                    if (!isNaN(d.getTime())) {
                        fromDateStr = d.toISOString().split('T')[0];
                    }
                } catch (e) {}
            }
            const toDateStr = new Date().toISOString().split('T')[0];
            
            const res = await tallyClient.callTool({
                name: 'pipeline-ledger-statement',
                arguments: { ledgerName, fromDate: fromDateStr, toDate: toDateStr }
            });
            const toolOutputText = res.content[0].text;
            
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            await handleLedgerStatementResult(ctx, toolOutputText, ledgerName, fromDateStr, toDateStr, userId);
        } catch (err) {
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            throw err;
        }
    }
    
    else if (action === 'wasend') {
        let statusMsg = await ctx.reply(`⏳ *स्टेटमेंट PDF जनरेट कर के WhatsApp भेजने की तैयारी कर रहा हूँ...*`, { parse_mode: 'Markdown' });
        try {
            const dates = getFinancialYearDates();
            const range = dates.current;
            
            const res = await tallyClient.callTool({
                name: 'pipeline-ledger-statement',
                arguments: { ledgerName, fromDate: range.from, toDate: range.to }
            });
            const toolOutputText = res.content[0].text;
            
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            await handleLedgerStatementResult(ctx, toolOutputText, ledgerName, range.from, range.to, userId);
        } catch (err) {
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            throw err;
        }
    }
    
    else if (action === 'wareminder') {
        let statusMsg = await ctx.reply('⏳ *WhatsApp Reminder ड्राफ्ट तैयार कर रहा हूँ...*', { parse_mode: 'Markdown' });
        try {
            const { handleFifoReminder } = require('./tools/fifo-reminder');
            const mockToolCall = {
                args: {
                    ledgerName,
                    upiId: config.DEFAULT_UPI_ID
                }
            };
            await handleFifoReminder(mockToolCall, ctx, rlog);
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
        } catch (err) {
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            throw err;
        }
    }
    
    else if (action === 'paylink') {
        let statusMsg = await ctx.reply('⏳ *Payment Link जनरेट कर रहा हूँ...*', { parse_mode: 'Markdown' });
        try {
            const todayStr = new Date().toISOString().split('T')[0];
            const ledgerCollRes = await tallyClient.callTool({
                name: 'query-collection',
                arguments: {
                    collection: 'Ledger',
                    fields: ['Name', 'ClosingBalance'],
                    toDate: todayStr
                }
            });
            if (ledgerCollRes.isError) {
                throw new Error(ledgerCollRes.content ? ledgerCollRes.content[0].text : 'Tally error querying collection');
            }
            const tableID = JSON.parse(ledgerCollRes.content[0].text).tableID;
            
            const queryRes = await tallyClient.callTool({
                name: 'query-database',
                arguments: {
                    sql: `SELECT * FROM ${tableID} WHERE LOWER("Name") = '${ledgerName.toLowerCase().replace(/'/g, "''")}'`
                }
            });
            if (queryRes.isError) {
                throw new Error(queryRes.content ? queryRes.content[0].text : 'Database error querying ledger');
            }
            const rows = JSON.parse(queryRes.content[0].text);
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            
            if (!rows || rows.length === 0) {
                await ctx.reply(`❌ लेजर जानकारी नहीं मिली: ${ledgerName}`);
                return;
            }
            
            let bal = rows[0].ClosingBalance || 0;
            try {
                const balRes = await tallyClient.callTool({
                    name: 'ledger-balance',
                    arguments: {
                        ledgerName: ledgerName,
                        toDate: todayStr
                    }
                });
                if (!balRes.isError && balRes.content && balRes.content[0]) {
                    const balData = JSON.parse(balRes.content[0].text);
                    if (balData && typeof balData.amount === 'number') {
                        bal = balData.amount;
                    }
                }
            } catch (balErr) {
                rlog.warn(`Failed to fetch live ledger balance in paylink: ${balErr.message}`);
            }
            if (bal >= 0) {
                await ctx.reply(`*${ledgerName}* का कोई बकाया (Dr) नहीं है। वर्तमान बैलेंस: *₹${Math.abs(bal).toLocaleString('en-IN')} ${bal === 0 ? '' : 'Cr'}*`);
                return;
            }
            
            const amount = Math.abs(bal);
            const { generateClickableUpiLink } = require('./tools/fifo-reminder');
            const payLink = await generateClickableUpiLink(config.DEFAULT_UPI_ID, amount, `Payment for ${ledgerName}`, rlog);
            
            await replyMarkdownSafely(ctx,
                `🔗 **${ledgerName} के लिए भुगतान लिंक:**\n\n` +
                `💰 **राशि:** ₹${amount.toLocaleString('en-IN')}\n` +
                `🔗 **लिंक:** ${payLink}\n\n` +
                `आप इस लिंक को कॉपी करके कस्टमर को भेज सकते हैं।`
            );
        } catch (err) {
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            throw err;
        }
    }
    } finally {
        releaseLock();
    }
}
