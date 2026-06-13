const crypto = require('crypto');
const { Markup } = require('telegraf');
const { logger } = require('../logger');

/**
 * WhatsApp Draft Queue Manager.
 * Replaces the old single-slot `whatsappDrafts[userId]` with a UUID-keyed queue.
 */

const draftQueue = new Map(); // Map<draftId, { userId, name, args, createdAt }>

/**
 * Add a draft to the queue. Returns the unique draft ID.
 */
function addDraft(userId, toolName, toolArgs) {
    const draftId = crypto.randomUUID().substring(0, 8);
    
    const args = { ...toolArgs };
    const phoneKeys = ['contact', 'phone_number', 'recipient'];
    phoneKeys.forEach(key => {
        if (args[key] && typeof args[key] === 'string') {
            let val = args[key].trim();
            if (val.includes('@')) return;
            val = val.replace(/\D/g, ''); // Strip '+' and other non-digits
            if (val.length === 10) val = '91' + val; // Prepend 91
            args[key] = val;
        }
    });
    
    draftQueue.set(draftId, {
        userId,
        name: toolName,
        args,
        createdAt: new Date(),
    });
    
    logger.info(`📝 WhatsApp draft queued: ${draftId} for user ${userId}, tool=${toolName}`, {
        draftId, userId, toolName,
        target: args.contact || args.phone_number || args.to_jid || 'unknown'
    });
    
    return draftId;
}

/**
 * Get a draft by its ID.
 */
function getDraft(draftId) {
    return draftQueue.get(draftId);
}

/**
 * Remove a draft from the queue.
 */
function removeDraft(draftId) {
    draftQueue.delete(draftId);
}

/**
 * Build Telegram inline keyboard buttons for a draft.
 */
function buildDraftButtons(draftId) {
    return Markup.inlineKeyboard([
        [Markup.button.callback('✅ Approve & Send to WhatsApp', `wa_send_${draftId}`)],
        [Markup.button.callback('❌ Cancel Draft', `wa_cancel_${draftId}`)],
    ]);
}

/**
 * Handle the send_message / send_file tool call by intercepting it as a draft.
 */
async function handleWhatsAppIntercept(toolCall, ctx, rlog) {
    const userId = ctx.from.id.toString();
    const draftId = addDraft(userId, toolCall.name, toolCall.args);
    
    const target = toolCall.args.contact || toolCall.args.phone_number || toolCall.args.to_jid || 'unknown';
    const msgContent = toolCall.name === 'send_message' 
        ? toolCall.args.message 
        : `File: ${toolCall.args.file_path}\nCaption: ${toolCall.args.caption || ''}`;
    
    const buttons = buildDraftButtons(draftId);
    
    await ctx.reply(
        `📋 *WhatsApp Draft for ${target}:*\n\n${msgContent}`,
        { parse_mode: 'Markdown', ...buttons }
    );
    
    rlog.info(`WhatsApp draft shown to user: ${draftId} → ${target}`);
    
    return `Draft shown to user for approval (ID: ${draftId}). Stop here and wait for the user to confirm by tapping the Approve button.`;
}

module.exports = {
    addDraft,
    getDraft,
    removeDraft,
    buildDraftButtons,
    handleWhatsAppIntercept,
};
