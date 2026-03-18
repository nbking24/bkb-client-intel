export interface AuthResult {
  valid: boolean;
  userId?: string;
}

export function validateAuth(authHeader: string | null): AuthResult {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return { valid: false };
  const token = authHeader.slice(7);
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');
    // Token format: pin:userId:timestamp (new) or pin:timestamp (legacy)
    const pinValid = parts[0] === process.env.APP_PIN;
    if (!pinValid) return { valid: false };

    // New format has 3 parts: pin:userId:timestamp
    if (parts.length >= 3) {
      return { valid: true, userId: parts[1] };
    }
    // Legacy format: pin:timestamp (no userId)
    return { valid: true };
  } catch {
    return { valid: false };
  }
}
