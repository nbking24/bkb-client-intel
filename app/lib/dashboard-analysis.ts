/**
 * Dashboard AI Analysis Engine
 *
 * Takes aggregated user data and produces a structured AI analysis
 * with urgent items, deadlines, flagged messages, emails needing replies, and action items.
 * Uses role-specific prompts for personalized insights.
 */

import type { UserDashboardData } from './dashboard-data';
import type { TeamRole } from './constants';

export interface DashboardAnalysis {
  summary: string;
  urgentItems: Array<{ title: string; description: string; jobName?: string }>;
  upcomingDeadlines: Array<{ title: string; dueDate: string; daysUntilDue: number; jobName?: string }>;
  flaggedMessages: Array<{ preview: string; jobName: string; authorName: string; reason: string }>;
  emailsNeedingReply: Array<{ from: string; subject: string; snippet: string; reason: string }>;
  actionItems: Array<{ action: string; priority: 'high' | 'medium' | 'low'; jobName?: string }>;
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

  // Build calendar summary
  const calendarSummary = (data.calendarEvents || []).slice(0, 15).map(e => {
    const start = new Date(e.start);
    const day = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = e.allDay ? 'All day' : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const loc = e.location ? ` | Location: ${e.location.slice(0, 60)}` : '';
    return `- ${day} ${time}: ${e.summary}${loc}${e.attendeeCount > 1 ? ` (${e.attendeeCount} attendees)` : ''}`;
  }).join('\n');

  // Build daily log summary
  const logSummary = data.recentDailyLogs.slice(0, 10).map(l =>
    `- ${l.authorName} on ${l.jobName} (${new Date(l.date).toLocaleDateString()}): ${l.notes.slice(0, 100)}...`
  ).join('\n');

  const prompt = `${roleContext}

Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.
User: ${data.userName} (${data.role})

STATS:
- ${data.stats.totalTasks} open tasks assigned to ${data.userName} (${data.stats.urgentTasks} urgent, ${data.stats.highPriorityTasks} high priority)
- ${data.stats.tasksToday} tasks due today
- ${data.stats.activeJobCount} active jobs
- ${data.stats.recentMessageCount} JT messages directed at ${data.userName} (last 7 days)
- ${data.stats.unreadEmailCount} unread emails in primary inbox
- ${data.stats.upcomingEventsCount} calendar events this week

TASKS ASSIGNED TO ${data.userName.toUpperCase()}:
${taskSummary || '(no tasks currently assigned in JobTread)'}

JT MESSAGES DIRECTED AT ${data.userName.toUpperCase()} (from other team members/clients — these need review/response):
${messageSummary || '(no messages directed at user in last 7 days)'}

GMAIL INBOX (recent primary emails — identify which ones need a reply or action):
${emailSummary || '(no email data available)'}

CALENDAR (upcoming meetings and events — mention prep needed, conflicts, or follow-ups):
${calendarSummary || '(no calendar data available)'}

DAILY LOGS (ONLY mention if something requires action — do NOT summarize routine logs):
${logSummary || '(no recent logs)'}

Based on this data, provide a personalized dashboard briefing. Output ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "2-3 sentence overview of what needs attention today — be specific about names, projects, and actions",
  "urgentItems": [{"title": "...", "description": "...", "jobName": "..."}],
  "upcomingDeadlines": [{"title": "...", "dueDate": "YYYY-MM-DD", "daysUntilDue": N, "jobName": "..."}],
  "flaggedMessages": [{"preview": "first ~50 chars of the message", "jobName": "actual job name from data", "authorName": "actual author name", "reason": "why this needs attention/response"}],
  "emailsNeedingReply": [{"from": "sender", "subject": "subject line", "snippet": "preview", "reason": "why this needs a reply"}],
  "actionItems": [{"action": "specific thing to do today", "priority": "high|medium|low", "jobName": "..."}]
}

IMPORTANT RULES:
- flaggedMessages should ONLY contain JT messages from others that need a response or action from ${data.userName}
- emailsNeedingReply should ONLY contain emails that genuinely need a reply (not newsletters, automated notifications, etc.)
- Do NOT include daily log entries in flaggedMessages — only include them in urgentItems or actionItems if they reveal a problem
- Keep each array to 5 items max. Be specific and actionable. Use actual job names and people names from the data.
- If there are no tasks assigned, still provide insights from messages, emails, and job data.`;

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
        max_tokens: 2048,
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
  };
}
