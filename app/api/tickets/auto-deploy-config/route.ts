// @ts-nocheck
/**
 * /api/tickets/auto-deploy-config
 *
 * Single-source-of-truth for Cowork Claude about whether it's allowed
 * to auto-merge ticket fixes right now. Cowork hits this at the start
 * of every run, and before every push, to decide between Green lane
 * (auto-deploy) and Yellow lane (PR only).
 *
 * Response shape:
 * {
 *   enabled: boolean,                  // TICKETS_AUTO_DEPLOY env var, defaults on
 *   deploys_today: number,             // count of today's auto-deploys
 *   cap: number,                       // TICKETS_DAILY_CAP, defaults 3
 *   cap_reached: boolean,
 *   paused_reason: string|null,        // human-readable reason if !enabled
 *   green_lane_line_cap: number,       // defaults 150
 *   green_lane_file_cap: number,       // defaults 2
 *   yellow_autodeploy_line_cap: number,// defaults 75 (over -> Yellow PR)
 *   yellow_lane_line_cap: number,      // defaults 150 (over -> auto-escalate)
 *   timezone: string,                  // the tz used to bound "today"
 *   as_of: string,
 * }
 *
 * Auth: accepts the agent token header so Cowork can poll without a
 * user login. Also accepts user auth for dashboard visibility.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../lib/auth';
import { createServerClient } from '@/app/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_CAP = 3;
const DEFAULT_GREEN_LINE_CAP = 150;
const DEFAULT_GREEN_FILE_CAP = 2;
const DEFAULT_YELLOW_AUTODEPLOY_LINE_CAP = 75;
const DEFAULT_YELLOW_LINE_CAP = 150;
const TZ = 'America/Chicago';

function numEnv(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Start of "today" in America/Chicago, returned as an ISO string. */
function chicagoDayStartISO(): string {
  const now = new Date();
  // Format the current instant in Chicago to extract the calendar date there.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const y = get('year');
  const m = get('month');
  const d = get('day');
  // Chicago is UTC-5 (CDT) or UTC-6 (CST). Compute the offset for this date.
  // Strategy: get what "midnight Chicago" corresponds to in UTC by building
  // two candidate UTC times and picking the one whose tz-formatted output
  // matches our target calendar date at 00:00:00.
  const candidate = new Date(`${y}-${m}-${d}T05:00:00Z`); // assume CDT first
  // Confirm by re-rendering in Chicago
  const rendered = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(candidate);
  const rHour = rendered.find((p) => p.type === 'hour')!.value;
  const rDay = rendered.find((p) => p.type === 'day')!.value;
  if (rHour === '00' && rDay === d) return candidate.toISOString();
  // Otherwise we're in CST, shift by an hour.
  const adjusted = new Date(`${y}-${m}-${d}T06:00:00Z`);
  return adjusted.toISOString();
}

async function countDeploysToday(): Promise<number> {
  try {
    const sb = createServerClient();
    const since = chicagoDayStartISO();
    const { count, error } = await sb
      .from('ticket_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'claude_deployed_fix')
      .eq('actor', 'claude')
      .gte('created_at', since);
    if (error) {
      console.warn('[auto-deploy-config] count failed:', error.message);
      return 0;
    }
    return count || 0;
  } catch (err: any) {
    console.warn('[auto-deploy-config] count exception:', err?.message);
    return 0;
  }
}

export async function GET(req: NextRequest) {
  // Allow both agent token and signed-in users. The config is not secret
  // (knowing the cap doesn't help an attacker), but we want some gate.
  const auth = validateAgentOrUser(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawEnabled = (process.env.TICKETS_AUTO_DEPLOY || 'on').trim().toLowerCase();
  const enabled = rawEnabled !== 'off' && rawEnabled !== 'false' && rawEnabled !== '0';
  const cap = numEnv('TICKETS_DAILY_CAP', DEFAULT_CAP);
  const greenLineCap = numEnv('TICKETS_GREEN_LANE_LINE_CAP', DEFAULT_GREEN_LINE_CAP);
  const greenFileCap = numEnv('TICKETS_GREEN_LANE_FILE_CAP', DEFAULT_GREEN_FILE_CAP);
  const yellowAutodeployLineCap = numEnv(
    'TICKETS_YELLOW_AUTODEPLOY_LINE_CAP',
    DEFAULT_YELLOW_AUTODEPLOY_LINE_CAP,
  );
  const yellowLineCap = numEnv('TICKETS_YELLOW_LANE_LINE_CAP', DEFAULT_YELLOW_LINE_CAP);

  const deploysToday = await countDeploysToday();
  const capReached = deploysToday >= cap;

  let pausedReason: string | null = null;
  if (!enabled) pausedReason = 'TICKETS_AUTO_DEPLOY is off';
  else if (capReached) pausedReason = `Daily cap of ${cap} auto-deploys reached`;

  return NextResponse.json({
    enabled: enabled && !capReached,
    raw_kill_switch: enabled,
    deploys_today: deploysToday,
    cap,
    cap_reached: capReached,
    paused_reason: pausedReason,
    green_lane_line_cap: greenLineCap,
    green_lane_file_cap: greenFileCap,
    yellow_autodeploy_line_cap: yellowAutodeployLineCap,
    yellow_lane_line_cap: yellowLineCap,
    timezone: TZ,
    as_of: new Date().toISOString(),
  });
}
