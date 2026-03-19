/**
 * Google API Helper — Gmail & Calendar
 *
 * Uses OAuth2 refresh token to get access tokens and fetch data from
 * Gmail and Google Calendar APIs server-side. The refresh token never
 * expires unless revoked.
 *
 * Required env vars:
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - GOOGLE_REFRESH_TOKEN
 */

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Get a valid access token, refreshing if needed.
 */
async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google OAuth env vars (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)');
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
    throw new Error(`Google token refresh failed: ${res.status} ${err.error || ''}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);
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
export async function fetchGmailInbox(maxResults = 15): Promise<GmailMessage[]> {
  try {
    const token = await getAccessToken();

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
 * Fetch upcoming calendar events for the next 7 days.
 */
export async function fetchCalendarEvents(daysAhead = 7): Promise<CalendarEvent[]> {
  try {
    const token = await getAccessToken();

    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=20`,
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
