const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require('path');

async function test() {
    console.log("Connecting to Tally MCP...");
    const transport = new StdioClientTransport({
        command: 'node',
        args: [path.join(__dirname, '../tally-mcp-server/dist/index.mjs')],
        env: { ...process.env, TALLY_PORT: '9000' }
    });

    const mcpClient = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await mcpClient.connect(transport);
    console.log("Connected successfully!\n");

    try {
        console.log("--- 1. Searching for 'pawan cloth' ---");
        const listRes = await mcpClient.callTool({ 
            name: "list-master", 
            arguments: { collection: "ledger", containsFilter: "pawan cloth" } 
        });
        const masters = JSON.parse(listRes.content[0].text);
        console.log("Found:", masters);

        if (masters.list && masters.list.length > 0) {
            const exactName = masters.list[0];
            
            console.log(`\n--- 2. Fetching Balance for '${exactName}' ---`);
            const balRes = await mcpClient.callTool({ 
                name: "ledger-balance", 
                arguments: { ledgerName: exactName } 
            });
            console.log("Balance:", balRes.content[0].text);

            console.log(`\n--- 3. Fetching Transactions for '${exactName}' ---`);
            const accRes = await mcpClient.callTool({ 
                name: "ledger-account", 
                arguments: { ledgerName: exactName } 
            });
            console.log("Transactions length:", accRes.content[0].text.length);
        }
    } catch(err) {
        console.error("Error executing tools:", err);
    }
    
    process.exit(0);
}
test().catch(console.error);
