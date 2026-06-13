require('dotenv').config();
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage, ToolMessage } = require('@langchain/core/messages');
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require('path');

async function run() {
    console.log("Connecting to Tally MCP...");
    const transport = new StdioClientTransport({
        command: 'node',
        args: [path.join(__dirname, '../tally-mcp-server/dist/index.mjs')],
        env: { ...process.env, TALLY_PORT: '9000' }
    });
    const mcpClientGlobal = new Client({ name: "tally-bot", version: "1.0.0" }, { capabilities: {} });
    await mcpClientGlobal.connect(transport);
    
    const mcpTools = await mcpClientGlobal.listTools();
    const openAiToolsGlobal = mcpTools.tools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
        }
    }));

    const { model, getSystemPrompt } = require('../src/llm');
    const modelWithTools = model.bindTools(openAiToolsGlobal);
    const todayDate = new Date().toISOString().split('T')[0];
    const todayDateCompact = todayDate.replace(/-/g, '');
    const messages = [
        new SystemMessage(getSystemPrompt(todayDate, todayDateCompact)),
        new HumanMessage("DHODAR MAI APNE KITNE CUSTOMERS HAI")
    ];

    console.log("Sending to LLM...");
    for(let i=0; i<5; i++) {
        console.log(`\n--- Iteration ${i+1} ---`);
        const res = await modelWithTools.invoke(messages);
        
        if (res.tool_calls && res.tool_calls.length > 0) {
            console.log("LLM called tools:", res.tool_calls.map(tc => tc.name));
            messages.push(res);
            
            for (let tc of res.tool_calls) {
                console.log(`Executing ${tc.name} with`, tc.args);
                try {
                    const response = await mcpClientGlobal.callTool({ name: tc.name, arguments: tc.args });
                    const txt = response.content.map(c => c.text).join('\n');
                    console.log(`Tool Result (${tc.name}):`, txt.substring(0, 100) + "...");
                    messages.push(new ToolMessage({ content: txt, tool_call_id: tc.id }));
                } catch(err) {
                    console.log(`Tool Error (${tc.name}):`, err.message);
                    messages.push(new ToolMessage({ content: err.message, tool_call_id: tc.id }));
                }
            }
        } else {
            console.log("\nLLM Final Response:", res.content);
            break;
        }
    }
    process.exit(0);
}
run().catch(console.error);
