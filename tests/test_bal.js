const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function runTest() {
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['../tally-mcp-server/dist/index.mjs'],
        env: { ...process.env, TALLY_PORT: '9000' }
    });

    const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    await client.connect(transport);
    
    console.log("--- Testing Ledger Balance ---");
    const balRes = await client.callTool({ 
        name: 'ledger-balance', 
        arguments: { ledgerName: 'SHRI RAM CLOTH STORE KHATOLI', fromDate: '2026-04-01', toDate: '2027-03-31' } 
    });
    console.log(balRes.content[0].text);

    process.exit(0);
}

runTest().catch(console.error);
