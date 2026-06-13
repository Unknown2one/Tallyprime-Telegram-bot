const { ToolMessage } = require('@langchain/core/messages');
const { handleFifoReminder } = require('./fifo-reminder');
const { handleVoucherDraft } = require('./voucher-draft');
const { handleWhatsAppIntercept } = require('./whatsapp');
const { handleScheduleReport } = require('./scheduler');
const mcpManager = require('../mcp-manager');
const config = require('../config');

/**
 * Tool Router - dispatches tool calls to the correct handler.
 * Replaces the monolithic if-else chain in bot.js.
 * 
 * Returns a ToolMessage for the LLM conversation.
 */
async function routeToolCall(toolCall, ctx, rlog, { handleMessageFn, botInstance }) {
    const toolId = toolCall.id || 'call_' + Date.now();
    
    try {
        // --- Custom tool handlers (intercepted before MCP) ---
        
        if (toolCall.name === 'send_fifo_reminder') {
            const startTime = Date.now();
            const result = await handleFifoReminder(toolCall, ctx, rlog);
            rlog.tool(toolCall.name, toolCall.args, result, Date.now() - startTime);
            return new ToolMessage({ content: result, tool_call_id: toolId });
        }
        
        if (toolCall.name === 'save_draft_voucher') {
            const startTime = Date.now();
            const result = await handleVoucherDraft(toolCall, ctx, rlog);
            rlog.tool(toolCall.name, toolCall.args, result, Date.now() - startTime);
            return new ToolMessage({ content: result, tool_call_id: toolId });
        }
        
        if (toolCall.name === 'schedule_report') {
            const startTime = Date.now();
            const result = await handleScheduleReport(toolCall, ctx, rlog, handleMessageFn, botInstance);
            rlog.tool(toolCall.name, toolCall.args, result, Date.now() - startTime);
            return new ToolMessage({ content: result, tool_call_id: toolId });
        }
        
        // --- WhatsApp send interception (show draft before sending) ---
        
        if (toolCall.name === 'send_message' || toolCall.name === 'send_file') {
            rlog.info(`🔒 Intercepting WhatsApp send: ${toolCall.name}`);
            const startTime = Date.now();
            const result = await handleWhatsAppIntercept(toolCall, ctx, rlog);
            rlog.tool(toolCall.name, toolCall.args, result, Date.now() - startTime);
            return new ToolMessage({ content: result, tool_call_id: toolId });
        }
        
        // --- Default: forward to MCP ---
        
        rlog.info(`🔧 Calling MCP Tool: ${toolCall.name}`, { toolArgs: toolCall.args });
        
        const startTime = Date.now();
        const client = mcpManager.getClientForTool(toolCall.name);
        const response = await client.callTool({ name: toolCall.name, arguments: toolCall.args });
        const toolOutputText = response.content.map(c => c.text).join('\n');
        const durationMs = Date.now() - startTime;
        
        rlog.tool(toolCall.name, toolCall.args, toolOutputText, durationMs);
        
        // --- Special intercept: send PDF inline and prompt WhatsApp draft if pipeline-ledger-statement ---
        if (toolCall.name === 'pipeline-ledger-statement') {
            const pdfMatch = toolOutputText.match(/PDF generated instantly at: (.+)/);
            if (pdfMatch && pdfMatch[1]) {
                const finalPdfPath = pdfMatch[1].trim();
                
                // Parse details from summary output
                const mobileMatch = toolOutputText.match(/Mobile:\s*(.*)/i);
                const closingMatch = toolOutputText.match(/Closing:\s*(.*)/i);
                const ledgerMatch = toolOutputText.match(/Ledger:\s*(.*)/i);
                
                const rawMobile = mobileMatch ? mobileMatch[1].trim() : '';
                const rawClosing = closingMatch ? parseFloat(closingMatch[1].trim()) : 0;
                const ledgerName = ledgerMatch ? ledgerMatch[1].trim() : toolCall.args.ledgerName;
                
                // Send PDF document to Telegram
                await ctx.replyWithDocument({
                    source: finalPdfPath,
                    filename: `${ledgerName.replace(/\s+/g, '_')}_Statement.pdf`
                });
                
                if (rawMobile && rawClosing !== 0) {
                    const amount = Math.abs(rawClosing);
                    const type = rawClosing < 0 ? 'Dr' : 'Cr';
                    const formattedAmt = `₹${amount.toLocaleString('en-IN')} ${type}`;
                    
                    // Format phone number
                    let phoneNumber = rawMobile.replace(/[\s-]/g, '').trim();
                    if (/^\d{10}$/.test(phoneNumber)) phoneNumber = '+91' + phoneNumber;
                    
                    const userId = ctx.from.id.toString();
                    const note = `Statement Payment`;
                    const { generateClickableUpiLink } = require('./fifo-reminder');
                    
                    // Generate UPI payment link (with mam=1 for editability)
                    const payLink = await generateClickableUpiLink(config.DEFAULT_UPI_ID, amount, note, rlog);
                    
                    // Add WhatsApp send_file draft
                    const { addDraft, buildDraftButtons } = require('./whatsapp');
                    const caption = `You can do the payment on this LINK: ${payLink}`;
                    
                    const draftId = addDraft(userId, 'send_file', {
                        recipient: phoneNumber,
                        media_path: finalPdfPath,
                        caption: caption
                    });
                    
                    const buttons = buildDraftButtons(draftId);
                    
                    // Send summary message and display Approve/Cancel draft buttons
                    await ctx.reply(
                        `*${ledgerName}* का क्लोजिंग बैलेंस: *${formattedAmt}*\n\nक्या आप यह PDF कस्टमर (${phoneNumber}) को भुगतान लिंक के साथ WhatsApp पर भेजना चाहते हैं?\n\n🔗 *भुगतान लिंक:* ${payLink}`,
                        { parse_mode: 'Markdown', ...buttons }
                    );
                    
                    return new ToolMessage({
                        content: `${ledgerName} का क्लोजिंग बैलेंस: ${formattedAmt} है। WhatsApp draft generated successfully with ID: ${draftId}.`,
                        tool_call_id: toolId
                    });
                }
            }
        }
        
        return new ToolMessage({ content: toolOutputText, tool_call_id: toolId });
        
    } catch (err) {
        rlog.error(`❌ Tool Error for ${toolCall.name}: ${err.message}`);
        return new ToolMessage({ content: `Error from tool: ${err.message}`, tool_call_id: toolId });
    }
}

module.exports = { routeToolCall };
