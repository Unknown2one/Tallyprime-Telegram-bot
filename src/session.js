const sessions = new Map();
const optionCaches = new Map();

function getSession(userId) {
    if (!sessions.has(userId)) sessions.set(userId, []);
    return sessions.get(userId);
}

function clearSession(userId) {
    sessions.delete(userId);
    optionCaches.delete(userId);
}

function setSessionOptions(userId, options) {
    optionCaches.set(userId, options);
}

function getSessionOption(userId, index) {
    const opts = optionCaches.get(userId);
    return opts ? opts[index] : null;
}

module.exports = { getSession, clearSession, setSessionOptions, getSessionOption };
