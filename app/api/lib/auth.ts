export interface AuthResult {
  valid: boolean;
  userId?: string;
}

const VALID_USER_IDS = ['nathan', 'terri', 'evan', 'josh', 'dave_steich'];

export function validateAuth(authHeader: string | null): AuthResult {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return { valid: false };
  const token = authHeader.slice(7);
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');

    // New format (per-user PIN): pin:userId:timestamp
    if (parts.length >= 3 && VALID_USER_IDS.includes(parts[1])) {
      return { valid: true, userId: parts[1] };
    }

    // Legacy format: pin:timestamp (validate against APP_PIN)
    if (parts.length === 2) {
      const pinValid = parts[0] === process.env.APP_PIN;
      if (pinValid) return { valid: true };
    }

    // Legacy 3-part with APP_PIN check (backward compat during transition)
    if (parts.length >= 3 && parts[0] === process.env.APP_PIN) {
      return { valid: true, userId: parts[1] };
    }

    return { valid: false };
  } catch {
    return { valid: false };
  }
}
