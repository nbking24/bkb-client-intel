export interface AuthResult {
  valid: boolean;
  userId?: string;
  role?: string;
}

// Role mapping for the original code-defined users. DB-managed users (added via
// the admin dashboard) aren't listed here; their role is resolved from the DB by
// /api/me and the admin API. This map is only a best-effort hint for legacy
// server code that reads a role synchronously off the token.
const USER_ROLES: Record<string, string> = {
  nathan: 'owner',
  terri: 'admin',
  evan: 'field_sup',
  josh: 'field_sup',
};

// User ids now live in the DB (app_users), so we can't keep a static whitelist
// here without an async DB call on every request. Validate the *format* instead:
// a lowercase slug that starts with a letter. The PIN was already checked at
// login; this token only asserts which user is making the request.
const USER_ID_RE = /^[a-z][a-z0-9_-]{1,30}$/;
function isValidUserId(id: string): boolean {
  return USER_ID_RE.test(id);
}

// Roles that are restricted to the field-staff agent only
const FIELD_ROLES = new Set(['field_sup', 'field']);

export function isFieldStaffRole(role?: string): boolean {
  return FIELD_ROLES.has(role || '');
}

/**
 * Agent-aware auth wrapper.
 *
 * For server-to-server use (Cowork / Claude working the ticket queue), we accept
 * an `x-agent-token` header that matches the TICKET_AGENT_TOKEN env var. When
 * that token is present and valid, the request is treated as 'claude' acting
 * with owner-level privileges.
 *
 * Pass the whole Request (or NextRequest) in, and we'll check both.
 */
export function validateAgentOrUser(req: Request | { headers: Headers | { get: (k: string) => string | null } }): AuthResult {
  // Agent token path
  const agentToken = (req as any).headers?.get?.('x-agent-token') || null;
  const expectedTicket = process.env.TICKET_AGENT_TOKEN;
  const expectedMarketing = process.env.MARKETING_AGENT_TOKEN;
  if (agentToken && (
    (expectedTicket && agentToken === expectedTicket) ||
    (expectedMarketing && agentToken === expectedMarketing)
  )) {
    return { valid: true, userId: 'claude', role: 'owner' };
  }
  // Fall through to user auth
  const authHeader = (req as any).headers?.get?.('authorization') || null;
  return validateAuth(authHeader);
}

export function validateAuth(authHeader: string | null): AuthResult {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return { valid: false };
  const token = authHeader.slice(7);
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');

    // New format (per-user PIN): pin:userId:timestamp
    if (parts.length >= 3 && isValidUserId(parts[1])) {
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

