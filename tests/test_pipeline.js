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
    
    console.log("--- Testing Outstanding Balance Pipeline ---");
    const outRes = await client.callTool({ 
        name: 'pipeline-outstanding-balance', 
        arguments: { ledgerName: 'PAWAN CLOTH STORE BALER', nature: 'receivable', toDate: '2026-06-08' } 
    });
    console.log(outRes.content[0].text);

    console.log("\n--- Testing Ledger Statement Pipeline ---");
    const stmtRes = await client.callTool({
        name: 'pipeline-ledger-statement',
        arguments: { ledgerName: 'PAWAN CLOTH STORE BALER', fromDate: '2026-04-01', toDate: '2027-03-31' }
    });
    console.log(stmtRes.content[0].text);

    process.exit(0);
}

runTest().catch(console.error);
