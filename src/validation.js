const MAX_MESSAGE_LENGTH = 1000;
const MAX_SESSION_ID_LENGTH = 100;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{16,100}$/;

export function validateSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { valid: false, error: 'sessionId is required and must be a string' };
  }

  if (sessionId.length > MAX_SESSION_ID_LENGTH || !SESSION_ID_PATTERN.test(sessionId)) {
    return { valid: false, error: 'sessionId format is invalid' };
  }

  return { valid: true };
}

export function validateChatInput(body) {
  const { sessionId, message } = body || {};
  const sessionValidation = validateSessionId(sessionId);

  if (!sessionValidation.valid) {
    return sessionValidation;
  }

  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'message is required and must be a string' };
  }

  const normalizedMessage = message.trim();

  if (!normalizedMessage) {
    return { valid: false, error: 'message cannot be empty' };
  }

  if (normalizedMessage.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` };
  }

  return { valid: true };
}
