// @ts-nocheck
// ============================================================
// Daily Briefing — Cron
//
// Runs 3 AM Central, Mon-Fri (08:00 UTC). Generates Nathan's pre-computed
// briefing, stores it in `daily_briefings`, and emails him a copy.
//
// Manual run: GET /api/cron/daily-briefing?seed=true  (no CRON_SECRET needed)
// Protected by CRON_SECRET otherwise.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { generateBriefing, storeBriefing } from '@/app/lib/daily-briefing';
import { sendEmail, escapeHtml } from '@/app/api/lib/email';

export const runtime = 'nodejs';
export const maxDuration = 300;

const NATHAN_EMAIL = 'nathan@brettkingbuilder.com';
const HUB_URL = 'https://bkb-client-intel.vercel.app/dashboard';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const isSeed = url.searchParams.get('seed') === 'true';
  const noEmail = url.searchParams.get('noEmail') === 'true';

  if (!isSeed) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const payload = await generateBriefing();
    const date = await storeBriefing(payload);

    let emailResult: any = { skipped: true };
    if (!noEmail) {
      const html = briefingEmailHtml(payload);
      emailResult = await sendEmail({
        to: NATHAN_EMAIL,
        subject: `Daily Briefing for ${payload.weekdayLabel}`,
        html,
      });
    }

    return NextResponse.json({
      success: true,
      briefingDate: date,
      cadence: payload.cadence,
      priorities: payload.priorities,
      generateMs: payload.generateMs,
      email: emailResult,
    });
  } catch (err: any) {
    console.error('[daily-briefing cron] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message || 'failed' }, { status: 500 });
  }
}

// ---- email rendering (no em dashes) ----------------------------------------
function section(title: string, inner: string): string {
  if (!inner) return '';
  return `<div style="margin:22px 0 0;">
    <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#68050a;font-weight:700;border-bottom:2px solid #e8c860;padding-bottom:4px;margin-bottom:10px;">${escapeHtml(title)}</div>
    ${inner}
  </div>`;
}
function li(text: string): string {
  return `<div style="padding:6px 0;border-bottom:1px solid #f0ece6;font-size:14px;color:#1a1a1a;">${text}</div>`;
}

function briefingEmailHtml(p: any): string {
  const priorities = (p.priorities || []).map((x: string) => li(`&bull; ${escapeHtml(x)}`)).join('');

  const cal = (p.calendar?.events || []).length
    ? (p.calendar.events.map((e: any) => li(`${e.allDay ? 'All day' : escapeHtml(fmtTime(e.start))} &nbsp; ${escapeHtml(e.summary)}${e.location ? ` <span style="color:#8a8078;">(${escapeHtml(e.location)})</span>` : ''}`)).join(''))
    : li('<span style="color:#8a8078;">No events today.</span>');

  const email = (p.email?.items || []).length
    ? p.email.items.slice(0, 15).map((m: any) => li(`<b>${escapeHtml(shortFrom(m.from))}</b> &middot; ${escapeHtml(m.subject)} <span style="color:#8a8078;">(${m.ageDays}d)</span>`)).join('')
    : li('<span style="color:#8a8078;">Inbox clear of items needing a reply.</span>');

  const myTasks = (p.myTasks?.overdue?.length || p.myTasks?.upcoming?.length)
    ? [...(p.myTasks.overdue || []).map((t: any) => li(`<span style="color:#b00020;font-weight:600;">Overdue ${Math.abs(t.daysUntilDue)}d</span> &nbsp; ${escapeHtml(t.name)}${t.jobName ? ` <span style="color:#8a8078;">(${escapeHtml(t.jobName)})</span>` : ''}`)),
       ...(p.myTasks.upcoming || []).slice(0, 10).map((t: any) => li(`Due ${t.daysUntilDue}d &nbsp; ${escapeHtml(t.name)}${t.jobName ? ` <span style="color:#8a8078;">(${escapeHtml(t.jobName)})</span>` : ''}`))].join('')
    : li('<span style="color:#8a8078;">No tasks due in the next 7 days.</span>');

  const slipParts: string[] = [];
  for (const j of p.slip?.budgetBurn || []) slipParts.push(li(`<span style="color:${j.health === 'over-budget' ? '#b00020' : '#b8860b'};font-weight:600;">${j.health === 'over-budget' ? 'Over budget' : 'Watch'}</span> &nbsp; ${escapeHtml(j.jobName)} (margin ${fmtPct(j.marginPct)})`));
  for (const j of (p.slip?.overdueScheduleJobs || []).slice(0, 12)) slipParts.push(li(`<span style="color:#b8860b;font-weight:600;">${j.count} overdue schedule item${j.count === 1 ? '' : 's'}</span> &nbsp; ${escapeHtml(j.jobName || 'Unassigned')} (worst ${j.maxDaysOverdue}d)`));
  const slip = slipParts.length ? slipParts.join('') : li('<span style="color:#8a8078;">No projects slipping.</span>');

  // JT Messages section removed from the briefing email per Nathan
  // 2026-07-06 (also removed from the overview UI in the same commit).

  const leads = (p.leads?.counts?.newUncontacted || 0) > 0
    ? p.leads.newUncontacted.slice(0, 10).map((l: any) => li(`${escapeHtml(l.contactName || 'Lead')}${l.opportunityName ? ` <span style="color:#8a8078;">(${escapeHtml(l.opportunityName)})</span>` : ''}`)).join('')
    : li('<span style="color:#8a8078;">No new uncontacted leads.</span>');

  const team = (p.teamTasks?.overdueCount || 0) > 0
    ? li(`${p.teamTasks.overdueCount} overdue of ${p.teamTasks.totalOpen} open tasks company-wide.`) +
      (p.teamTasks.overdue || []).slice(0, 12).map((t: any) => li(`<span style="color:#b00020;">${t.daysOverdue}d</span> &nbsp; ${escapeHtml(t.name)}${t.jobName ? ` <span style="color:#8a8078;">(${escapeHtml(t.jobName)})</span>` : ''} &nbsp; <span style="color:#68050a;font-weight:600;">${escapeHtml(t.assigneeLabel || 'Unassigned')}</span>`)).join('')
    : li('<span style="color:#8a8078;">No overdue team tasks.</span>');

  // Cadence specials
  let special = '';
  if ((p.cadence === 'monday' || p.cadence === 'friday') && (p.jobCosting?.all || []).length) {
    const rows = p.jobCosting.all.slice(0, 25).map((j: any) => {
      const color = j.health === 'over-budget' ? '#b00020' : j.health === 'watch' ? '#b8860b' : '#1a7f37';
      const pct = j.manualPercentComplete ?? j.costBasedPercent;
      return li(`<span style="color:${color};font-weight:600;">${escapeHtml(fmtPct(j.marginPct))}</span> margin &nbsp; ${escapeHtml(j.jobName)} ${pct != null ? `<span style="color:#8a8078;">(${Math.round(pct)}% complete)</span>` : ''}`);
    }).join('');
    special = section(p.cadence === 'monday' ? 'Week Planner: Job Costing (all active jobs)' : 'Week in Review: Job Costing (all active jobs)', rows);
  }

  const dlRows = (p.dailyLogReport?.jobs || []).length
    ? p.dailyLogReport.jobs.map((j: any) => li(`<span style="color:${j.behind ? '#b00020' : '#1a7f37'};font-weight:600;">${j.behind ? 'Behind' : 'On track'}</span> &nbsp; ${escapeHtml(j.jobName)} <span style="color:#8a8078;">${j.lastLogDate ? `last log ${escapeHtml(j.lastLogDate)}${j.lastLogBy ? ` by ${escapeHtml(j.lastLogBy)}` : ''}${j.daysSinceLastLog != null ? `, ${j.daysSinceLastLog}d ago` : ''}` : 'no daily logs on record'} (${j.frequencyPerWeek}x/wk expected)</span>`)).join('')
    : li('<span style="color:#8a8078;">No jobs set up for daily-log monitoring.</span>');

  const body = `
    ${section('Today’s Priorities', priorities)}
    ${section('Calendar', cal)}
    ${section('Email Needing Reply', email)}
    ${section('Project Slip Alerts', slip)}
    ${section('Daily Log Monitoring', dlRows)}
    ${section('Your Tasks', myTasks)}
    ${section('New Leads', leads)}
    ${section('Outstanding Team Tasks', team)}
    ${special}
    <p style="margin:26px 0 0;"><a href="${HUB_URL}" style="display:inline-block;background:#68050a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;">Open the Hub</a></p>
  `;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f8f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f3;padding:20px 0;"><tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
        <tr><td style="background:#68050a;padding:20px 28px;">
          <div style="color:#e8c860;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">BKB Daily Briefing</div>
          <div style="color:#fff;font-size:22px;font-weight:600;margin-top:4px;">${escapeHtml(p.weekdayLabel || '')}</div>
        </td></tr>
        <tr><td style="padding:8px 28px 30px;">${body}</td></tr>
      </table>
      <div style="color:#b3aaa0;font-size:11px;margin-top:14px;">Generated ${escapeHtml(new Date(p.generatedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' }))} CT</div>
    </td></tr></table>
  </body></html>`;
}

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }); }
  catch { return ''; }
}
function fmtPct(n: any): string {
  if (n == null || isNaN(n)) return 'n/a';
  return `${Number(n).toFixed(1)}%`;
}
function shortFrom(from: string): string {
  const m = (from || '').match(/^(.*?)</);
  return (m ? m[1].trim().replace(/"/g, '') : from) || from;
}
