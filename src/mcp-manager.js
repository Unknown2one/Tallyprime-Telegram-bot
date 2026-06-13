const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');
const config = require('./config');
const { logger } = require('./logger');

let tallyClient = null;
let whatsappClient = null;
let toolClientMap = {};
let allMcpTools = [];

/**
 * Connect to the Tally MCP Server.
 */
async function connectTally() {
    logger.info('🔗 Connecting to Tally MCP Server...');
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['--max-old-space-size=8192', path.join(__dirname, '..', 'tally-mcp-server/dist/index.mjs')],
        env: { ...process.env, TALLY_PORT: config.TALLY_PORT }
    });

    tallyClient = new Client({ name: 'telegram-tally-client', version: '2.0.0' }, { capabilities: { tools: {} } });
    await tallyClient.connect(transport);
    const { tools: mcpTools } = await tallyClient.listTools();
    mcpTools.forEach(t => { toolClientMap[t.name] = tallyClient; });
    allMcpTools = mcpTools;
    logger.info(`✅ Tally MCP Connected. Found ${mcpTools.length} tools.`);
    return mcpTools;
}

/**
 * Connect to the WhatsApp MCP Server.
 */
async function connectWhatsApp() {
    logger.info('🔗 Connecting to WhatsApp MCP Server...');
    const transport = new StdioClientTransport({
        command: 'uv',
        args: ['--directory', path.join(__dirname, '..', 'whatsapp-mcp/whatsapp-mcp-server'), 'run', 'main.py'],
        env: { ...process.env }
    });
    
    whatsappClient = new Client({ name: 'telegram-whatsapp-client', version: '2.0.0' }, { capabilities: { tools: {} } });
    
    try {
        await whatsappClient.connect(transport);
        const { tools: whatsappTools } = await whatsappClient.listTools();
        whatsappTools.forEach(t => { toolClientMap[t.name] = whatsappClient; });
        allMcpTools = [...allMcpTools, ...whatsappTools];
        logger.info(`✅ WhatsApp MCP Connected. Found ${whatsappTools.length} tools.`);
        return whatsappTools;
    } catch (err) {
        logger.error(`❌ Failed to connect WhatsApp MCP: ${err.message}. Running in Tally-only mode.`);
        return [];
    }
}

/**
 * Get the MCP client for a given tool name.
 */
function getClientForTool(toolName) {
    return toolClientMap[toolName] || tallyClient;
}

/**
 * Get all discovered MCP tools.
 */
function getAllTools() {
    return allMcpTools;
}

function getTallyClient() { return tallyClient; }
function getWhatsAppClient() { return whatsappClient; }

module.exports = {
    connectTally,
    connectWhatsApp,
    getClientForTool,
    getAllTools,
    getTallyClient,
    getWhatsAppClient,
};
