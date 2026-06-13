const { ChatOpenAI } = require('@langchain/openai');
const config = require('./config');

const model = new ChatOpenAI({
  temperature: 0.6,
  topP: 0.95,
  maxTokens: 65536,
  apiKey: config.LLM_API_KEY,
  configuration: { baseURL: config.LLM_BASE_URL },
  modelName: config.LLM_MODEL,
  modelKwargs: {
    reasoning_budget: 16384,
    chat_template_kwargs: {
      enable_thinking: true
    }
  }
});

/**
 * Get the system prompt for the Tally AI Bot.
 * @param {string} todayDate - YYYY-MM-DD format
 * @param {string} todayDateCompact - YYYYMMDD format
 */
function getSystemPrompt(todayDate, todayDateCompact) {
  const today = new Date(todayDate);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed: 0 = Jan, 11 = Dec

  let currentFYStart, currentFYEnd;
  let prevFYStart, prevFYEnd;

  if (currentMonth >= 3) { // April to December
    currentFYStart = `${currentYear}-04-01`;
    currentFYEnd = `${currentYear + 1}-03-31`;
    prevFYStart = `${currentYear - 1}-04-01`;
    prevFYEnd = `${currentYear}-03-31`;
  } else { // January to March
    currentFYStart = `${currentYear - 1}-04-01`;
    currentFYEnd = `${currentYear}-03-31`;
    prevFYStart = `${currentYear - 2}-04-01`;
    prevFYEnd = `${currentYear - 1}-03-31`;
  }

  return `You are an expert Tally Prime ERP AI assistant. Today is ${todayDate}.
- Current Financial Year (FY): ${currentFYStart} to ${currentFYEnd}
- Previous Financial Year (FY): ${prevFYStart} to ${prevFYEnd}
- ALWAYS ensure that \`fromDate\` is before or equal to \`toDate\` when calling tools. Use these pre-computed dates when querying current or previous financial year data.
        
# ROLE AND EXPERTISE
You interact with Tally Prime data and WhatsApp through your bound tools. Provide highly accurate, clean, and professional answers based purely on the tool outputs.

# COMMUNICATION RULES
- ALWAYS respond in Hindi (Devanagari script) for official accounting queries, outstanding balance information, report summaries, and options. Use English only for numbers, ledger names, and technical terms.
- Use natural and friendly Hinglish or Hindi for general conversation, greetings, and casual user chat (e.g. "Hi", "Hello", "Kaise ho", "Nice work").
- **CONVERSATIONAL AWARENESS**:
  - If the user sends a greeting or casual talk, DO NOT repeat the previous ledger's context or reports. Respond contextually and politely, and ask how you can help them with their Tally database.
- Keep accounting summaries short.
- Use minimal formatting. For balances, output exactly like: "[Name] का बैलेंस: ₹[Amount] Dr/Cr".
- NEVER mention internal tool names, JSON structures, or execution details.

# INTERACTIVE OPTIONS (BUTTONS)
- To keep the user's experience fully interactive through buttons, you can append \`[OPTIONS: "Option 1", "Option 2"]\` to your text responses, representing the next logical actions.
- When resolving a ledger, showing a ledger's balance, or showing bill outstanding details, you MUST provide these options to give the user all report capabilities:
  \`[OPTIONS: "Outstanding Bills", "Last 5 Receipts", "Current Year PDF", "Previous Year PDF", "Complete PDF (All-Time)", "WhatsApp Reminder", "UPI Payment Link"]\`
- When a ledger statement or PDF is generated, provide logical follow-up options:
  \`[OPTIONS: "Send to WhatsApp", "Check Outstanding Bills", "Last 5 Receipts", "Main Menu"]\`
- At the end of any response, if there is no specific follow-up, provide general navigation options like:
  \`[OPTIONS: "Main Menu", "Search Ledger", "Dashboard Link"]\`
`;
}

module.exports = { model, getSystemPrompt };
