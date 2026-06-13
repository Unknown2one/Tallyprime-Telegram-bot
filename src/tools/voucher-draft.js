const { insertDraft } = require('../db');
const { logger } = require('../logger');
const config = require('../config');
const mcpManager = require('../mcp-manager');

/**
 * Handle the `save_draft_voucher` tool call.
 */
async function handleVoucherDraft(toolCall, ctx, rlog) {
    const draftData = {
        voucher_type: toolCall.args.voucherType,
        date: toolCall.args.date,
        credit_ledger: toolCall.args.creditLedger,
        debit_ledger: toolCall.args.debitLedger,
        amount: toolCall.args.amount,
        narration: toolCall.args.narration || '',
        discount_ledger: toolCall.args.discountAmount && toolCall.args.discountAmount > 0 
            ? ((!toolCall.args.discountLedger || toolCall.args.discountLedger === 'Discount Allowed') ? config.DISCOUNT_LEDGER : toolCall.args.discountLedger) 
            : null,
        discount_amount: toolCall.args.discountAmount || 0,
        voucher_number: toolCall.args.voucherNumber || null
    };
    
    rlog.info(`💾 Saving voucher draft: ${draftData.voucher_type} ${draftData.voucher_number ? '#' + draftData.voucher_number : ''} ₹${draftData.amount} (${draftData.credit_ledger} → ${draftData.debit_ledger}), discount: ${draftData.discount_amount}`);
    
    const id = await insertDraft(draftData);
    rlog.info(`✅ Draft saved with ID: ${id}`);
    
    // Format date for output (YYYYMMDD to DD/MM/YYYY)
    const formattedDate = draftData.date && draftData.date.length === 8
        ? `${draftData.date.substring(6,8)}/${draftData.date.substring(4,6)}/${draftData.date.substring(0,4)}`
        : draftData.date;
        
    let summary = `💾 *वाउचर ड्राफ्ट सेव हो गया है!*\n\n`;
    summary += `• *ID:* \`${id}\`\n`;
    summary += `• *प्रकार (Voucher Type):* ${draftData.voucher_type}\n`;
    if (draftData.voucher_number) {
        summary += `• *वाउचर नंबर (Vch No):* \`${draftData.voucher_number}\`\n`;
    }
    summary += `• *दिनांक (Date):* ${formattedDate}\n`;
    summary += `• *क्रेडिट लेजर (From Customer):* \`${draftData.credit_ledger}\`\n`;
    summary += `• *डेबिट लेजर (To Cash/Bank):* \`${draftData.debit_ledger}\`\n`;
    summary += `• *प्राप्त राशि (Received Amount):* *₹${draftData.amount.toLocaleString('en-IN')}*\n`;
    
    if (draftData.discount_amount > 0) {
        summary += `• *डिस्काउंट राशि (Discount):* *₹${draftData.discount_amount.toLocaleString('en-IN')}* (\`${draftData.discount_ledger}\`)\n`;
        summary += `• *कुल सेटलमेंट (Total Settled):* *₹${(draftData.amount + draftData.discount_amount).toLocaleString('en-IN')}*\n`;
    }
    
    summary += `• *विवरण (Narration):* ${draftData.narration || 'कोई नहीं'}\n\n`;
    summary += `कृपया नीचे दिए गए विकल्पों में से चुनें:`;
    
    const { Markup } = require('telegraf');
    const buttons = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Approve (Post in Tally)', `vch_post:${id}`),
            Markup.button.callback('📲 Approve & WhatsApp', `vch_wasend:${id}`)
        ],
        [
            Markup.button.callback('❌ Incorrect', `vch_cancel:${id}`)
        ]
    ]);
    
    await ctx.replyWithMarkdown(summary.replace(/_/g, '\\_'), buttons);
    
    return `Draft saved successfully with ID: ${id}. Summary message with approval buttons sent to user on Telegram.`;
}

/**
 * Handle the voucher approval and posting from callback query
 */
async function handleVoucherApproval(ctx, action, draftId, userId, rlog) {
    rlog.info(`Voucher action triggered: ${action} for draft ID ${draftId}`);
    const { getDraftById, updateDraftStatus } = require('../db');
    
    if (action === 'cancel') {
        await updateDraftStatus(draftId, 'cancelled');
        await ctx.reply(`❌ वाउचर ड्राफ्ट (ID: ${draftId}) को निरस्त (Incorrect) कर दिया गया है।`);
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (e) {}
        return;
    }
    
    const draft = await getDraftById(draftId);
    if (!draft) {
        return ctx.reply(`❌ वाउचर ड्राफ्ट नहीं मिला। ID: ${draftId}`);
    }
    
    if (draft.status === 'completed') {
        return ctx.reply(`⚠️ यह वाउचर पहले ही Tally में दर्ज (Post) किया जा चुका है।`);
    }
    
    let statusMsg = await ctx.reply('⏳ *Tally में वाउचर दर्ज (Post) कर रहा हूँ...*', { parse_mode: 'Markdown' });
    
    try {
        const tallyClient = mcpManager.getTallyClient();
        if (!tallyClient) {
            throw new Error('Tally client not connected. Please ensure Tally is running.');
        }
        
        // Post to Tally
        const response = await tallyClient.callTool({
            name: 'create-voucher',
            arguments: {
                voucherType: draft.voucher_type,
                date: draft.date,
                creditLedger: draft.credit_ledger,
                debitLedger: draft.debit_ledger,
                amount: draft.amount,
                narration: draft.narration || '',
                discountLedger: (draft.discount_ledger === 'Discount Allowed' ? config.DISCOUNT_LEDGER : draft.discount_ledger) || undefined,
                discountAmount: draft.discount_amount || undefined,
                voucherNumber: draft.voucher_number || undefined
            }
        });
        
        const responseText = response.content[0].text;
        rlog.info(`Tally create-voucher response: ${responseText}`);
        
        const hasError = response.isError || 
                         responseText.includes('LINEERROR') || 
                         responseText.includes('Failed') || 
                         (responseText.includes('<ERRORS>') && !responseText.includes('<ERRORS>0</ERRORS>')) ||
                         (responseText.includes('<EXCEPTIONS>') && !responseText.includes('<EXCEPTIONS>0</EXCEPTIONS>'));
        
        if (hasError) {
            let errMsg = 'Tally XML Import failed';
            const match = responseText.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
            if (match) {
                errMsg = match[1];
            } else {
                const errsMatch = responseText.match(/<ERRORS>(.*?)<\/ERRORS>/);
                const exMatch = responseText.match(/<EXCEPTIONS>(.*?)<\/EXCEPTIONS>/);
                if (errsMatch && errsMatch[1] !== '0') errMsg += ` (Errors: ${errsMatch[1]})`;
                if (exMatch && exMatch[1] !== '0') errMsg += ` (Exceptions: ${exMatch[1]})`;
            }
            
            await updateDraftStatus(draftId, 'failed', responseText);
            try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
            await ctx.reply(`❌ *Tally Error:* ${errMsg}\n\nवाउचर पोस्ट नहीं हो पाया।`);
            return;
        }
        
        await updateDraftStatus(draftId, 'completed', responseText);
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
        
        try {
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (e) {}
        
        await ctx.reply('✅ Successfully Posted!');
        
        if (action === 'wasend') {
            await handleVoucherWhatsAppNotification(ctx, draft, userId, rlog);
        }
    } catch (err) {
        try { await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch (e) {}
        rlog.error(`handleVoucherApproval error: ${err.message}`);
        await ctx.reply(`❌ *त्रुटि:* ${err.message}`);
    }
}

/**
 * Send WhatsApp payment confirmation to client
 */
async function handleVoucherWhatsAppNotification(ctx, draft, userId, rlog) {
    await ctx.sendChatAction('typing');
    const tallyClient = mcpManager.getTallyClient();
    let phoneNumber = null;
    
    try {
        rlog.info(`Looking up phone number for: ${draft.credit_ledger}`);
        const ledgerCollRes = await tallyClient.callTool({
            name: 'query-collection',
            arguments: {
                collection: 'Ledger',
                fields: ['Name', 'LedgerMobile'],
                toDate: new Date().toISOString().split('T')[0]
            }
        });
        if (!ledgerCollRes.isError) {
            const tableID = JSON.parse(ledgerCollRes.content[0].text).tableID;
            const queryRes = await tallyClient.callTool({
                name: 'query-database',
                arguments: {
                    sql: `SELECT * FROM ${tableID} WHERE LOWER("Name") = '${draft.credit_ledger.toLowerCase().replace(/'/g, "''")}'`
                }
            });
            const rows = JSON.parse(queryRes.content[0].text);
            if (rows && rows.length > 0 && rows[0].LedgerMobile) {
                phoneNumber = rows[0].LedgerMobile.replace(/[\s-]/g, '').trim();
                if (/^\d{10}$/.test(phoneNumber)) phoneNumber = '+91' + phoneNumber;
                rlog.info(`📞 Phone from Tally: ${phoneNumber}`);
            }
        }
    } catch (e) {
        rlog.warn(`Tally phone lookup failed: ${e.message}`);
    }
    
    if (!phoneNumber) {
        try {
            const waClient = mcpManager.getWhatsAppClient();
            if (waClient) {
                const waRes = await waClient.callTool({
                    name: 'search_contacts',
                    arguments: { query: draft.credit_ledger.split(' ')[0] }
                });
                if (waRes && waRes.content && waRes.content.length > 0) {
                    const waText = waRes.content[0].text || '';
                    const waPhoneMatch = waText.match(/(\+?\d{10,13})/);
                    if (waPhoneMatch) {
                        phoneNumber = waPhoneMatch[1];
                        rlog.info(`📞 Phone from WhatsApp: ${phoneNumber}`);
                    }
                }
            }
        } catch (e) {
            rlog.warn(`WhatsApp contact lookup failed: ${e.message}`);
        }
    }
    
    const receiptNoText = draft.voucher_number ? draft.voucher_number : 'N/A';
    let waMsg = `🙏 नमस्ते ${draft.credit_ledger},\n\n` +
                `आपके *₹${draft.amount.toLocaleString('en-IN')}* जमा हो गए हैं, रसीद नंबर: *${receiptNoText}*\n\n` +
                `धन्यवाद! 🙏`;
                
    if (draft.discount_amount > 0) {
        waMsg = `🙏 नमस्ते ${draft.credit_ledger},\n\n` +
                `आपके *₹${draft.amount.toLocaleString('en-IN')}* जमा हो गए हैं, रसीद नंबर: *${receiptNoText}* (डिस्काउंट: ₹${draft.discount_amount.toLocaleString('en-IN')}, कुल सेटलमेंट: ₹${(draft.amount + draft.discount_amount).toLocaleString('en-IN')})\n\n` +
                `धन्यवाद! 🙏`;
    }
    
    if (phoneNumber) {
        try {
            const waClient = mcpManager.getWhatsAppClient();
            if (!waClient) {
                throw new Error('WhatsApp client not connected');
            }
            
            await ctx.reply(`📤 कस्टमर (${phoneNumber}) को WhatsApp संदेश भेज रहा हूँ...`);
            
            const response = await waClient.callTool({
                name: 'send_message',
                arguments: {
                    contact: phoneNumber,
                    message: waMsg
                }
            });
            
            await ctx.reply(`✅ *WhatsApp संदेश भेजा गया:* \n\n${waMsg}`);
        } catch (err) {
            rlog.error(`Direct WhatsApp send failed: ${err.message}`);
            const { addDraft, buildDraftButtons } = require('./whatsapp');
            const draftId = addDraft(userId, 'send_message', {
                contact: phoneNumber,
                message: waMsg
            });
            const buttons = buildDraftButtons(draftId);
            await ctx.reply(
                `⚠️ WhatsApp सीधा भेजने में समस्या हुई। ड्राफ्ट तैयार कर दिया गया है। कृपया यहाँ से भेजें:\n\n📞 ${phoneNumber}\n${waMsg}`,
                buttons
            );
        }
    } else {
        await ctx.reply(
            `⚠️ कस्टमर का मोबाइल नंबर नहीं मिला।\n\n*WhatsApp संदेश ड्राफ्ट:*\n${waMsg}\n\nकृपया कस्टमर का WhatsApp नंबर प्रदान करें।`
        );
    }
}

module.exports = { handleVoucherDraft, handleVoucherApproval };
