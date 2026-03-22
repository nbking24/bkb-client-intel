/**
 * Dashboard AI Analysis Engine
 *
 * Takes aggregated user data and produces a structured AI analysis
 * with urgent items, deadlines, flagged messages, emails needing replies, and action items.
 * Uses role-specific prompts for personalized insights.
 */

import type { UserDashboardData, TimePeriod } from './dashboard-data';
import type { TeamRole } from './constants';
import { NATHAN_BRAND_VOICE } from './nathan-voice';

export interface TomorrowBriefing {
  headline: string;
  calendarWalkthrough: Array<{ time: string; event: string; prepNote: string }>;
  tasksDue: Array<{ task: string; jobName: string }>;
  prepTonightOrAM: string[];
}

export interface SuggestedAction {
  title: string;
  actionType: 'reply-email' | 'complete-task' | 'reschedule-task' | 'follow-up' | 'prep-meeting' | 'review-document';
  context: {
    taskId?: string;
    taskName?: string;
    emailSubject?: string;
    recipient?: string;
    jobName?: string;
    suggestedDate?: string;
    suggestedText?: string;
  };
  priority: 'high' | 'medium' | 'low';
}

export interface MeetingPrepNote {
  eventSummary: string;
  time: string;
  prepNote: string;
  relatedJobName?: string;
}

export interface DashboardAnalysis {
  summary: string;
  urgentItems: Array<{ title: string; description: string; jobName?: string }>;
  upcomingDeadlines: Array<{ title: string; dueDate: string; daysUntilDue: number; jobName?: string }>;
  flaggedMessages: Array<{ preview: string; jobName: string; authorName: string; reason: string }>;
  emailsNeedingReply: Array<{ from: string; subject: string; snippet: string; reason: string }>;
  actionItems: Array<{ action: string; priority: 'high' | 'medium' | 'low'; jobName?: string }>;
  suggestedActions: SuggestedAction[];
  meetingPrepNotes: MeetingPrepNote[];
  tomorrowBriefing: TomorrowBriefing;
}

function getRoleContext(role: TeamRole): string {
  switch (role) {
    case 'owner':
      return `You are providing a dashboard briefing for NATHAN KING, the OWNER of Brett King Builder-Contractor (BKB), a high-end residential renovation company.
Nathan is the primary decision maker and handles: client relationships, project oversight, design direction, team coordination, and business development.
Focus on: items needing his direct attention, client communications requiring response, team coordination needs, upcoming meetings/deadlines, and business-critical decisions.
Be direct and specific — Nathan is hands-on and wants actionable items, not generic advice.`;
    case 'admin':
      return `You are providing a dashboard briefing for TERRI KING (Terri Dalavai), the OFFICE MANAGER of Brett King Builder-Contractor (BKB).
Terri handles: invoicing, billing, accounts payable/receivable, client scheduling, permit submissions, vendor coordination, and administrative communication.
Focus on: billing and invoicing priorities, client/vendor follow-ups needed, scheduling tasks, permit status, and items other team members have asked her to handle.
Be specific about which clients and projects need attention.`;
    case 'field_sup':
      return `You are providing a dashboard briefing for a LEAD CARPENTER / PROJECT MANAGER in the field.
Focus on: today's job site priorities, upcoming task deadlines, material needs, crew coordination,
client communication needs, and schedule conflicts. Keep it actionable and field-focused.`;
    case 'field':
      return `You are providing a dashboard briefing for a CARPENTER on the team.
Focus on: today's tasks and what to work on, upcoming deadlines this week,
any notes from the team about their assigned work. Keep it simple and task-focused.`;
    default:
      return 'Provide a general dashboard briefing.';
  }
}

export async function analyzeUserDashboard(data: UserDashboardData): Promise<DashboardAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return buildFallbackAnalysis(data);
  }

  const roleContext = getRoleContext(data.role);

  // Build task summary
  const taskSummary = data.tasks.slice(0, 30).map(t => {
    const duePart = t.daysUntilDue !== null
      ? (t.daysUntilDue < 0 ? `${Math.abs(t.daysUntilDue)} days OVERDUE` : t.daysUntilDue === 0 ? 'DUE TODAY' : `due in ${t.daysUntilDue} days`)
      : 'no due date';
    const assigneePart = t.assignee ? ` | Assigned: ${t.assignee}` : '';
    return `- [${t.urgency.toUpperCase()}] ${t.name} (${t.jobName} #${t.jobNumber}) — ${duePart}, ${Math.round(t.progress * 100)}% complete${assigneePart}`;
  }).join('\n');

  // Build JT messages summary — these are comments directed AT the user
  const messageSummary = data.recentMessages.slice(0, 15).map(m =>
    `- FROM: ${m.authorName} | JOB: ${m.jobName} (#${m.jobNumber}) | DATE: ${new Date(m.createdAt).toLocaleDateString()} | MESSAGE: "${m.content.slice(0, 150)}"`
  ).join('\n');

  // Build email summary
  const emailSummary = data.recentEmails.slice(0, 15).map(e =>
    `- FROM: ${e.from} | SUBJECT: ${e.subject} | DATE: ${new Date(e.date).toLocaleDateString()} | ${e.isUnread ? 'UNREAD' : 'READ'} | PREVIEW: "${e.snippet.slice(0, 100)}"`
  ).join('\n');

  // Build calendar summary (force Eastern timezone for display)
  const TZ = 'America/New_York';
  const calendarSummary = (data.calendarEvents || []).slice(0, 15).map(e => {
    const start = new Date(e.start);
    const day = start.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
    const time = e.allDay ? 'All day' : start.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    const loc = e.location ? ` | Location: ${e.location.slice(0, 60)}` : '';
    return `- ${day} ${time}: ${e.summary}${loc}${e.attendeeCount > 1 ? ` (${e.attendeeCount} attendees)` : ''}`;
  }).join('\n');

  // Build tomorrow calendar summary
  const tomorrowCalSummary = (data.tomorrowCalendarEvents || []).map(e => {
    const start = new Date(e.start);
    const time = e.allDay ? 'All day' : start.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    const loc = e.location ? ` | Location: ${e.location.slice(0, 60)}` : '';
    return `- ${time}: ${e.summary}${loc}${e.attendeeCount > 1 ? ` (${e.attendeeCount} attendees)` : ''}`;
  }).join('\n');

  // Build tomorrow tasks summary
  const tomorrowTaskSummary = (data.tomorrowTasks || []).map(t =>
    `- ${t.name} (${t.jobName} #${t.jobNumber})${t.assignee ? ` | Assigned: ${t.assignee}` : ''}`
  ).join('\n');

  // Build daily log summary
  const logSummary = data.recentDailyLogs.slice(0, 10).map(l =>
    `- ${l.authorName} on ${l.jobName} (${new Date(l.date).toLocaleDateString()}): ${l.notes.slice(0, 100)}...`
  ).join('\n');

  // Time-period-specific instructions
  const tc = data.timeContext;
  const periodInstructions = tc.period === 'morning'
    ? `BRIEFING MODE: MORNING — This is ${data.userName}'s first look at the day.
Focus on: what's happening TODAY (calendar, urgent tasks, emails needing same-day reply).
The summary should read like a morning briefing from a chief of staff.
Include a brief "${tc.tomorrowLabel} preview" note at the end of the summary.`
    : tc.period === 'midday'
    ? `BRIEFING MODE: MIDDAY CHECK-IN — ${data.userName} is checking in during the day.
Focus on: what needs attention RIGHT NOW, any new messages since morning, afternoon priorities.
Be concise — this is a quick status check, not a full briefing.`
    : `BRIEFING MODE: EVENING PREP — ${data.userName} is wrapping up and preparing for ${tc.tomorrowLabel}.
Focus heavily on ${tc.tomorrowLabel}'s schedule and what needs to be prepared tonight or first thing in the morning.
The summary should emphasize ${tc.tomorrowLabel}'s priorities and any prep Nathan should do before bed or first thing.`;

  const prompt = `${roleContext}

${periodInstructions}

Today is ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.
Current time: ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET
User: ${data.userName} (${data.role})

STATS:
- ${data.stats.totalTasks} open tasks (${data.stats.urgentTasks} urgent, ${data.stats.highPriorityTasks} high priority)
- ${data.stats.tasksToday} tasks due today, ${data.stats.tasksTomorrow} due ${tc.tomorrowLabel}
- ${data.stats.activeJobCount} active jobs
- ${data.stats.recentMessageCount} JT messages directed at ${data.userName} (last 7 days)
- ${data.stats.unreadEmailCount} unread emails in primary inbox
- ${data.stats.upcomingEventsCount} calendar events this week
- ${data.stats.tomorrowEventsCount} events ${tc.tomorrowLabel}

TASKS ASSIGNED TO ${data.userName.toUpperCase()}:
${taskSummary || '(no tasks currently assigned in JobTread)'}

JT MESSAGES DIRECTED AT ${data.userName.toUpperCase()} (from other team members/clients — these need review/response):
${messageSummary || '(no messages directed at user in last 7 days)'}

GMAIL INBOX (recent primary emails — identify which ones need a reply or action):
${emailSummary || '(no email data available)'}

TODAY'S CALENDAR:
${calendarSummary || '(no calendar data available)'}

${tc.tomorrowLabel.toUpperCase()}'S CALENDAR (${tc.tomorrowDate}):
${tomorrowCalSummary || '(no events)'}

TASKS DUE ${tc.tomorrowLabel.toUpperCase()}:
${tomorrowTaskSummary || '(none)'}

DAILY LOGS (ONLY mention if something requires action — do NOT summarize routine logs):
${logSummary || '(no recent logs)'}

Based on this data, provide a personalized dashboard briefing. Output ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "2-3 sentence briefing appropriate for ${tc.period} — be specific about names, projects, and actions",
  "urgentItems": [{"title": "...", "description": "...", "jobName": "..."}],
  "upcomingDeadlines": [{"title": "...", "dueDate": "YYYY-MM-DD", "daysUntilDue": N, "jobName": "..."}],
  "flaggedMessages": [{"preview": "first ~50 chars of the message", "jobName": "actual job name from data", "authorName": "actual author name", "reason": "why this needs attention/response"}],
  "emailsNeedingReply": [{"from": "sender", "subject": "subject line", "snippet": "preview", "reason": "why this needs a reply"}],
  "actionItems": [{"action": "specific thing to do ${tc.period === 'evening' ? tc.tomorrowLabel : 'today'}", "priority": "high|medium|low", "jobName": "..."}],
  "suggestedActions": [
    {
      "title": "short action label for button",
      "actionType": "reply-email|complete-task|reschedule-task|follow-up|prep-meeting|review-document",
      "context": {"taskName": "if task", "emailSubject": "if email", "recipient": "if email", "jobName": "relevant job", "suggestedText": "draft reply text if email/follow-up"},
      "priority": "high|medium|low"
    }
  ],
  "meetingPrepNotes": [
    {"eventSummary": "meeting name from calendar", "time": "10:00 AM", "prepNote": "1-2 sentence prep tip: what to review, bring, or discuss", "relatedJobName": "BKB job name if applicable"}
  ],
  "tomorrowBriefing": {
    "headline": "1 sentence: what ${tc.tomorrowLabel} looks like overall",
    "calendarWalkthrough": [{"time": "10:00 AM", "event": "event name", "prepNote": "what to prepare or bring"}],
    "tasksDue": [{"task": "task name", "jobName": "job name"}],
    "prepTonightOrAM": ["specific prep action 1", "specific prep action 2"]
  }
}

IMPORTANT RULES:
- flaggedMessages: ONLY JT messages from others that need a response from ${data.userName}
- emailsNeedingReply: ONLY emails that genuinely need a reply (not newsletters, automated notifications)
- Do NOT include daily log entries in flaggedMessages
- Keep each array to 5 items max. Be specific and actionable. Use actual names from the data.
- suggestedActions: 3-5 highest-impact things ${data.userName} should DO RIGHT NOW. Each must have a clear actionType:
  - "reply-email": include recipient and suggestedText written IN NATHAN'S VOICE (use contractions, regular dashes only - NEVER em dashes, first names, be direct but warm, never corporate jargon - see voice rules below)
  - "complete-task": include taskName for tasks that can be marked done
  - "reschedule-task": include taskName and suggestedDate for overdue tasks
  - "follow-up": include recipient/jobName and suggestedText IN NATHAN'S VOICE
  - "prep-meeting": include jobName for upcoming meetings needing preparation
  - "review-document": include jobName for documents needing review
- EMAIL DRAFT VOICE RULES: ${data.role === 'owner' ? 'Use contractions, regular dashes (NEVER em dashes), first names. Be direct but warm. Never use corporate jargon, hype words, or salesy urgency. Vendor emails: 1-3 sentences, appreciative. Client emails: context then specifics then next steps. Always close with "Let me know what you think" or a clear next step. Sign off as "Nathan".' : ''}
- meetingPrepNotes: for each upcoming meeting/consultation in today's calendar, provide a specific prep note (what to review, bring, or discuss). Match to BKB jobs where possible. Skip generic events like "Out of Office".
- tomorrowBriefing: walk through ${tc.tomorrowLabel}'s calendar chronologically with prep notes for each event
- prepTonightOrAM: specific things ${data.userName} should do tonight or first thing ${tc.tomorrowLabel} morning to be prepared`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('[DashboardAnalysis] Claude API error:', res.status);
      return buildFallbackAnalysis(data);
    }

    const aiData = await res.json();
    const aiText = (aiData.content?.[0]?.text || '').trim();

    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || '',
        urgentItems: parsed.urgentItems || [],
        upcomingDeadlines: parsed.upcomingDeadlines || [],
        flaggedMessages: parsed.flaggedMessages || [],
        emailsNeedingReply: parsed.emailsNeedingReply || [],
        actionItems: parsed.actionItems || [],
        suggestedActions: parsed.suggestedActions || [],
        meetingPrepNotes: parsed.meetingPrepNotes || [],
        tomorrowBriefing: parsed.tomorrowBriefing || { headline: '', calendarWalkthrough: [], tasksDue: [], prepTonightOrAM: [] },
      };
    }
  } catch (err: any) {
    console.error('[DashboardAnalysis] AI analysis failed:', err.message);
  }

  return buildFallbackAnalysis(data);
}

/** Fallback analysis when AI is unavailable — uses rule-based logic */
function buildFallbackAnalysis(data: UserDashboardData): DashboardAnalysis {
  const urgentItems = data.tasks
    .filter(t => t.urgency === 'urgent')
    .slice(0, 5)
    .map(t => ({
      title: t.name,
      description: t.daysUntilDue !== null && t.daysUntilDue < 0
        ? `${Math.abs(t.daysUntilDue)} days overdue`
        : 'Due today or tomorrow',
      jobName: t.jobName,
    }));

  const upcomingDeadlines = data.tasks
    .filter(t => t.daysUntilDue !== null && t.daysUntilDue >= 0 && t.daysUntilDue <= 7)
    .slice(0, 5)
    .map(t => ({
      title: t.name,
      dueDate: t.endDate || '',
      daysUntilDue: t.daysUntilDue || 0,
      jobName: t.jobName,
    }));

  const actionItems = data.tasks
    .filter(t => t.urgency !== 'normal')
    .slice(0, 5)
    .map(t => ({
      action: `Address "${t.name}" on ${t.jobName}`,
      priority: t.urgency === 'urgent' ? 'high' as const : 'medium' as const,
      jobName: t.jobName,
    }));

  return {
    summary: `You have ${data.stats.urgentTasks} urgent tasks and ${data.stats.highPriorityTasks} high-priority items across ${data.stats.activeJobCount} active jobs.`,
    urgentItems,
    upcomingDeadlines,
    flaggedMessages: [],
    emailsNeedingReply: [],
    actionItems,
    suggestedActions: [],
    meetingPrepNotes: [],
    tomorrowBriefing: { headline: '', calendarWalkthrough: [], tasksDue: [], prepTonightOrAM: [] },
  };
}
