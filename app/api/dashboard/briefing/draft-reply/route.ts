// @ts-nocheck
// POST /api/dashboard/briefing/draft-reply
//
// action 'generate':
//   source 'email'    { threadId, extraContext? }  -> reply to a Gmail thread
//   source 'jobtread' { jobId, jobName?, commentText?, commentAuthor?, extraContext? }
//                       -> reply to a JobTread message/comment
//   Returns { draft (markdown), replyMeta?, jobMatched? }. replyMeta only for email.
// action 'createDraft' (email only): { threadId, to, subject, body, inReplyTo, references }
//   -> creates a threaded Gmail draft. Returns { gmailUrl }.
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateAuth } from '@/app/api/lib/auth';
import { getThreadForReply, createGmailReplyDraft, searchGmailMessages } from '@/app/lib/google-api';
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
function matchJob(jobs: any[], haystack: string): any | null {
  const hay = ` ${haystack.toLowerCase()} `;
  let best: any = null; let bestScore = 0;
  for (const j of jobs) {
    const cand = [...tokens(j.name || ''), ...tokens(j.clientName || '')].filter((t) => !STOP.has(t));
    let score = 0;
    for (const t of new Set(cand)) if (hay.includes(t)) score += 1;
    if (score > bestScore) { bestScore = score; best = j; }
  }
  return bestScore >= 1 ? best : null;
}

function extraBlock(extraContext?: string): string {
  const x = (extraContext || '').trim();
  if (!x) return '';
  return `\n\n===== ADDITIONAL CONTEXT / INSTRUCTIONS FROM NATHAN (apply these, they take priority) =====\n${x.slice(0, 4000)}`;
}

async function callClaude(system: string, user: string): Promise<string> {
  const anthropic = new Anthropic();
  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1100,
    system,
    messages: [{ role: 'user', content: user }],
  });
  let out = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : '';
  // Em-dash safety net (Nathan's rule).
  return out.replace(/\s*—\s*/g, ', ').replace(/—/g, '-');
}

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!isNathan(auth)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }); }
  const action = body?.action || 'generate';
  const source = body?.source || 'email';

  // ---- Create a threaded Gmail draft (email only) ----
  if (action === 'createDraft') {
    if (!body?.threadId || !body?.to || !body?.body) {
      return NextResponse.json({ error: 'threadId, to, and body are required' }, { status: 400 });
    }
    const out = await createGmailReplyDraft({
      threadId: body.threadId, to: body.to, subject: body.subject || '', body: body.body,
      inReplyTo: body.inReplyTo || null, references: body.references || null, userId: NATHAN_GOOGLE_USER,
    });
    if (!out) return NextResponse.json({ error: 'Failed to create Gmail draft' }, { status: 502 });
    return NextResponse.json({ ok: true, ...out });
  }

  const system = `You draft replies AS Nathan King, owner of Brett King Builder. Write only the reply body Nathan would send, ready to paste. Follow his brand voice and writing rules exactly.\n\n${NATHAN_BRAND_VOICE}`;

  try {
    // ============ JobTread message reply ============
    if (source === 'jobtread') {
      const jobId = body?.jobId;
      if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });
      const jobName = body?.jobName || '';

      const comments = await getCommentsFromDB(jobId, 30).catch(() => []);
      const thread = (comments || [])
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-20)
        .map((c) => `- ${c.name || 'BKB'} (${(c.createdAt || '').split('T')[0]}): ${(c.message || '').slice(0, 400)}`)
        .join('\n');

      // Cross-reference related emails for additional context (best-effort).
      let gmail = '';
      try {
        const q = (jobName || '').replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 3).join(' ');
        if (q) {
          const msgs = await searchGmailMessages(q, 4, NATHAN_GOOGLE_USER);
          gmail = (msgs || []).map((m) => `- ${m.from} (${m.subject}): ${m.snippet}`).join('\n');
        }
      } catch { /* optional */ }

      const target = body?.commentText
        ? `The specific message Nathan needs to reply to is from ${body?.commentAuthor || 'a team member or client'}:\n"${String(body.commentText).slice(0, 1200)}"`
        : `Reply to the most recent message in the JobTread conversation below.`;

      const user = `Draft Nathan's reply to a JobTread message on job ${jobName ? `"${jobName}"` : ''}. ${target}

Address what they asked or need and propose a clear next step. Use only facts supported by the context. If something needs confirming, say Nathan will confirm and follow up rather than inventing it. Do NOT use em dashes. This is a JobTread message, so do NOT add an email signature.

===== JOBTREAD CONVERSATION (oldest to newest) =====
${thread || '(no recent messages found)'}

===== RELATED EMAILS (context only) =====
${gmail || '(none found)'}${extraBlock(body?.extraContext)}

Write the reply now.`;

      const draft = await callClaude(system, user);
      return NextResponse.json({ ok: true, draft, jobMatched: jobName ? { name: jobName, id: jobId } : null });
    }

    // ============ Email reply (default) ============
    const threadId = body?.threadId;
    if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

    const thread = await getThreadForReply(threadId, NATHAN_GOOGLE_USER);
    if (!thread) return NextResponse.json({ error: 'Could not load email thread' }, { status: 502 });

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
          .slice(0, 15).reverse()
          .map((c) => `- ${c.name || 'BKB'} (${(c.createdAt || '').split('T')[0]}): ${(c.message || '').slice(0, 300)}`)
          .join('\n');
        jtContext = `JobTread job: #${job.number} ${job.name}${job.clientName ? ` (client: ${job.clientName})` : ''}\nRecent JobTread messages on this job:\n${recent || '(none)'}`;
      }
    } catch { /* optional */ }

    const threadText = thread.messages
      .map((m) => `From: ${m.from}\nDate: ${m.date}\n${m.bodyText}`)
      .join('\n\n----- next message -----\n\n').slice(0, 14000);

    const user = `Draft Nathan's reply to the latest message in this email thread. Reply to the most recent message from the other party, address what they actually asked or need, and propose a clear next step. Use only facts supported by the thread and the JobTread context below. If a detail needs confirming, say Nathan will confirm and follow up rather than inventing it.

Do NOT include a subject line. Do NOT include the signature block (it is added automatically). Do NOT use em dashes.

===== EMAIL THREAD (oldest to newest) =====
${threadText}

===== JOBTREAD CONTEXT =====
${jtContext || '(no matching JobTread job found; rely on the thread)'}${extraBlock(body?.extraContext)}

Write the reply body now.`;

    const draft = await callClaude(system, user);
    const draftWithSig = `${draft}\n\n${NATHAN_SIGNATURE}`;

    return NextResponse.json({
      ok: true,
      draft: draftWithSig,
      jobMatched,
      replyMeta: {
        threadId: thread.threadId, to: thread.replyTo, subject: thread.subject,
        inReplyTo: thread.inReplyTo, references: thread.references,
      },
    });
  } catch (err: any) {
    console.error('[draft-reply] failed:', err?.message);
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
