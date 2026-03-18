/**
 * Dashboard AI Analysis Engine
 *
 * Takes aggregated user data and produces a structured AI analysis
 * with urgent items, deadlines, flagged messages, and action items.
 * Uses role-specific prompts for personalized insights.
 */

import type { UserDashboardData } from './dashboard-data';
import type { TeamRole } from './constants';

export interface DashboardAnalysis {
  summary: string;
  urgentItems: Array<{ title: string; description: string; jobName?: string }>;
  upcomingDeadlines: Array<{ title: string; dueDate: string; daysUntilDue: number; jobName?: string }>;
  flaggedMessages: Array<{ preview: string; jobName: string; authorName: string; reason: string }>;
  actionItems: Array<{ action: string; priority: 'high' | 'medium' | 'low'; jobName?: string }>;
}

function getRoleContext(role: TeamRole): string {
  switch (role) {
    case 'owner':
      return `You are providing a dashboard briefing for the OWNER of a high-end residential renovation company.
Focus on: overall business health, team performance, financial overview, projects needing attention,
urgent decisions, and items that could impact client relationships. Include cross-project insights.`;
    case 'admin':
      return `You are providing a dashboard briefing for the OFFICE MANAGER of a renovation company.
Focus on: billing and invoicing priorities, overdue payments, AP/AR status, documents needing attention,
upcoming payment milestones, and administrative tasks. Financial accuracy is key.`;
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

  // Build data summary for Claude
  const taskSummary = data.tasks.slice(0, 30).map(t => {
    const duePart = t.daysUntilDue !== null
      ? (t.daysUntilDue < 0 ? `${Math.abs(t.daysUntilDue)} days OVERDUE` : t.daysUntilDue === 0 ? 'DUE TODAY' : `due in ${t.daysUntilDue} days`)
      : 'no due date';
    return `- [${t.urgency.toUpperCase()}] ${t.name} (${t.jobName} #${t.jobNumber}) — ${duePart}, ${Math.round(t.progress * 100)}% complete`;
  }).join('\n');

  const messageSummary = data.recentMessages.slice(0, 15).map(m =>
    `- [${m.type}] ${m.authorName} on ${m.jobName}: "${m.content.slice(0, 100)}..." (${new Date(m.createdAt).toLocaleDateString()})`
  ).join('\n');

  const logSummary = data.recentDailyLogs.slice(0, 10).map(l =>
    `- ${l.authorName} on ${l.jobName} (${new Date(l.date).toLocaleDateString()}): ${l.notes.slice(0, 100)}...`
  ).join('\n');

  const prompt = `${roleContext}

Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.
User: ${data.userName} (${data.role})

STATS:
- ${data.stats.totalTasks} open tasks (${data.stats.urgentTasks} urgent, ${data.stats.highPriorityTasks} high priority)
- ${data.stats.tasksToday} tasks due today
- ${data.stats.activeJobCount} active jobs
- ${data.stats.recentMessageCount} recent messages (last 7 days)

TASKS:
${taskSummary || '(no tasks)'}

RECENT MESSAGES/COMMENTS:
${messageSummary || '(no recent messages)'}

RECENT DAILY LOGS:
${logSummary || '(no recent logs)'}

Based on this data, provide a personalized dashboard briefing. Output ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "2-3 sentence overview of what needs attention today",
  "urgentItems": [{"title": "...", "description": "...", "jobName": "..."}],
  "upcomingDeadlines": [{"title": "...", "dueDate": "YYYY-MM-DD", "daysUntilDue": N, "jobName": "..."}],
  "flaggedMessages": [{"preview": "...", "jobName": "...", "authorName": "...", "reason": "why this needs attention"}],
  "actionItems": [{"action": "specific thing to do", "priority": "high|medium|low", "jobName": "..."}]
}

Keep each array to 5 items max. Be specific and actionable. Reference actual job names and task names from the data.`;

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

    // Parse JSON from response (may have markdown wrapping)
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || '',
        urgentItems: parsed.urgentItems || [],
        upcomingDeadlines: parsed.upcomingDeadlines || [],
        flaggedMessages: parsed.flaggedMessages || [],
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
    actionItems,
  };
}
