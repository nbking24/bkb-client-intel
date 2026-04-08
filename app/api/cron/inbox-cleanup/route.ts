import { NextRequest, NextResponse } from 'next/server';
import { fetchFullInbox, archiveEmails } from '@/app/lib/google-api';

export const maxDuration = 60;

/**
 * GET /api/cron/inbox-cleanup
 *
 * Automated inbox cleanup cron job. Runs hourly via Vercel cron,
 * and also triggered by dashboard auto-refresh every 15 min.
 *
 * Uses AI to classify inbox emails and auto-archives junk.
 * Only runs during work hours (7am-9pm ET) to avoid unnecessary API calls.
 */
export async function GET(req: NextRequest) {
  try {
    // Verify cron secret OR allow from dashboard (internal calls)
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isFromCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
    const isInternal = req.nextUrl.searchParams.get('internal') === 'true';

    if (!isFromCron && !isInternal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if within work hours (7am-9pm ET)
    const etHour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        hour12: false,
      }).format(new Date()),
      10
    );

    if (etHour < 7 || etHour >= 21) {
      return NextResponse.json({ message: 'Outside work hours, skipping', etHour });
    }

    // Fetch full inbox
    const emails = await fetchFullInbox(50);
    if (emails.length === 0) {
      return NextResponse.json({ message: 'Inbox empty, nothing to clean', scanned: 0 });
    }

    // Use Claude to classify
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
    }

    const emailList = emails.map((e, i) => {
      const fromName = e.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
      const labels = e.labels.filter(l => l.startsWith('CATEGORY_')).map(l => l.replace('CATEGORY_', '').toLowerCase());
      return `${i}. FROM: ${fromName} | SUBJECT: ${e.subject} | CATEGORY: ${labels.join(',')} | SNIPPET: ${e.snippet.slice(0, 60)}`;
    }).join('\n');

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `You are an email triage assistant for Nathan King, owner of Brett King Builder-Contractor (BKB).

Classify each email as KEEP or ARCHIVE:

KEEP: emails from clients/homeowners, BKB team (Terri, Brett, Josh, Evan, Dave), vendors/subcontractors about active work, architects/engineers, personal emails needing response, business emails (invoicing, contracts), Airbnb emails needing action.

ARCHIVE: marketing newsletters, automated notifications/receipts, social media/app alerts, cold outreach, webinar invites from strangers, subscription notices, bulk industry promos.

EMAILS:
${emailList}

Respond with ONLY a JSON array: [{"index": 0, "action": "keep|archive"}]
Be aggressive about archiving — only keep emails that genuinely need Nathan's attention.`,
        }],
      }),
    });

    if (!aiRes.ok) {
      return NextResponse.json({ error: 'AI classification failed', status: aiRes.status }, { status: 500 });
    }

    const aiData = await aiRes.json();
    const aiText = (aiData.content?.[0]?.text || '').trim();
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      return NextResponse.json({ error: 'AI returned invalid format' }, { status: 500 });
    }

    const classifications: Array<{ index: number; action: string }> = JSON.parse(jsonMatch[0]);
    const toArchiveIds = classifications
      .filter(c => c.action === 'archive' && emails[c.index])
      .map(c => emails[c.index].id);

    if (toArchiveIds.length === 0) {
      return NextResponse.json({
        message: 'Inbox is clean — nothing to archive',
        scanned: emails.length,
        archived: 0,
      });
    }

    // Archive the junk
    const result = await archiveEmails(toArchiveIds);

    return NextResponse.json({
      message: `Cleaned ${result.archived} emails`,
      scanned: emails.length,
      archived: result.archived,
      failed: result.failed,
      kept: emails.length - toArchiveIds.length,
    });
  } catch (err: any) {
    console.error('[CronInboxCleanup] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
