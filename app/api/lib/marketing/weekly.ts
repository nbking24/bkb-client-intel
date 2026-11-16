// @ts-nocheck
/**
 * Marketing pipeline, Step 5: the Friday run.
 *
 * For every job that is included and flagged (marketing_photo_selected_jobs
 * included = true, needs_processing = true): run the copy step, then the
 * profile writer, then send ONE email.
 *
 * Modes
 *   live:  both settings.live_mode and env MARKETING_PHOTO_ENGINE_LIVE ===
 *          'true'. Files are copied to Mike's FTP, profiles are published,
 *          the job's flag is cleared, and the email goes to Mike (BCC Nathan).
 *   draft: anything else. Nothing on the FTP changes: the copy step runs as a
 *          dry run and the profile as a preview (not emailed on its own).
 *          The email goes to Nathan only, showing exactly what Mike would get,
 *          with links to each profile preview.
 *
 * The scheduled run does nothing at all until it is switched on
 * (agent_cache marketing-weekly-config { enabled: true }).
 *
 * One run per Eastern date, kept in agent_cache marketing-weekly-run:<date>.
 * Each call does as much as fits in the time limit and saves its place; the
 * cron calls again every 10 minutes until the run is finished.
 *
 * Style note: no em or en dashes in this file.
 */
import { getSupabase } from '@/app/api/lib/supabase';
import { sendEmail } from '@/app/api/lib/email';
import { runCopyStep } from '@/app/api/lib/marketing/copy-step';
import { runProfile, todayET } from '@/app/api/lib/marketing/profile/run';
import { longDate } from '@/app/api/lib/marketing/profile/render-docx';

const NATHAN = 'nathan@brettkingbuilder.com';
export const CONFIG_KEY = 'marketing-weekly-config';
const runKey = (date: string) => 'marketing-weekly-run:' + date;

async function cacheGet(key: string) {
  const { data } = await getSupabase().from('agent_cache').select('data').eq('key', key).maybeSingle();
  return data?.data || null;
}
async function cacheSet(key: string, data: any) {
  await getSupabase().from('agent_cache').upsert({ key, data, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

export async function getWeeklyConfig(): Promise<{ enabled: boolean }> {
  return { enabled: false, ...((await cacheGet(CONFIG_KEY)) || {}) };
}
export async function setWeeklyEnabled(enabled: boolean, by: string | null) {
  await cacheSet(CONFIG_KEY, { enabled, changedBy: by, changedAt: new Date().toISOString() });
}

export async function isLive(): Promise<boolean> {
  const { data } = await getSupabase().from('marketing_photo_settings').select('live_mode').eq('id', 1).maybeSingle();
  return data?.live_mode === true && process.env.MARKETING_PHOTO_ENGINE_LIVE === 'true';
}

export async function getRun(date = todayET()) {
  return cacheGet(runKey(date));
}

/** "Berntsen - Renovation" reads as "Berntsen Renovation" in the email. */
function displayName(name: string) {
  return (name || '').replace(/\s*[-‐-―]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function plural(n: number, one: string, many = one + 's') {
  return n + ' ' + (n === 1 ? one : many);
}

/** The per job bullet lines, in the style of the Sept and Oct emails. */
function jobBlock(j) {
  const c = j.counts || {};
  const lines = [];
  if (c.finished) lines.push(plural(c.finished, 'finished photo'));
  if (c.progress) lines.push(plural(c.progress, 'progress photo'));
  if (c.before) lines.push(plural(c.before, 'before photo'));
  if (c.renderings) lines.push(plural(c.renderings, 'design rendering'));
  if (c.plans) lines.push(plural(c.plans, 'plan file'));
  if (c.videos) lines.push(plural(c.videos, 'walk-through video'));
  if (c.designVideos) lines.push(plural(c.designVideos, 'design walk-through video'));
  if (j.profileUpdated) lines.push('Updated project profile' + (lines.length ? '' : ' (no new photos this week)'));
  if (j.movedToCompleted) lines.push('Moved to the Completed folder');
  return { title: displayName(j.name) + (j.movedToCompleted ? ' (now complete)' : ''), lines };
}

function countSent(items: any[]) {
  const c = { before: 0, progress: 0, finished: 0, renderings: 0, plans: 0, videos: 0, designVideos: 0 };
  for (const s of items || []) {
    if (s.kind === 'before') c.before++;
    else if (s.kind === 'progress' || s.kind === 'professional') c.progress++;
    else if (s.kind === 'finished') c.finished++;
    else if (s.kind === 'rendering') c.renderings++;
    else if (s.kind === 'plan') c.plans++;
    else if (s.kind === 'video') c.videos++;
    else if (s.kind === 'design-video') c.designVideos++;
  }
  return c;
}

/**
 * Do as much of today's run as fits before deadlineMs. Safe to call again
 * and again: finished steps are never repeated.
 */
export async function runWeeklyTick(opts: { trigger: 'cron' | 'manual'; deadlineMs?: number; forceDraft?: boolean }) {
  const started = Date.now();
  const deadline = opts.deadlineMs || 240000;
  const timeLeft = () => deadline - (Date.now() - started);
  const supabase = getSupabase();
  const date = todayET();
  let run = await getRun(date);

  if (!run) {
    const live = opts.forceDraft ? false : await isLive();
    const { data: flagged } = await supabase
      .from('marketing_photo_selected_jobs')
      .select('job_id, job_name')
      .eq('included', true)
      .eq('needs_processing', true);
    run = {
      date,
      mode: live ? 'live' : 'draft',
      trigger: opts.trigger,
      startedAt: new Date().toISOString(),
      jobs: (flagged || [])
        .sort((a, b) => (a.job_name || '').localeCompare(b.job_name || ''))
        .map((f) => ({ jobId: f.job_id, name: f.job_name, copy: 'pending', profile: 'pending' })),
      emailed: false,
    };
    await cacheSet(runKey(date), run);
  }
  const draft = run.mode !== 'live';

  for (const j of run.jobs) {
    if (j.copy === 'done' && j.profile === 'done') continue;
    if (timeLeft() < 90000) break; // leave room; the next tick continues

    try {
      // 1. Copy step.
      if (j.copy !== 'done') {
        const r = await runCopyStep({ jobId: j.jobId, dryRun: draft, deadlineMs: Math.max(30000, timeLeft() - 60000) });
        if (r.skipped) {
          j.copy = 'done';
          j.profile = 'done';
          j.skipped = r.skipped;
          await cacheSet(runKey(date), run);
          continue;
        }
        const sentItems = draft ? r.send : r.sent;
        j.counts = countSent(sentItems);
        j.waiting = (r.wait || []).length;
        j.excluded = (r.exclude || []).length;
        j.failed = (r.failed || []).map((f) => f.name + ': ' + f.error);
        j.earliestWaiting = r.earliestWaiting || null;
        j.folder = r.folderName || r.folder?.target || r.folder?.current;
        j.movedToCompleted = !!r.folder && r.folder.current !== r.folder.target && /\(Completed\)$/.test(r.folder.target || '');
        if (!r.done) {
          // Out of time partway through the uploads; this tick ends here.
          await cacheSet(runKey(date), run);
          break;
        }
        j.copy = 'done';
        await cacheSet(runKey(date), run);
        if (timeLeft() < 90000) break;
      }

      // 2. Profile.
      if (j.profile !== 'done') {
        const p = await runProfile({ jobId: j.jobId, mode: draft ? 'preview' : 'publish', emailPreview: false });
        j.profileUpdated = draft ? !p.nothingNew : p.published === true;
        j.profileWhatsNew = p.whatsNew?.text || null;
        j.profilePreviewUrl = p.downloadUrl || null;
        j.profile = 'done';
      }

      // 3. Live only: clear the flag and move the baseline. Photos still
      // waiting for labels keep the baseline at their date so they are
      // picked up once labeled.
      if (!draft) {
        const floor = j.earliestWaiting && j.earliestWaiting < run.startedAt
          ? new Date(Date.parse(j.earliestWaiting) - 1000).toISOString()
          : run.startedAt;
        await supabase
          .from('marketing_photo_selected_jobs')
          .update({ needs_processing: false, scan_mode: 'delta', last_processed_at: floor, updated_at: new Date().toISOString() })
          .eq('job_id', j.jobId);
        const c = j.counts || {};
        await supabase.from('marketing_photo_runs').insert({
          job_id: j.jobId,
          job_name: j.name,
          folder_name: j.folder,
          trigger: 'scheduled',
          status: 'complete',
          photos_added: (c.before || 0) + (c.progress || 0) + (c.finished || 0),
          videos_added: (c.videos || 0) + (c.designVideos || 0),
          profile_updated: !!j.profileUpdated,
          change_summary: j.profileWhatsNew,
          email_status: 'held',
          completed_at: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      j.error = String(err?.message || err).slice(0, 500);
      j.copy = 'done';
      j.profile = 'done';
    }
    await cacheSet(runKey(date), run);
  }

  const finished = run.jobs.every((j) => j.copy === 'done' && j.profile === 'done');
  if (finished && !run.emailed) {
    run.email = await sendWeeklyEmail(run);
    run.emailed = true;
    run.finishedAt = new Date().toISOString();
    await cacheSet(runKey(date), run);
    if (!draft && run.email?.ok) {
      await supabase.from('marketing_photo_runs').update({ email_status: 'sent' }).eq('trigger', 'scheduled').eq('email_status', 'held');
    }
  }
  return { date, mode: run.mode, finished, emailed: run.emailed, jobs: run.jobs, email: run.email || null };
}

async function sendWeeklyEmail(run) {
  const draft = run.mode !== 'live';
  const { data: settings } = await getSupabase()
    .from('marketing_photo_settings')
    .select('recipient, preview_recipient')
    .eq('id', 1)
    .maybeSingle();

  const blocks = run.jobs.filter((j) => !j.error && !j.skipped).map(jobBlock).filter((b) => b.lines.length);
  const problems = run.jobs.filter((j) => j.error || j.skipped || (j.failed && j.failed.length));
  const subject = 'Marketing photos and updates - ' + longDate(run.date);

  if (!blocks.length && !draft && !problems.length) return { ok: true, skipped: 'nothing new this week' };

  const intro = blocks.length > 1 ? 'I put a few project updates in the shared folder for you.' : 'I put a project update in the shared folder for you.';
  const textBody = [
    'Hi Mike,',
    '',
    intro,
    '',
    ...blocks.flatMap((b) => [b.title, ...b.lines.map((l) => '- ' + l), '']),
    'Let me know if you need anything else.',
    '',
    'Thanks,',
    'Nathan',
  ].join('\n');
  const htmlBody =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">' +
    '<p>Hi Mike,</p><p>' + intro + '</p>' +
    blocks
      .map(
        (b) =>
          '<p style="margin-bottom:4px"><strong>' + esc(b.title) + '</strong></p><ul style="margin-top:0">' +
          b.lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>'
      )
      .join('') +
    '<p>Let me know if you need anything else.</p><p>Thanks,<br>Nathan</p></div>';

  if (!draft) {
    const sent = blocks.length
      ? await sendEmail({
          to: settings?.recipient || 'mike@lighthoused.com',
          bcc: NATHAN,
          subject,
          text: textBody,
          html: htmlBody,
          from: 'Nathan King <nathan@brettkingbuilder.com>',
          replyTo: NATHAN,
        })
      : { ok: true, skipped: 'nothing new for Mike' };
    if (problems.length) await sendProblemNote(run, problems);
    return sent;
  }

  // Draft: Nathan sees exactly what Mike would get, plus the details.
  const notes = run.jobs.map((j) => {
    const parts = [
      displayName(j.name) + ':',
      j.skipped ? 'skipped (' + j.skipped + ')' : null,
      j.error ? 'ERROR ' + j.error : null,
      j.waiting ? plural(j.waiting, 'photo') + ' waiting for labels' : null,
      j.excluded ? plural(j.excluded, 'file') + ' excluded for good' : null,
      j.failed?.length ? 'failed: ' + j.failed.join('; ') : null,
      j.profileWhatsNew ? "profile What's new: " + j.profileWhatsNew : null,
    ].filter(Boolean);
    if (parts.length === 1) parts.push('nothing new this week');
    return { text: parts.join(' '), url: j.profilePreviewUrl };
  });
  const draftHtml =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">' +
    '<p style="background:#fff4d6;padding:8px 10px;border-radius:6px"><strong>Draft.</strong> This is what Mike would get this week. Nothing was copied to the FTP, no profile was published, and this was sent only to you.</p>' +
    '<hr style="border:none;border-top:1px solid #ddd">' + htmlBody + '<hr style="border:none;border-top:1px solid #ddd">' +
    '<p><strong>Details per job</strong></p><ul>' +
    notes.map((n) => '<li>' + esc(n.text) + (n.url ? ' <a href="' + n.url + '">Profile preview (.docx)</a>' : '') + '</li>').join('') +
    '</ul></div>';
  return sendEmail({
    to: settings?.preview_recipient || NATHAN,
    subject: '[Draft] ' + subject,
    text: 'DRAFT: nothing was copied or published, sent only to you.\n\n' + textBody + '\n\nDetails:\n' + notes.map((n) => '- ' + n.text + (n.url ? ' ' + n.url : '')).join('\n'),
    html: draftHtml,
    from: 'Nathan King <nathan@brettkingbuilder.com>',
    replyTo: NATHAN,
  });
}

async function sendProblemNote(run, problems) {
  const lines = problems.map((j) =>
    displayName(j.name) + ': ' + [j.skipped && 'skipped (' + j.skipped + ')', j.error && 'error ' + j.error, j.failed?.length && 'failed ' + j.failed.join('; ')].filter(Boolean).join(', ')
  );
  return sendEmail({
    to: NATHAN,
    subject: 'Marketing Friday run: ' + (problems.length === 1 ? '1 job needs' : problems.length + ' jobs need') + ' a look (' + longDate(run.date) + ')',
    text: lines.join('\n'),
    html: '<ul>' + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>',
    from: 'Nathan King <nathan@brettkingbuilder.com>',
  });
}

function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
