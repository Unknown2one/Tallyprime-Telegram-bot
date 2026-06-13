require('dotenv').config();
const mcpManager = require('../src/mcp-manager');
const { resolveLedger } = require('../src/ledger-resolver');

async function run() {
    console.log("Connecting to Tally...");
    await mcpManager.connectTally();
    console.log("Testing ledger resolver with 'mittal'...");
    try {
        const result = await resolveLedger("mittal");
        console.log("Result for 'mittal':", JSON.stringify(result, null, 2));
    } catch(err) {
        console.error("Error:", err);
    }
    
    try {
        console.log("\nTesting ledger resolver with 'LAXMI'...");
        const result2 = await resolveLedger("LAXMI");
        console.log("Result for 'LAXMI':", JSON.stringify(result2, null, 2));
    } catch(err) {
        console.error("Error:", err);
    }
    process.exit(0);
}
run();
