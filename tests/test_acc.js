const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function runTest() {
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['.../tally-mcp-server/dist/index.mjs'],
        env: { ...process.env, TALLY_PORT: '9000' }
    });

    const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    await client.connect(transport);
    
    console.log("--- Testing Ledger Account ---");
    const accRes = await client.callTool({ 
        name: 'ledger-account', 
        arguments: { ledgerName: 'SHRI RAM CLOTH STORE KHATOLI', fromDate: '2026-04-01', toDate: '2027-03-31' } 
    });
    // This returns a tableID. We can query the table!
    const tableIdObj = JSON.parse(accRes.content[0].text);
    const dbRes = await client.callTool({
        name: 'query-database',
        arguments: { sql: `SELECT * FROM ${tableIdObj.tableID} ORDER BY date ASC` }
    });
    console.log(dbRes.content[0].text);

    process.exit(0);
}

runTest().catch(console.error);
