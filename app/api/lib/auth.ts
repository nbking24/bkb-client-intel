export interface AuthResult {
  valid: boolean;
  userId?: string;
  role?: string;
}

// Role mapping — must match app/lib/constants.ts TEAM_USERS
const USER_ROLES: Record<string, string> = {
  nathan: 'owner',
  terri: 'admin',
  evan: 'field_sup',
  josh: 'field_sup',
};

const VALID_USER_IDS = ['nathan', 'terri', 'evan', 'josh'];

// Roles that are restricted to the field-staff agent only
const FIELD_ROLES = new Set(['field_sup', 'field']);

export function isFieldStaffRole(role?: string): boolean {
  return FIELD_ROLES.has(role || '');
}

export function validateAuth(authHeader: string | null): AuthResult {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return { valid: false };
  const token = authHeader.slice(7);
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');

    // New format (per-user PIN): pin:userId:timestamp
    if (parts.length >= 3 && VALID_USER_IDS.includes(parts[1])) {
      const userId = parts[1];
      return { valid: true, userId, role: USER_ROLES[userId] || 'field' };
    }

    // Legacy format: pin:timestamp (validate against APP_PIN)
    if (parts.length === 2) {
      const pinValid = parts[0] === process.env.APP_PIN;
      if (pinValid) return { valid: true, role: 'owner' };
    }

    // Legacy 3-part with APP_PIN check (backward compat during transition)
    if (parts.length >= 3 && parts[0] === process.env.APP_PIN) {
      const userId = parts[1];
      return { valid: true, userId, role: USER_ROLES[userId] || 'field' };
    }

    return { valid: false };
  } catch {
    return { valid: false };
  }
}
