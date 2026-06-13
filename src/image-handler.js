const axios = require('axios');
const { logger } = require('./logger');

/**
 * Process an image from Telegram (photo or image document).
 * Returns a content array suitable for the LLM multimodal message.
 * 
 * @param {object} ctx - Telegraf context
 * @param {string} fileId - Telegram file ID
 * @param {string} caption - Optional caption from the user
 * @returns {Array} Content array for LLM
 */
async function processImage(ctx, fileId, caption) {
    const link = await ctx.telegram.getFileLink(fileId);
    logger.info(`🖼️ Downloading image: ${link.href}`);
    
    const response = await axios.get(link.href, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(response.data).toString('base64');
    const mimeType = link.href.split('.').pop().toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';

    return [
        { type: 'text', text: caption || 'Please extract the details from this invoice image and process it.' },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
    ];
}

module.exports = { processImage };
