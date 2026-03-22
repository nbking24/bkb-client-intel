import { NextRequest, NextResponse } from 'next/server';
import { buildUserDashboardData } from '@/app/lib/dashboard-data';
import { createGmailDraft } from '@/app/lib/google-api';
import { updateTaskProgress, pave } from '@/app/lib/jobtread';
import { createServerClient } from '@/app/lib/supabase';

export const maxDuration = 60;

/**
 * POST /api/dashboard/chat
 *
 * Separate chat endpoint for the Overview dashboard chat widget.
 * Does NOT touch the existing /api/chat or Ask Agent system.
 *
 * Has full context of dashboard data (JT tasks, Gmail, Calendar, jobs)
 * and can take actions (draft emails, complete tasks, create tasks).
 *
 * Body: { userId: string, message: string, history?: Array<{role, content}> }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, message, history = [] } = body;

    if (!userId || !message) {
      return NextResponse.json({ error: 'userId and message required' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
    }

    // Build fresh dashboard context (or use cached if recent)
    let dashboardContext = '';
    try {
      // Try cache first (< 5 min old)
      const supabase = createServerClient();
      const { data: cached } = await supabase
        .from('agent_cache')
        .select('data, updated_at')
        .eq('key', `dashboard-overview-${userId}`)
        .single();

      const cacheAge = cached?.updated_at
        ? (Date.now() - new Date(cached.updated_at).getTime()) / 60000
        : Infinity;

      if (cached && cacheAge < 5) {
        const d = cached.data?.data;
        if (d) {
          dashboardContext = buildContextString(d);
        }
      }

      if (!dashboardContext) {
        const data = await buildUserDashboardData(userId);
        dashboardContext = buildContextString(data);
      }
    } catch (err: any) {
      console.error('[DashboardChat] Failed to build context:', err.message);
      dashboardContext = '(Dashboard data unavailable)';
    }

    const TZ = 'America/New_York';
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

    const systemPrompt = `You are Nathan's operations assistant for Brett King Builder-Contractor (BKB), a high-end residential renovation company. You are embedded in the Operations Dashboard and have full context of Nathan's current tasks, emails, calendar, and active jobs.

Today is ${todayStr}, ${timeStr} ET.

CURRENT DASHBOARD DATA:
${dashboardContext}

YOUR CAPABILITIES:
- Answer questions about Nathan's tasks, schedule, emails, and active jobs
- Draft email replies (you can create Gmail drafts that Nathan can review and send)
- Help prioritize work and make recommendations
- Provide project status updates based on JT data
- Help with scheduling and calendar awareness

COMMUNICATION STYLE:
- Be direct and concise — Nathan is busy
- Use specific names, job numbers, and dates from the data
- When drafting emails, use a professional but friendly BKB brand voice
- If asked about something not in the data, say so honestly

IMPORTANT: You are NOT the Ask Agent. You are a lightweight dashboard assistant. For complex JT operations (creating budgets, managing documents, spec writing), direct Nathan to the Ask Agent page.`;

    // Build conversation messages
    const messages = [
      ...history.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: message },
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      console.error('[DashboardChat] Claude API error:', res.status);
      return NextResponse.json({ error: 'AI response failed' }, { status: 500 });
    }

    const aiData = await res.json();
    const reply = (aiData.content?.[0]?.text || '').trim();

    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error('[DashboardChat] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Build a concise context string from dashboard data for the chat system prompt */
function buildContextString(data: any): string {
  const TZ = 'America/New_York';
  const parts: string[] = [];

  // Stats
  const s = data.stats || {};
  parts.push(`STATS: ${s.totalTasks || 0} tasks (${s.urgentTasks || 0} urgent), ${s.activeJobCount || 0} active jobs, ${s.unreadEmailCount || 0} unread emails, ${s.upcomingEventsCount || 0} calendar events`);

  // Tasks (top 15)
  if (data.tasks?.length > 0) {
    parts.push('\nTASKS:');
    for (const t of data.tasks.slice(0, 15)) {
      const due = t.daysUntilDue !== null
        ? (t.daysUntilDue < 0 ? `${Math.abs(t.daysUntilDue)}d overdue` : t.daysUntilDue === 0 ? 'today' : `${t.daysUntilDue}d`)
        : 'no date';
      parts.push(`- ${t.name} (${t.jobName} #${t.jobNumber}) — ${due}${t.assignee ? `, assigned: ${t.assignee}` : ''}`);
    }
  }

  // Calendar (top 10)
  if (data.calendarEvents?.length > 0) {
    parts.push('\nCALENDAR:');
    for (const e of data.calendarEvents.slice(0, 10)) {
      const start = new Date(e.start);
      const day = start.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
      const time = e.allDay ? 'All day' : start.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
      parts.push(`- ${day} ${time}: ${e.summary}${e.location ? ` @ ${e.location.slice(0, 40)}` : ''}`);
    }
  }

  // Gmail (top 10)
  if (data.recentEmails?.length > 0) {
    parts.push('\nRECENT EMAILS:');
    for (const e of data.recentEmails.slice(0, 10)) {
      const from = e.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
      parts.push(`- ${from}: ${e.subject}${e.isUnread ? ' [UNREAD]' : ''}`);
    }
  }

  // Active jobs (top 20)
  if (data.activeJobs?.length > 0) {
    parts.push('\nACTIVE JOBS:');
    for (const j of data.activeJobs.slice(0, 20)) {
      parts.push(`- #${j.number} ${j.name}${j.status ? ` (${j.status})` : ''}`);
    }
  }

  // JT Messages (top 5)
  if (data.recentMessages?.length > 0) {
    parts.push('\nJT MESSAGES DIRECTED AT NATHAN:');
    for (const m of data.recentMessages.slice(0, 5)) {
      parts.push(`- ${m.authorName} on ${m.jobName}: "${m.content.slice(0, 80)}"`);
    }
  }

  return parts.join('\n');
}
