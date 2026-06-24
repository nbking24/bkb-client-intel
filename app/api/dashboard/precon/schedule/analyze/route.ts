// @ts-nocheck
/**
 * POST /api/dashboard/precon/schedule/analyze
 *
 * Body: { jobs: Array<{ jobId, jobName, tasks: Array<{name, startDate, endDate, progress, status}> }> }
 *
 * Triggered by the Refresh button on the Pre-Con Schedule Calendar
 * when the operator wants an AI verdict on which in-design projects
 * need their schedules updated.
 *
 * For each submitted job, asks Haiku to:
 *   1. Decide whether the job has anything actively being worked on.
 *      A deterministic check (active task count) is done client-side
 *      first; this endpoint is for nuance — "task is marked active but
 *      hasn't been updated in 3 weeks" type judgments.
 *   2. Suggest the next concrete schedule update needed (e.g. "Add a
 *      start date to the Selections Review task" or "Move design
 *      milestone forward — original date passed 2 weeks ago").
 *
 * Returns: { analyses: [{ jobId, needsUpdate, verdict, suggestedNext }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

interface AnalyzeTask {
  name: string;
  startDate: string | null;
  endDate: string | null;
  progress: number;
  status: 'active' | 'upcoming' | 'completed' | 'undated';
}

interface AnalyzeJob {
  jobId: string;
  jobName: string;
  clientName?: string;
  tasks: AnalyzeTask[];
}

function buildPrompt(job: AnalyzeJob, todayISO: string): string {
  // Compact JSON payload - Haiku reads structured input efficiently and
  // we want the prompt small to keep latency low when scoring 10+ jobs.
  const taskLines = job.tasks
    .slice(0, 50) // cap so a job with 200 tasks doesn't blow tokens
    .map((t) => {
      const dates = [t.startDate, t.endDate].filter(Boolean).join(' to ') || 'no dates';
      const prog = Math.round((t.progress || 0) * 100);
      return `- ${t.name} | ${dates} | ${prog}% done | status=${t.status}`;
    })
    .join('\n');

  return `You are reviewing the schedule for one of Brett King Builder's in-design renovation projects to flag whether it needs a schedule update.

Today: ${todayISO}
Job: ${job.jobName}${job.clientName ? ' (client: ' + job.clientName + ')' : ''}

Tasks (max 50 shown):
${taskLines || '(no tasks)'}

A job NEEDS A SCHEDULE UPDATE if any of these are true:
- It has zero active tasks (nothing with startDate <= today <= endDate, ignoring 100% complete)
- Its most recent active task has a past end date by more than 7 days and isn't marked complete
- All upcoming tasks have no start date set (no concrete next step is scheduled)
- The job has been sitting with the same status for an unreasonable amount of time

Respond with ONLY valid JSON (no markdown, no commentary) in this shape:
{
  "needsUpdate": boolean,
  "verdict": "one short sentence (under 20 words) saying whether the schedule is on track or what's stale",
  "suggestedNext": "one concrete next action the precon coordinator should take, under 25 words. Use empty string if no action is needed."
}

Rules for verdict and suggestedNext:
- No em dashes. Use commas or periods instead.
- Never write "subcontractor" or "sub"; use "trade partner" if needed.
- Be direct. No filler like "I would recommend" or "It appears that".`;
}

interface AnalysisResult {
  jobId: string;
  needsUpdate: boolean;
  verdict: string;
  suggestedNext: string;
}

async function analyzeOne(job: AnalyzeJob): Promise<AnalysisResult> {
  const todayISO = new Date().toISOString().slice(0, 10);
  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: buildPrompt(job, todayISO) }],
    });
    const text = (res.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    // Strip any accidental fences just in case Haiku ignores instructions.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object in response');
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return {
      jobId: job.jobId,
      needsUpdate: !!parsed.needsUpdate,
      verdict: String(parsed.verdict || '').slice(0, 240),
      suggestedNext: String(parsed.suggestedNext || '').slice(0, 240),
    };
  } catch (err: any) {
    // Fall back to a deterministic note so the UI still has something
    // to render for this row. Mark needsUpdate true when the rule-based
    // check (no active task) suggests review is warranted.
    const noActive = !job.tasks.some((t) => t.status === 'active');
    return {
      jobId: job.jobId,
      needsUpdate: noActive,
      verdict: noActive ? 'No tasks currently in flight on this job.' : 'Schedule looks active.',
      suggestedNext: '',
    };
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const jobs: AnalyzeJob[] = Array.isArray(body?.jobs) ? body.jobs : [];
  if (jobs.length === 0) return NextResponse.json({ analyses: [] });
  if (jobs.length > 30) return NextResponse.json({ error: 'Too many jobs (max 30 per request)' }, { status: 400 });

  // Run all analyses in parallel - Haiku is fast and we have at most
  // ~15 in-design jobs in flight at once. ~3s wall-clock for the whole
  // batch in practice.
  const analyses = await Promise.all(jobs.map(analyzeOne));
  return NextResponse.json({ analyses, computedAt: new Date().toISOString() });
}
