import { NextRequest, NextResponse } from 'next/server';
import { fetchFullInbox, archiveEmails, type GmailMessage } from '@/app/lib/google-api';

export const maxDuration = 60;

/**
 * POST /api/dashboard/inbox-cleanup
 *
 * AI-powered inbox cleanup. Fetches all inbox emails, uses Claude to classify
 * each as "keep" or "archive", then archives the junk in batch.
 *
 * Body: { mode: 'preview' | 'execute' }
 * - preview: Returns classification without archiving (for review)
 * - execute: Classifies AND archives junk emails
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode = body.mode || 'preview';

    // Fetch full inbox (including promotions, social, updates)
    const emails = await fetchFullInbox(50);
    if (emails.length === 0) {
      return NextResponse.json({ message: 'Inbox is empty', toArchive: [], toKeep: [] });
    }

    // Build email summary for AI classification
    const emailList = emails.map((e, i) => {
      const fromName = e.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
      const labels = e.labels.filter(l => l.startsWith('CATEGORY_')).map(l => l.replace('CATEGORY_', '').toLowerCase());
      return `${i}. FROM: ${fromName} | SUBJECT: ${e.subject} | CATEGORY: ${labels.join(',')} | UNREAD: ${e.isUnread} | SNIPPET: ${e.snippet.slice(0, 80)}`;
    }).join('\n');

    // Use Claude to classify
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
    }

    const classifyPrompt = `You are an email triage assistant for Nathan King, owner of Brett King Builder-Contractor (BKB), a high-end residential renovation company.

Classify each email as KEEP or ARCHIVE based on these rules:

KEEP (stays in inbox):
- Emails from clients, homeowners, or potential clients about projects
- Emails from team members (Terri, Brett, Josh, Evan, Dave)
- Emails from vendors, subcontractors, or suppliers about active work (lumber, plumbing, permits)
- Emails from architects, engineers, or designers (Ken Cloonan, Bob DiTori, etc.)
- Personal emails from real people that need a response
- Important business emails (invoicing, contracts, legal)
- Airbnb/property management emails that need action (guest arrivals, issues)

ARCHIVE (auto-remove from inbox):
- Marketing newsletters and promotional emails
- Automated system notifications (receipts, order confirmations, shipping updates)
- Social media and app notifications (Steam, gaming, etc.)
- Cold outreach and unsolicited sales pitches
- Webinar invitations from strangers
- Subscription renewal notices
- Bulk marketing from companies (NARI newsletters, industry promos)
- Automated support ticket updates that don't need a response

EMAILS TO CLASSIFY:
${emailList}

Respond with ONLY valid JSON — an array of objects, one per email:
[{"index": 0, "action": "keep|archive", "reason": "brief reason"}]

Be aggressive about archiving — Nathan wants a clean inbox with only actionable emails.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: classifyPrompt }],
      }),
    });

    if (!aiRes.ok) {
      return NextResponse.json({ error: 'AI classification failed' }, { status: 500 });
    }

    const aiData = await aiRes.json();
    const aiText = (aiData.content?.[0]?.text || '').trim();
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      return NextResponse.json({ error: 'AI returned invalid format' }, { status: 500 });
    }

    const classifications: Array<{ index: number; action: string; reason: string }> = JSON.parse(jsonMatch[0]);

    const toArchive: Array<{ id: string; from: string; subject: string; reason: string }> = [];
    const toKeep: Array<{ id: string; from: string; subject: string; reason: string }> = [];

    for (const c of classifications) {
      const email = emails[c.index];
      if (!email) continue;
      const fromName = email.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
      const item = { id: email.id, from: fromName, subject: email.subject, reason: c.reason };
      if (c.action === 'archive') {
        toArchive.push(item);
      } else {
        toKeep.push(item);
      }
    }

    // Execute archiving if mode is 'execute'
    let archiveResult = null;
    if (mode === 'execute' && toArchive.length > 0) {
      const ids = toArchive.map(e => e.id);
      archiveResult = await archiveEmails(ids);
    }

    return NextResponse.json({
      total: emails.length,
      toArchive,
      toKeep,
      archiveResult,
      mode,
    });
  } catch (err: any) {
    console.error('[InboxCleanup] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
