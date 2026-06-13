const assert = require('assert');
const { HumanMessage, AIMessage, ToolMessage } = require('@langchain/core/messages');

// 1. Mock the router BEFORE requiring bot.js so the destructured import gets the mock
const router = require('../src/tools/router');
router.routeToolCall = async (toolCall, ctx, rlog) => {
    console.log(`[Mock Router] Route tool call: ${toolCall.name}`);
    return new ToolMessage({ content: "mock_tool_result", tool_call_id: toolCall.id });
};

// 2. Require LLM and mock it
const { model } = require('../src/llm');
let modelInvokeCount = 0;
let mockResponseFlow = []; // Array of mock responses to return sequentially

model.bindTools = (tools) => {
    return {
        invoke: async (messages) => {
            modelInvokeCount++;
            const currentMock = mockResponseFlow.shift();
            if (!currentMock) {
                return new AIMessage("No more mock responses configured.");
            }
            return currentMock;
        }
    };
};

// 3. Require the session module to inspect history
const { getSession, clearSession } = require('../src/session');

// Mock config ALLOWED_IDS to permit our test user IDs
const config = require('../src/config');
config.ALLOWED_IDS = ["user_memory_test", "user_concurrent_test"];

// 4. Require the bot main module
const { handleMessage, acquireUserLock, userLocks } = require('../src/bot');

// Mock Telegraf Context
function createMockCtx(userId, text) {
    return {
        from: { id: userId },
        chat: { id: 12345 },
        message: { text: text },
        sendChatAction: async (action) => console.log(`[Mock Ctx] Chat action: ${action}`),
        reply: async (text) => {
            console.log(`[Mock Ctx] Reply: ${text}`);
            return { message_id: 123 };
        },
        replyWithMarkdown: async (text, args) => {
            console.log(`[Mock Ctx] Reply with Markdown: ${text}`);
            return { message_id: 123 };
        },
        telegram: {
            deleteMessage: async (chatId, messageId) => console.log(`[Mock Ctx] Deleted message ${messageId}`),
            editMessageText: async (chatId, messageId, inlineMessageId, text, extra) => {
                console.log(`[Mock Ctx] Edited message ${messageId}: ${text}`);
                return { message_id: messageId };
            }
        }
    };
}

async function testConcurrency() {
    console.log("\n--- Starting Concurrency Locks Test ---");
    const userId = "user_concurrent_test";
    const order = [];

    // Define asynchronous functions that will run concurrently
    const runTask = async (taskName, delay) => {
        const release = await acquireUserLock(userId);
        try {
            order.push(`start_${taskName}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            order.push(`end_${taskName}`);
        } finally {
            release();
        }
    };

    // Trigger three tasks concurrently for the same user
    await Promise.all([
        runTask("taskA", 100),
        runTask("taskB", 50),
        runTask("taskC", 10)
    ]);

    console.log("Lock execution order:", order);
    const expectedOrder = [
        "start_taskA", "end_taskA",
        "start_taskB", "end_taskB",
        "start_taskC", "end_taskC"
    ];
    assert.deepStrictEqual(order, expectedOrder, "Concurrency locks did not serialize requests per user!");
    console.log("✅ Concurrency Locks Test Passed!");
}

async function testMemoryHistory() {
    console.log("\n--- Starting Memory History Test ---");
    const userId = "user_memory_test";
    clearSession(userId);

    // Turn 1: Model makes a tool call first, then gets tool result, and finally returns text.
    mockResponseFlow = [
        // Response 1: Tool call
        new AIMessage({
            content: "",
            tool_calls: [{ name: "search-ledgers", args: { query: "Manoj" }, id: "call_abc" }]
        }),
        // Response 2: Final response text
        new AIMessage("Manoj Enterprises का बैलेंस ₹10,000 Cr है।")
    ];

    const ctx = createMockCtx(userId, "Manoj Enterprises balance check");
    
    // Process message
    await handleMessage(ctx, "Manoj Enterprises balance check");

    // Check history
    const history = getSession(userId);
    console.log(`History length: ${history.length}`);
    
    assert.strictEqual(history.length, 4, "History should contain 4 messages for the first turn (Human, AIMessage with tool_calls, ToolMessage, AIMessage final text)");
    assert.strictEqual(history[0].constructor.name, "HumanMessage", "First message should be HumanMessage");
    assert.strictEqual(history[1].constructor.name, "AIMessage", "Second message should be AIMessage");
    assert.ok(history[1].tool_calls && history[1].tool_calls.length > 0, "Second message should contain tool calls");
    assert.strictEqual(history[2].constructor.name, "ToolMessage", "Third message should be ToolMessage");
    assert.strictEqual(history[3].constructor.name, "AIMessage", "Fourth message should be AIMessage");
    assert.ok(!history[3].tool_calls || history[3].tool_calls.length === 0, "Fourth message should not contain tool calls");

    console.log("✅ History content verification passed!");

    // Turn 2: Verify truncation logic (limit history to 25)
    console.log("\n--- Starting Memory Truncation Test ---");
    // Push dummy messages to history to exceed 25 limit
    for (let i = 0; i < 30; i++) {
        history.push(new HumanMessage(`dummy_${i}`));
    }
    
    // We have 4 (from Turn 1) + 30 (dummies) = 34 messages.
    // Call handleMessage again. It should truncate the history to 25 before processing the new message.
    // Let's mock a simple conversational response.
    mockResponseFlow = [
        new AIMessage("Hi there!")
    ];
    
    await handleMessage(ctx, "Hello bot");
    
    const newHistory = getSession(userId);
    console.log(`Truncated history length: ${newHistory.length}`);
    
    // Truncate logic in handleMessage:
    // 1. Checks length. It was 34.
    // 2. Truncates/splices to last 25.
    // 3. Pushes the new HumanMessage "Hello bot" (making length 26).
    // 4. Receives AI response "Hi there!" and pushes it (making length 27).
    assert.strictEqual(newHistory.length, 27, "History should be truncated to 25 before new messages are appended, leading to 27 total.");
    console.log("✅ Memory Truncation Test Passed!");
}

async function runAll() {
    try {
        await testConcurrency();
        await testMemoryHistory();
        console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉");
        process.exit(0);
    } catch (err) {
        console.error("❌ Test failed:", err);
        process.exit(1);
    }
}

runAll();
