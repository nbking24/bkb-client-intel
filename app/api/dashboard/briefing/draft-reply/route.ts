// @ts-nocheck
// POST /api/dashboard/briefing/draft-reply
//   action 'generate'  { threadId } -> drafts a reply in Nathan's voice using the
//                        full Gmail thread + matched JobTread context. Returns
//                        { draft, replyMeta, jobMatched }.
//   action 'createDraft' { threadId, to, subject, body, inReplyTo, references }
//                        -> creates a threaded Gmail draft. Returns { gmailUrl }.
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateAuth } from '@/app/api/lib/auth';
import { getThreadForReply, createGmailReplyDraft } from '@/app/lib/google-api';
import { getActiveJobs, getCommentsFromDB } from '@/app/lib/jobtread';
import { NATHAN_BRAND_VOICE, NATHAN_SIGNATURE } from '@/app/lib/nathan-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NATHAN_GOOGLE_USER = 'nathan';
function isNathan(auth: any): boolean {
  return auth?.valid && (auth.userId === 'nathan' || auth.role === 'owner');
}

function tokens(s: string): string[] {
  return (s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
}
const STOP = new Set(['the','and','for','you','your','our','with','this','that','from','have','about','re','fwd','inc','llc','project','plans','please','thanks','question']);

// Best-effort match of an email thread to an active job by name/client tokens.
function matchJob(jobs: any[], haystack: string): any | null {
  const hay = ` ${haystack.toLowerCase()} `;
  let best: any = null;
  let bestScore = 0;
  for (const j of jobs) {
    const cand = [...tokens(j.name || ''), ...tokens(j.clientName || '')].filter((t) => !STOP.has(t));
    let score = 0;
    for (const t of new Set(cand)) if (hay.includes(t)) score += 1;
    if (score > bestScore) { bestScore = score; best = j; }
  }
  return bestScore >= 1 ? best : null;
}

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!isNathan(auth)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }); }
  const action = body?.action || 'generate';

  if (action === 'createDraft') {
    if (!body?.threadId || !body?.to || !body?.body) {
      return NextResponse.json({ error: 'threadId, to, and body are required' }, { status: 400 });
    }
    const out = await createGmailReplyDraft({
      threadId: body.threadId,
      to: body.to,
      subject: body.subject || '',
      body: body.body,
      inReplyTo: body.inReplyTo || null,
      references: body.references || null,
      userId: NATHAN_GOOGLE_USER,
    });
    if (!out) return NextResponse.json({ error: 'Failed to create Gmail draft' }, { status: 502 });
    return NextResponse.json({ ok: true, ...out });
  }

  // action: generate
  try {
    const threadId = body?.threadId;
    if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

    const thread = await getThreadForReply(threadId, NATHAN_GOOGLE_USER);
    if (!thread) return NextResponse.json({ error: 'Could not load email thread' }, { status: 502 });

    // Match a JobTread job and pull recent comments for context.
    let jobMatched: any = null;
    let jtContext = '';
    try {
      const jobs = await getActiveJobs().catch(() => []);
      const haystack = `${thread.subject} ${thread.replyTo} ${thread.messages.map((m) => m.from).join(' ')}`;
      const job = matchJob(jobs, haystack);
      if (job) {
        jobMatched = { id: job.id, name: job.name, number: job.number, clientName: job.clientName };
        const comments = await getCommentsFromDB(job.id, 30).catch(() => []);
        const recent = (comments || [])
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 15)
          .map((c) => `- ${c.name || 'BKB'} (${(c.createdAt || '').split('T')[0]}): ${(c.message || '').slice(0, 300)}`)
          .reverse()
          .join('\n');
        jtContext = `JobTread job: #${job.number} ${job.name}${job.clientName ? ` (client: ${job.clientName})` : ''}\nRecent JobTread messages on this job:\n${recent || '(none)'}`;
      }
    } catch { /* JT context optional */ }

    const threadText = thread.messages
      .map((m) => `From: ${m.from}\nDate: ${m.date}\n${m.bodyText}`)
      .join('\n\n----- next message -----\n\n')
      .slice(0, 14000);

    const anthropic = new Anthropic();
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1100,
      system: `You draft email replies AS Nathan King, owner of Brett King Builder. Write only the reply body Nathan would send, ready to paste. Follow his brand voice and writing rules exactly.\n\n${NATHAN_BRAND_VOICE}`,
      messages: [{
        role: 'user',
        content: `Draft Nathan's reply to the latest message in this email thread. Reply to the most recent message from the other party, address what they actually asked or need, and propose a clear next step. Use only facts supported by the thread and the JobTread context below. If a detail needs confirming, say Nathan will confirm and follow up rather than inventing it.

Do NOT include a subject line. Do NOT include the signature block (it is added automatically). Do NOT use em dashes.

===== EMAIL THREAD (oldest to newest) =====
${threadText}

===== JOBTREAD CONTEXT =====
${jtContext || '(no matching JobTread job found; rely on the thread)'}

Write the reply body now.`,
      }],
    });

    let draft = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : '';
    // Safety net: strip any em dashes the model may have produced.
    draft = draft.replace(/\s*—\s*/g, ', ').replace(/—/g, '-');
    const draftWithSig = `${draft}\n\n${NATHAN_SIGNATURE}`;

    return NextResponse.json({
      ok: true,
      draft: draftWithSig,
      jobMatched,
      replyMeta: {
        threadId: thread.threadId,
        to: thread.replyTo,
        subject: thread.subject,
        inReplyTo: thread.inReplyTo,
        references: thread.references,
      },
    });
  } catch (err: any) {
    console.error('[draft-reply] failed:', err?.message);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
