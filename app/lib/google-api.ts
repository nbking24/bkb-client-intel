/**
 * Google API Helper — Gmail & Calendar
 *
 * Uses OAuth2 refresh tokens to get access tokens and fetch data from
 * Gmail and Google Calendar APIs server-side. Supports multiple Google
 * accounts keyed by userId (e.g. 'nathan' → nathan@, 'terri' → brett@).
 *
 * Required env vars:
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - GOOGLE_REFRESH_TOKEN          (default / Nathan's account)
 * - GOOGLE_REFRESH_TOKEN_TERRI    (Terri's account — brett@brettkingbuilder.com)
 */

// Per-account token cache
const tokenCache: Record<string, { token: string; expiresAt: number }> = {};

// Map userId → env var name for their Google refresh token
const REFRESH_TOKEN_ENV: Record<string, string> = {
  nathan: 'GOOGLE_REFRESH_TOKEN',
  terri:  'GOOGLE_REFRESH_TOKEN_TERRI',
};

/**
 * Get a valid access token for the given user, refreshing if needed.
 * Falls back to the default GOOGLE_REFRESH_TOKEN if no user-specific one is set.
 */
async function getAccessToken(userId?: string): Promise<string> {
  const cacheKey = userId || '_default';
  const cached = tokenCache[cacheKey];
  if (cached && Date.now() < cached.expiresAt - 60000) {
    return cached.token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // Pick the right refresh token: user-specific first, then default
  const envName = (userId && REFRESH_TOKEN_ENV[userId]) || 'GOOGLE_REFRESH_TOKEN';
  const refreshToken = process.env[envName] || process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`Missing Google OAuth env vars (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ${envName})`);
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google token refresh failed for ${cacheKey}: ${res.status} ${err.error || ''}`);
  }

  const data = await res.json();
  tokenCache[cacheKey] = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
  return data.access_token;
}

// ============================================================
// Gmail
// ============================================================

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  labels: string[];
}

/**
 * Fetch recent inbox emails that may need attention.
 * Filters out promotions, social, and automated notifications.
 */
export async function fetchGmailInbox(maxResults = 15, userId?: string): Promise<GmailMessage[]> {
  try {
    const token = await getAccessToken(userId);

    // Search for recent primary inbox emails (skip promotions, social, updates)
    const query = 'in:inbox category:primary newer_than:3d';
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) {
      console.error('[GoogleAPI] Gmail list failed:', listRes.status);
      return [];
    }

    const listData = await listRes.json();
    const messageIds = (listData.messages || []).map((m: any) => m.id);

    if (messageIds.length === 0) return [];

    // Fetch message details in parallel (metadata only — no body)
    const messages: GmailMessage[] = [];
    const batchSize = 10;
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map(async (id: string) => {
          try {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!msgRes.ok) return null;
            return msgRes.json();
          } catch {
            return null;
          }
        })
      );

      for (const msg of details) {
        if (!msg) continue;
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        messages.push({
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader('From'),
          subject: getHeader('Subject'),
          snippet: msg.snippet || '',
          date: getHeader('Date'),
          isUnread: (msg.labelIds || []).includes('UNREAD'),
          labels: msg.labelIds || [],
        });
      }
    }

    return messages;
  } catch (err: any) {
    console.error('[GoogleAPI] Gmail fetch error:', err.message);
    return [];
  }
}

/**
 * Create a Gmail draft with the given recipient, subject, and body.
 * Returns the draft ID and a link to open it in Gmail.
 */
export async function createGmailDraft(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ draftId: string; gmailUrl: string } | null> {
  try {
    const token = await getAccessToken();

    // Build RFC 2822 email message
    const email = [
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      params.body,
    ].join('\r\n');

    // Base64url encode
    const encoded = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: { raw: encoded },
      }),
    });

    if (!res.ok) {
      console.error('[GoogleAPI] Create draft failed:', res.status);
      return null;
    }

    const data = await res.json();
    const draftId = data.id;
    const messageId = data.message?.id;

    // Gmail URL to open the draft
    const gmailUrl = messageId
      ? `https://mail.google.com/mail/#drafts/${messageId}`
      : 'https://mail.google.com/mail/#drafts';

    return { draftId, gmailUrl };
  } catch (err: any) {
    console.error('[GoogleAPI] Create draft error:', err.message);
    return null;
  }
}

const CLEANUP_LABEL_NAME = 'BKB Cleanup';
let cachedCleanupLabelId: string | null = null;

/**
 * Get or create the "BKB Cleanup" Gmail label.
 * Caches the label ID for the lifetime of the serverless function.
 */
async function getCleanupLabelId(): Promise<string> {
  if (cachedCleanupLabelId) return cachedCleanupLabelId;

  const token = await getAccessToken();

  // List existing labels to find it
  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/labels',
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (listRes.ok) {
    const listData = await listRes.json();
    const existing = (listData.labels || []).find(
      (l: any) => l.name === CLEANUP_LABEL_NAME
    );
    if (existing) {
      cachedCleanupLabelId = existing.id;
      return existing.id;
    }
  }

  // Label doesn't exist — create it
  const createRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/labels',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: CLEANUP_LABEL_NAME,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
        color: {
          textColor: '#ffffff',
          backgroundColor: '#994a64',
        },
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(`Failed to create cleanup label: ${createRes.status} ${JSON.stringify(err)}`);
  }

  const labelData = await createRes.json();
  cachedCleanupLabelId = labelData.id;
  return labelData.id;
}

/**
 * DISABLED 2026-04-24 — previously moved emails into the "BKB Cleanup"
 * Gmail label (adding the label and removing INBOX). Nathan asked for
 * this to be fully disabled after wanted emails got archived. This
 * function is now a no-op that logs the attempt and returns a
 * zeroed-out result. Cron and dashboard callers have also been
 * neutered; this is belt-and-suspenders in case of future imports.
 *
 * To re-enable, restore from git history (commit before this change).
 */
export async function archiveEmails(messageIds: string[]): Promise<{ archived: number; failed: number }> {
  console.warn('[GoogleAPI] archiveEmails is disabled — no emails were moved. Requested:', messageIds.length);
  return { archived: 0, failed: 0 };
}

/**
 * Fetch broader inbox for cleanup analysis — includes promotions, social, updates.
 * Unlike fetchGmailInbox which filters to primary only, this gets everything.
 */
export async function fetchFullInbox(maxResults = 30, userId?: string): Promise<GmailMessage[]> {
  try {
    const token = await getAccessToken(userId);

    const query = 'in:inbox newer_than:3d';
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) return [];

    const listData = await listRes.json();
    const messageIds = (listData.messages || []).map((m: any) => m.id);
    if (messageIds.length === 0) return [];

    const messages: GmailMessage[] = [];
    const batchSize = 10;
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map(async (id: string) => {
          try {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!msgRes.ok) return null;
            return msgRes.json();
          } catch { return null; }
        })
      );

      for (const msg of details) {
        if (!msg) continue;
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        messages.push({
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader('From'),
          subject: getHeader('Subject'),
          snippet: msg.snippet || '',
          date: getHeader('Date'),
          isUnread: (msg.labelIds || []).includes('UNREAD'),
          labels: msg.labelIds || [],
        });
      }
    }

    return messages;
  } catch (err: any) {
    console.error('[GoogleAPI] Full inbox fetch error:', err.message);
    return [];
  }
}

// ============================================================
// Google Calendar
// ============================================================

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  attendeeCount: number;
  status: string;
}

/**
 * Fetch calendar events for a date range.
 * Default: next 7 days from now.
 * Can specify custom start/end for tomorrow-only queries.
 */
export async function fetchCalendarEvents(
  daysAhead = 7,
  customStart?: Date,
  customEnd?: Date,
  userId?: string
): Promise<CalendarEvent[]> {
  try {
    const token = await getAccessToken(userId);

    const timeMin = (customStart || new Date()).toISOString();
    const timeMax = (customEnd || new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000)).toISOString();

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!calRes.ok) {
      console.error('[GoogleAPI] Calendar fetch failed:', calRes.status);
      return [];
    }

    const calData = await calRes.json();
    const events: CalendarEvent[] = [];

    for (const e of (calData.items || [])) {
      // Skip cancelled events and all-day "out of office" type events that are transparent
      if (e.status === 'cancelled') continue;

      const isAllDay = !!e.start?.date;
      events.push({
        id: e.id,
        summary: e.summary || '(No title)',
        start: e.start?.dateTime || e.start?.date || '',
        end: e.end?.dateTime || e.end?.date || '',
        allDay: isAllDay,
        location: e.location || '',
        description: (e.description || '').slice(0, 200),
        attendeeCount: (e.attendees || []).length,
        status: e.status || 'confirmed',
      });
    }

    return events;
  } catch (err: any) {
    console.error('[GoogleAPI] Calendar fetch error:', err.message);
    return [];
  }
}
