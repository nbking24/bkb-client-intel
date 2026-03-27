// @ts-nocheck
/**
 * Project Intelligence Layer (Phase 7)
 *
 * Analyzes PML data to detect:
 * - Stalled projects (no recent activity)
 * - Projects with overdue open items
 * - Communication gaps
 * - Project status summaries
 *
 * Used by the Know-It-All agent and dashboard analysis.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ProjectEvent, PMLChannel } from './project-memory';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let _client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    }
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// ── Types ──────────────────────────────────────────────────────

export interface StalledProject {
  jobId: string;
  jobName: string;
  jobNumber: string;
  daysSinceLastActivity: number;
  lastActivityDate: string;
  lastActivitySummary: string;
  lastActivityChannel: string;
  openItemCount: number;
  overdueOpenItems: number;
  stalledReason: string;
}

export interface ProjectStatusSummary {
  jobId: string;
  jobName: string;
  jobNumber: string;
  totalEvents: number;
  recentEvents: number;
  channelBreakdown: Record<string, number>;
  openItemCount: number;
  resolvedItemCount: number;
  lastActivity: string | null;
  lastActivitySummary: string | null;
  healthScore: 'healthy' | 'needs_attention' | 'stalled' | 'unknown';
  highlights: string[];
}

export interface ProjectIntelligenceReport {
  generatedAt: string;
  stalledProjects: StalledProject[];
  projectsNeedingAttention: StalledProject[];
  activeProjectSummaries: ProjectStatusSummary[];
  overallStats: {
    totalProjectsTracked: number;
    totalOpenItems: number;
    totalOverdueItems: number;
    stalledCount: number;
    healthyCount: number;
    needsAttentionCount: number;
  };
}

// ── Stalled Project Detection ──────────────────────────────────

export async function detectStalledProjects(
  activeJobIds: Array<{ id: string; name: string; number: string }>,
  stalledThresholdDays = 7
): Promise<StalledProject[]> {
  const supabase = getSupabase();
  const stalled: StalledProject[] = [];

  for (const job of activeJobIds) {
    try {
      const { data: lastEvents } = await supabase
        .from('project_events')
        .select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const { count: openCount } = await supabase
        .from('project_events')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', job.id)
        .eq('open_item', true)
        .eq('resolved', false);

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const { count: overdueCount } = await supabase
        .from('project_events')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', job.id)
        .eq('open_item', true)
        .eq('resolved', false)
        .lt('created_at', threeDaysAgo);

      const lastEvent = lastEvents?.[0] as ProjectEvent | undefined;
      if (!lastEvent) continue;

      const daysSince = Math.floor((Date.now() - new Date(lastEvent.created_at).getTime()) / (1000 * 60 * 60 * 24));

      if (daysSince >= stalledThresholdDays || (overdueCount || 0) > 0) {
        let stalledReason = '';
        if (daysSince >= stalledThresholdDays) {
          stalledReason = `No activity in ${daysSince} days`;
        }
        if ((overdueCount || 0) > 0) {
          stalledReason += stalledReason
            ? ` + ${overdueCount} overdue open items`
            : `${overdueCount} overdue open items (older than 3 days)`;
        }

        stalled.push({
          jobId: job.id,
          jobName: job.name,
          jobNumber: job.number,
          daysSinceLastActivity: daysSince,
          lastActivityDate: lastEvent.created_at,
          lastActivitySummary: lastEvent.summary,
          lastActivityChannel: lastEvent.channel,
          openItemCount: openCount || 0,
          overdueOpenItems: overdueCount || 0,
          stalledReason,
        });
      }
    } catch (err) {
      // Skip individual job errors
    }
  }

  stalled.sort((a, b) => b.daysSinceLastActivity - a.daysSinceLastActivity);
  return stalled;
}

// ── Project Status Summaries ───────────────────────────────────

export async function getProjectStatusSummary(
  jobId: string,
  jobName: string,
  jobNumber: string,
  daysBack = 30
): Promise<ProjectStatusSummary> {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: events } = await supabase
    .from('project_events')
    .select('*')
    .eq('job_id', jobId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });

  const allEvents = (events || []) as ProjectEvent[];
  const recentEvents = allEvents.filter(e => e.created_at >= recentCutoff);

  const channelBreakdown: Record<string, number> = {};
  for (const e of allEvents) {
    channelBreakdown[e.channel] = (channelBreakdown[e.channel] || 0) + 1;
  }

  const openItems = allEvents.filter(e => e.open_item && !e.resolved);
  const resolvedItems = allEvents.filter(e => e.open_item && e.resolved);
  const lastEvent = allEvents[0] || null;
  const daysSinceLastActivity = lastEvent
    ? Math.floor((Date.now() - new Date(lastEvent.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  let healthScore: 'healthy' | 'needs_attention' | 'stalled' | 'unknown' = 'unknown';
  if (allEvents.length === 0) {
    healthScore = 'unknown';
  } else if (daysSinceLastActivity >= 14) {
    healthScore = 'stalled';
  } else if (daysSinceLastActivity >= 7 || openItems.length >= 3) {
    healthScore = 'needs_attention';
  } else {
    healthScore = 'healthy';
  }

  const highlights = recentEvents
    .filter(e => e.event_type !== 'note')
    .slice(0, 5)
    .map(e => {
      const date = new Date(e.created_at).toLocaleDateString('en-US', {
        timeZone: 'America/New_York', month: 'short', day: 'numeric',
      });
      return `${date}: ${e.summary}`;
    });

  return {
    jobId, jobName, jobNumber,
    totalEvents: allEvents.length,
    recentEvents: recentEvents.length,
    channelBreakdown,
    openItemCount: openItems.length,
    resolvedItemCount: resolvedItems.length,
    lastActivity: lastEvent?.created_at || null,
    lastActivitySummary: lastEvent?.summary || null,
    healthScore,
    highlights,
  };
}

// ── Full Intelligence Report ───────────────────────────────────

export async function generateProjectIntelligenceReport(
  activeJobs: Array<{ id: string; name: string; number: string }>
): Promise<ProjectIntelligenceReport> {
  const stalledAll = await detectStalledProjects(activeJobs, 7);
  const stalledProjects = stalledAll.filter(p => p.daysSinceLastActivity >= 14);
  const projectsNeedingAttention = stalledAll.filter(
    p => p.daysSinceLastActivity < 14 && (p.overdueOpenItems > 0 || p.daysSinceLastActivity >= 7)
  );

  const summaries: ProjectStatusSummary[] = [];
  for (const job of activeJobs.slice(0, 25)) {
    try {
      const summary = await getProjectStatusSummary(job.id, job.name, job.number);
      summaries.push(summary);
    } catch (err) { /* skip */ }
  }

  const totalOpenItems = summaries.reduce((sum, s) => sum + s.openItemCount, 0);
  const totalOverdueItems = stalledAll.reduce((sum, s) => sum + s.overdueOpenItems, 0);

  return {
    generatedAt: new Date().toISOString(),
    stalledProjects,
    projectsNeedingAttention,
    activeProjectSummaries: summaries,
    overallStats: {
      totalProjectsTracked: summaries.length,
      totalOpenItems,
      totalOverdueItems,
      stalledCount: stalledProjects.length,
      healthyCount: summaries.filter(s => s.healthScore === 'healthy').length,
      needsAttentionCount: summaries.filter(s => s.healthScore === 'needs_attention').length,
    },
  };
}

// ── Formatting Helpers ─────────────────────────────────────────

export function formatStalledProjectsForContext(stalled: StalledProject[]): string {
  if (stalled.length === 0) return 'No stalled projects detected.';
  return stalled.map(p => {
    const date = new Date(p.lastActivityDate).toLocaleDateString('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric',
    });
    const parts = [
      `${p.jobName} (#${p.jobNumber})`,
      `  Last activity: ${date} (${p.daysSinceLastActivity} days ago) via ${p.lastActivityChannel}`,
      `  Last: ${p.lastActivitySummary}`,
      p.openItemCount > 0 ? `  Open items: ${p.openItemCount} (${p.overdueOpenItems} overdue)` : null,
      `  Reason: ${p.stalledReason}`,
    ].filter(Boolean);
    return parts.join('\n');
  }).join('\n\n');
}

export function formatProjectSummaryForContext(summary: ProjectStatusSummary): string {
  const health = {
    healthy: 'HEALTHY', needs_attention: 'NEEDS ATTENTION',
    stalled: 'STALLED', unknown: 'NO DATA',
  }[summary.healthScore];
  const lines = [
    `${summary.jobName} (#${summary.jobNumber}) - ${health}`,
    `  Events: ${summary.totalEvents} total, ${summary.recentEvents} in last 7 days`,
    `  Channels: ${Object.entries(summary.channelBreakdown).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`,
    `  Open items: ${summary.openItemCount} | Resolved: ${summary.resolvedItemCount}`,
    summary.lastActivity
      ? `  Last: ${new Date(summary.lastActivity).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })} - ${summary.lastActivitySummary}`
      : '  No PML activity recorded yet',
  ];
  if (summary.highlights.length > 0) {
    lines.push('  Recent:');
    for (const h of summary.highlights) lines.push(`    - ${h}`);
  }
  return lines.join('\n');
}

export function formatIntelligenceReportForContext(report: ProjectIntelligenceReport): string {
  const sections: string[] = [];
  const date = new Date(report.generatedAt).toLocaleDateString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  });
  sections.push(`PROJECT INTELLIGENCE REPORT (${date})`);
  sections.push(`Tracking ${report.overallStats.totalProjectsTracked} projects | ${report.overallStats.healthyCount} healthy | ${report.overallStats.needsAttentionCount} need attention | ${report.overallStats.stalledCount} stalled`);
  sections.push(`Total open items: ${report.overallStats.totalOpenItems} (${report.overallStats.totalOverdueItems} overdue)`);

  if (report.stalledProjects.length > 0) {
    sections.push('\n--- STALLED PROJECTS (14+ days no activity) ---');
    sections.push(formatStalledProjectsForContext(report.stalledProjects));
  }
  if (report.projectsNeedingAttention.length > 0) {
    sections.push('\n--- NEEDS ATTENTION ---');
    sections.push(formatStalledProjectsForContext(report.projectsNeedingAttention));
  }

  const healthy = report.activeProjectSummaries.filter(s => s.healthScore === 'healthy');
  if (healthy.length > 0) {
    sections.push('\n--- HEALTHY PROJECTS ---');
    for (const s of healthy.slice(0, 10)) sections.push(formatProjectSummaryForContext(s));
  }

  return sections.join('\n');
}
