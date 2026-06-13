const cron = require('node-cron');
const { logger } = require('../logger');

const scheduledJobs = new Map();

/**
 * Handle the `schedule_report` tool call.
 */
async function handleScheduleReport(toolCall, ctx, rlog, handleMessageFn, botInstance) {
    const { cronTime, prompt } = toolCall.args;
    const userId = ctx.from.id.toString();
    
    rlog.info(`⏰ Scheduling report: "${prompt}" at ${cronTime}`);
    
    try {
        const job = cron.schedule(cronTime, async () => {
            logger.info(`Running scheduled task for ${userId}: ${prompt}`);
            const fakeCtx = {
                from: { id: userId },
                message: { text: prompt },
                reply: (text) => botInstance.telegram.sendMessage(userId, text),
                replyWithMarkdown: (text, args) => botInstance.telegram.sendMessage(userId, text, { parse_mode: 'Markdown', ...args }),
                replyWithDocument: (doc, args) => botInstance.telegram.sendDocument(userId, doc.source, { ...args }),
                sendChatAction: (action) => botInstance.telegram.sendChatAction(userId, action).catch(() => {})
            };
            await handleMessageFn(fakeCtx, prompt);
        });
        
        const jobId = `job_${Date.now()}`;
        scheduledJobs.set(jobId, job);
        
        return `Successfully scheduled report at ${cronTime} for prompt: "${prompt}" (Job ID: ${jobId})`;
    } catch (err) {
        rlog.error(`Failed to schedule: ${err.message}`);
        return `Failed to schedule: ${err.message}`;
    }
}

module.exports = { handleScheduleReport, scheduledJobs };
