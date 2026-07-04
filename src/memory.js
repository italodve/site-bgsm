const MAX_MESSAGES_PER_SESSION = 20;
const MAX_SESSIONS = 500;

// In-memory session storage using Map.
// To migrate to Redis, replace the Map operations in each method
// with equivalent Redis commands (e.g., LPUSH, LRANGE, DEL).

export class SessionMemory {
  constructor() {
    this.sessions = new Map();
  }

  getHistory(sessionId) {
    return this.sessions.get(sessionId) || [];
  }

  addMessage(sessionId, role, content) {
    if (this.sessions.size >= MAX_SESSIONS && !this.sessions.has(sessionId)) {
      const oldestSessionId = this.sessions.keys().next().value;
      if (oldestSessionId) {
        this.sessions.delete(oldestSessionId);
      }
    }

    const history = this.getHistory(sessionId);
    history.push({ role, content });
    this.sessions.set(sessionId, history.slice(-MAX_MESSAGES_PER_SESSION));
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }
}
