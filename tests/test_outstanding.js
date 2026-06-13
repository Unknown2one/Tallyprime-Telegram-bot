const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function testOutstanding() {
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['../tally-mcp-server/dist/index.mjs'],
        env: { ...process.env, TALLY_PORT: '9000' }
    });

    const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } });
    await client.connect(transport);
    
    console.log("Calling bills-outstanding...");
    const res1 = await client.callTool({ 
        name: 'bills-outstanding', 
        arguments: { nature: 'receivable', toDate: '2026-06-08' } 
    });
    const tableIdJSON = JSON.parse(res1.content[0].text);
    const tableID = tableIdJSON.tableID;
    console.log("Got tableID:", tableID);

    console.log("Calling query-database with exact match (=)...");
    const res2 = await client.callTool({
        name: 'query-database',
        arguments: { sql: `SELECT * FROM ${tableID} WHERE "party_name" = 'Vansh Textile (Nitesh)'` }
    });
    console.log("Result (Exact):", res2.content[0].text);

    console.log("Calling query-database with ILIKE...");
    const res3 = await client.callTool({
        name: 'query-database',
        arguments: { sql: `SELECT * FROM ${tableID} WHERE "party_name" ILIKE 'Vansh Textile (Nitesh)'` }
    });
    console.log("Result (ILIKE):", res3.content[0].text);

    process.exit(0);
}

testOutstanding().catch(console.error);
