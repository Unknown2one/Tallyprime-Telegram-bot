const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { SarvamAIClient } = require('sarvamai');
const config = require('./config');
const { logger } = require('./logger');

/**
 * Transcribe a Telegram voice message.
 * Strategy: Sarvam AI first → local whisper fallback.
 * 
 * @param {object} ctx - Telegraf context
 * @returns {string|null} Transcribed text or null on failure
 */
async function transcribeVoice(ctx) {
    let filePath;
    try {
        const fileId = ctx.message.voice.file_id;
        const link = await ctx.telegram.getFileLink(fileId);
        logger.info(`🎤 Downloading voice file: ${link.href}`);

        const response = await axios.get(link.href, { responseType: 'arraybuffer' });
        filePath = path.join(__dirname, '..', `voice_${Date.now()}.ogg`);
        fs.writeFileSync(filePath, response.data);

        let result = null;

        // Try Sarvam AI first
        try {
            logger.info('Attempting Sarvam AI transcription...');
            const sarvamClient = new SarvamAIClient({
                apiSubscriptionKey: config.SARVAM_API_KEY
            });
            const audioStream = fs.createReadStream(filePath);
            const transResponse = await sarvamClient.speechToText.transcribe({
                file: audioStream,
                model: 'saaras:v3',
                mode: 'transcribe'
            });

            result = transResponse.transcript || transResponse.text || transResponse.transcribed_text;
            if (!result && typeof transResponse === 'object') {
                result = transResponse.transcript || JSON.stringify(transResponse);
            }
            logger.info(`✅ Sarvam Transcription: ${result}`);
        } catch (apiErr) {
            logger.warn(`⚠️ Sarvam failed (${apiErr.message}), falling back to local script...`);

            // Local transcription fallback
            logger.info(`Starting local transcription for ${filePath}...`);
            const { stdout } = await execPromise(`python scripts/transcribe.py "${filePath}"`, {
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
            });
            result = stdout.trim();
            logger.info(`✅ Local Transcription: ${result}`);
        }

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return result;

    } catch (err) {
        logger.error(`❌ Transcription Error: ${err.message}`);
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return null;
    }
}

module.exports = { transcribeVoice };
