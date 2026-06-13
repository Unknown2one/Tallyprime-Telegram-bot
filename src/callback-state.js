const callbackStates = new Map();

function saveState(ledgerName, extra = {}) {
    const id = Math.random().toString(36).substring(2, 10);
    callbackStates.set(id, { ledgerName, ...extra, timestamp: Date.now() });
    return id;
}

function getState(id) {
    return callbackStates.get(id);
}

// Clean up old states (> 24 hours) periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, state] of callbackStates.entries()) {
        if (now - state.timestamp > 24 * 60 * 60 * 1000) {
            callbackStates.delete(id);
        }
    }
}, 60 * 60 * 1000);

module.exports = { saveState, getState };
