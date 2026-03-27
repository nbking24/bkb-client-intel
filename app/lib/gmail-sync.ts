// @ts-nocheck
/**
 * Gmail Sync for Project Memory Layer
 *
 * Syncs sent + received Gmail messages into project_events.
 * Uses AI to classify emails: which project, is a reply expected, summary.
 * Detects replies on watched threads to auto-resolve open items.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  createProjectEvent,
  findEventBySourceRef,
  getOpenItems,
  resolveOpenItem,
  PMLChannel,
  PMLEventType,
} from './project-memory';

// ── Gmail API helpers ──────────────────────────────────────────

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google OAuth env vars');
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

  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);
  return data.access_token;
}

interface GmailMessageDetail {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  labels: string[];
  isSent: boolean;
}

/**
 * Fetch recent sent emails from Gmail.
 */
export async function fetchSentMail(maxResults = 20, hoursBack = 24): Promise<GmailMessageDetail[]> {
  const token = await getAccessToken();
  const query = `in:sent newer_than:${hoursBack}h`;

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!listRes.ok) return [];
  const listData = await listRes.json();
  const messageIds = (listData.messages || []).map((m: any) => m.id);
  if (messageIds.length === 0) return [];

  return fetchMessageDetails(token, messageIds, true);
}

/**
 * Fetch recent inbox emails from Gmail (broader than the dashboard's primary-only filter).
 */
export async function fetchRecentInbox(maxResults = 20, hoursBack = 24): Promise<GmailMessageDetail[]> {
  const token = await getAccessToken();
  const query = `in:inbox newer_than:${hoursBack}h`;

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!listRes.ok) return [];
  const listData = await listRes.json();
  const messageIds = (listData.messages || []).map((m: any) => m.id);
  if (messageIds.length === 0) return [];

  return fetchMessageDetails(token, messageIds, false);
}

async function fetchMessageDetails(
  token: string,
  messageIds: string[],
  isSent: boolean
): Promise<GmailMessageDetail[]> {
  const messages: GmailMessageDetail[] = [];
  const batchSize = 10;

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);
    const details = await Promise.all(
      batch.map(async (id: string) => {
        try {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
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
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      messages.push({
        id: msg.id,
        threadId: msg.threadId,
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        snippet: msg.snippet || '',
        date: getHeader('Date'),
        labels: msg.labelIds || [],
        isSent,
      });
    }
  }

  return messages;
}

// ── AI Classification ──────────────────────────────────────────

interface EmailClassification {
  jobName: string | null;
  summary: string;
  expectsReply: boolean;
  isProjectRelated: boolean;
}

/**
 * Use Claude to classify an email: which project, does it expect a reply, summary.
 */
async function classifyEmail(
  email: GmailMessageDetail,
  activeJobs: { id: string; name: string; number: string }[]
): Promise<EmailClassification> {
  try {
    const anthropic = new Anthropic();
    const jobList = activeJobs.map(j => `#${j.number} ${j.name}`).join(', ');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Classify this email for a construction company (Brett King Builder).

Active projects: ${jobList}

Email:
From: ${email.from}
To: ${email.to}
Subject: ${email.subject}
Preview: ${email.snippet}
Direction: ${email.isSent ? 'SENT by Nathan' : 'RECEIVED'}

Respond in JSON only:
{
  "jobName": "matching project name or null if no match",
  "summary": "1 sentence summary of the email",
  "expectsReply": true/false (does this email ask a question or request info that needs a response?),
  "isProjectRelated": true/false (is this about a BKB project, vendor, or client?)
}`,
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.error('[GmailSync] AI classification failed:', err);
  }

  // Fallback: basic classification
  return {
    jobName: null,
    summary: email.subject || 'Email',
    expectsReply: email.isSent && (email.snippet.includes('?') || /price|pricing|quote|estimate|when|can you|could you/i.test(email.snippet)),
    isProjectRelated: !/unsubscribe|newsletter|promo|marketing|noreply|no-reply/i.test(email.from),
  };
}

// ── Main Sync Function ─────────────────────────────────────────

export interface GmailSyncResult {
  sent: { synced: number; skipped: number; errors: number };
  received: { synced: number; skipped: number; errors: number };
  repliesDetected: number;
}

/**
 * Sync Gmail sent + received to project_events.
 * Also checks for replies on open threads to auto-resolve.
 */
export async function syncGmailToProjectMemory(
  activeJobs: { id: string; name: string; number: string }[],
  hoursBack = 24
): Promise<GmailSyncResult> {
  const result: GmailSyncResult = {
    sent: { synced: 0, skipped: 0, errors: 0 },
    received: { synced: 0, skipped: 0, errors: 0 },
    repliesDetected: 0,
  };

  // Fetch sent + received in parallel
  const [sentMail, receivedMail] = await Promise.all([
    fetchSentMail(20, hoursBack),
    fetchRecentInbox(20, hoursBack),
  ]);

  // Process sent emails
  for (const email of sentMail) {
    try {
      // Check for duplicate by message_id
      const existing = await findEventBySourceRef('gmail', 'message_id', email.id);
      if (existing) { result.sent.skipped++; continue; }

      const classification = await classifyEmail(email, activeJobs);
      if (!classification.isProjectRelated) { result.sent.skipped++; continue; }

      // Find matching job
      const matchedJob = classification.jobName
        ? activeJobs.find(j => j.name.toLowerCase().includes(classification.jobName!.toLowerCase()) ||
            classification.jobName!.toLowerCase().includes(j.name.toLowerCase()))
        : null;

      await createProjectEvent({
        job_id: matchedJob?.id || null,
        job_name: matchedJob?.name || null,
        job_number: matchedJob?.number || null,
        channel: 'gmail',
        event_type: 'message_sent',
        summary: classification.summary,
        detail: `To: ${email.to}\nSubject: ${email.subject}\n\n${email.snippet}`,
        participants: [extractName(email.to)],
        source_ref: { message_id: email.id, thread_id: email.threadId, subject: email.subject, to: email.to },
        open_item: classification.expectsReply,
        open_item_description: classification.expectsReply
          ? `Waiting on reply from ${extractName(email.to)} re: ${email.subject}`
          : null,
      });
      result.sent.synced++;
    } catch (err) {
      console.error('[GmailSync] Error processing sent email:', err);
      result.sent.errors++;
    }
  }

  // Process received emails
  for (const email of receivedMail) {
    try {
      const existing = await findEventBySourceRef('gmail', 'message_id', email.id);
      if (existing) { result.received.skipped++; continue; }

      const classification = await classifyEmail(email, activeJobs);
      if (!classification.isProjectRelated) { result.received.skipped++; continue; }

      const matchedJob = classification.jobName
        ? activeJobs.find(j => j.name.toLowerCase().includes(classification.jobName!.toLowerCase()) ||
            classification.jobName!.toLowerCase().includes(j.name.toLowerCase()))
        : null;

      await createProjectEvent({
        job_id: matchedJob?.id || null,
        job_name: matchedJob?.name || null,
        job_number: matchedJob?.number || null,
        channel: 'gmail',
        event_type: 'message_received',
        summary: classification.summary,
        detail: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.snippet}`,
        participants: [extractName(email.from)],
        source_ref: { message_id: email.id, thread_id: email.threadId, subject: email.subject, from: email.from },
      });
      result.received.synced++;
    } catch (err) {
      console.error('[GmailSync] Error processing received email:', err);
      result.received.errors++;
    }
  }

  // Check for replies on open threads — auto-resolve matching open items
  try {
    const openItems = await getOpenItems({ limit: 50 });
    const gmailOpenItems = openItems.filter(item =>
      item.channel === 'gmail' && item.source_ref?.thread_id
    );

    for (const openItem of gmailOpenItems) {
      const threadId = openItem.source_ref?.thread_id;
      if (!threadId) continue;

      // Check if any received email is in this thread
      const replyInThread = receivedMail.find(e => e.threadId === threadId);
      if (replyInThread) {
        await resolveOpenItem(
          openItem.id,
          `Reply received from ${extractName(replyInThread.from)}: ${replyInThread.snippet.slice(0, 200)}`,
          true // auto_resolved
        );
        result.repliesDetected++;
      }
    }
  } catch (err) {
    console.error('[GmailSync] Error checking for replies:', err);
  }

  return result;
}

// ── Helpers ────────────────────────────────────────────────────

function extractName(emailAddress: string): string {
  // "John Smith <john@example.com>" → "John Smith"
  const match = emailAddress.match(/^(.+?)\s*<.*>$/);
  if (match) return match[1].replace(/"/g, '').trim();
  // "john@example.com" → "john@example.com"
  return emailAddress.trim();
}
