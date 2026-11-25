// @ts-nocheck
/**
 * Marketing pipeline, Step 5: the Friday run, and Run now.
 *
 * For every job that is included and flagged (marketing_photo_selected_jobs
 * included = true, needs_processing = true): run the copy step, then the
 * profile writer, then send ONE email to Mike written in Nathan's voice.
 * Every run first checks the monitored jobs for new items (detect.ts), so
 * files added earlier the same day are picked up.
 *
 * Modes
 *   live:  both settings.live_mode and env MARKETING_PHOTO_ENGINE_LIVE ===
 *          'true'. Files are copied to Mike's FTP, profiles are published,
 *          the job's flag is cleared and its baseline moves to the run's start,
 *          and the email goes to Mike (BCC Nathan). The next run, Friday or
 *          Run now, only picks up what is newer than that.
 *   draft: nothing on the FTP changes and nothing is recorded as sent: the
 *          copy step runs as a dry run and the profile as a preview. The email
 *          goes to Nathan only, showing exactly what Mike would get.
 *
 * Runs
 *   Friday (cron): one per Eastern date, kept in agent_cache
 *          marketing-weekly-run:<date>. Does nothing until switched on
 *          (agent_cache marketing-weekly-config { enabled: true }).
 *   Run now and drafts (manual): a new run each time the last one finished,
 *          kept in marketing-weekly-run:<date>:manual-<ms>, with the current
 *          one named in marketing-weekly-manual-current.
 *   A live Run now and the Friday run never overlap: each waits for the
 *   other to finish.
 *
 * Each call does as much as fits in the time limit and saves its place; the
 * cron calls again every 10 minutes, and the Hub button is clicked again,
 * until the run is finished.
 *
 * Style note: no em or en dashes in this file.
 */
import { getSupabase } from '@/app/api/lib/supabase';
import { sendEmail } from '@/app/api/lib/email';
import { runCopyStep } from '@/app/api/lib/marketing/copy-step';
import { runProfile, todayET } from '@/app/api/lib/marketing/profile/run';
import { longDate } from '@/app/api/lib/marketing/profile/render-docx';
import { callForJson } from '@/app/api/lib/marketing/profile/claude';
import { detectNewMarketingItems } from '@/app/api/lib/marketing/detect';

const NATHAN = 'nathan@brettkingbuilder.com';
export const CONFIG_KEY = 'marketing-weekly-config';
const MANUAL_POINTER = 'marketing-weekly-manual-current';
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

/** The three switches and checks behind live mode, for the Hub panel. */
export async function liveChecks() {
  const { data } = await getSupabase().from('marketing_photo_settings').select('live_mode, recipient').eq('id', 1).maybeSingle();
  return {
    hubLive: data?.live_mode === true,
    vercelLive: process.env.MARKETING_PHOTO_ENGINE_LIVE === 'true',
    cronSecretSet: !!process.env.CRON_SECRET,
    recipient: data?.recipient || null,
  };
}

export async function setHubLive(on: boolean) {
  await getSupabase().from('marketing_photo_settings').update({ live_mode: on, updated_at: new Date().toISOString() }).eq('id', 1);
}

export async function isLive(): Promise<boolean> {
  const { data } = await getSupabase().from('marketing_photo_settings').select('live_mode').eq('id', 1).maybeSingle();
  return data?.live_mode === true && process.env.MARKETING_PHOTO_ENGINE_LIVE === 'true';
}

/** Today's Friday (cron) run, if any. */
export async function getRun(date = todayET()) {
  return cacheGet(runKey(date));
}

/** The latest Run now or draft, finished or not. */
export async function getManualRun() {
  const p = await cacheGet(MANUAL_POINTER);
  return p?.key ? cacheGet(p.key) : null;
}

/** Most recent finished live run, Friday or Run now, for the panel. */
export async function getLastLiveRun() {
  return cacheGet('marketing-weekly-last-live');
}

const isFinished = (run) => !!run && run.emailed === true;

/** "Berntsen - Renovation" reads as "Berntsen Renovation" in the email. */
function displayName(name: string) {
  return (name || '').replace(new RegExp('\\s*[-\\u2010-\\u2015]\\s*', 'g'), ' ').replace(/\s+/g, ' ').trim();
}

function plural(n: number, one: string, many = one + 's') {
  return n + ' ' + (n === 1 ? one : many);
}

const EMPTY_COUNTS = { before: 0, progress: 0, finished: 0, renderings: 0, plans: 0, videos: 0, designVideos: 0 };

function countSent(items: any[]) {
  const c = { ...EMPTY_COUNTS };
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

function addCounts(a: any, b: any) {
  const out = { ...EMPTY_COUNTS };
  for (const k of Object.keys(out)) out[k] = (a?.[k] || 0) + (b?.[k] || 0);
  return out;
}

/** Plain bullet lines for a job, used in the draft details and the fallback email. */
function countLines(c: any) {
  const lines = [];
  if (c.finished) lines.push(plural(c.finished, 'finished photo'));
  if (c.progress) lines.push(plural(c.progress, 'progress photo'));
  if (c.before) lines.push(plural(c.before, 'before photo'));
  if (c.renderings) lines.push(plural(c.renderings, 'design rendering'));
  if (c.plans) lines.push(plural(c.plans, 'plan file'));
  if (c.videos) lines.push(plural(c.videos, 'walk-through video'));
  if (c.designVideos) lines.push(plural(c.designVideos, 'design walk-through video'));
  return lines;
}

/** A job is worth telling Mike about when files went over or its writeup changed. */
function hasNews(j) {
  return countLines(j.counts || {}).length > 0 || !!j.profileUpdated || !!j.movedToCompleted;
}

type Opts = { trigger: 'cron' | 'manual'; deadlineMs?: number; forceDraft?: boolean };

/** Reject with { timedOut: true } if p has not settled within ms. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer;
  const t = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { timedOut: true })), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** Find the run this call works on, starting a new one when needed. */
async function openRun(opts: Opts, date: string) {
  if (opts.trigger === 'cron') {
    const key = runKey(date);
    const run = await cacheGet(key);
    if (run) return { key, run };
    // Never start Friday's run on top of an unfinished live Run now.
    const manual = await getManualRun();
    if (manual && manual.mode === 'live' && !isFinished(manual)) {
      return { key, run: null, waiting: 'A Run now is still in progress; the Friday run will start once it finishes.' };
    }
    return { key, run: null, mode: (await isLive()) ? 'live' : 'draft' };
  }

  const mode = opts.forceDraft ? 'draft' : 'live';
  const pointer = await cacheGet(MANUAL_POINTER);
  const current = pointer?.key ? await cacheGet(pointer.key) : null;
  if (current && !isFinished(current)) {
    if (current.mode !== mode) {
      throw new Error('A ' + (current.mode === 'live' ? 'Run now' : 'draft') + ' is still in progress. Click its button until it finishes first.');
    }
    return { key: pointer.key, run: current };
  }
  if (mode === 'live') {
    if (!(await isLive())) throw new Error('Live mode is not fully on, so Run now cannot send anything. Check the live switches above.');
    const friday = await getRun(date);
    if (friday && friday.mode === 'live' && !isFinished(friday)) {
      throw new Error("Friday's run is in progress right now. Try again once it finishes.");
    }
  }
  const key = runKey(date) + ':manual-' + Date.now();
  await cacheSet(MANUAL_POINTER, { key, mode, startedAt: new Date().toISOString() });
  return { key, run: null, mode };
}

/**
 * Do as much of the current run as fits before deadlineMs. Safe to call again
 * and again: finished steps are never repeated.
 */
export async function runWeeklyTick(opts: Opts) {
  const started = Date.now();
  const deadline = opts.deadlineMs || 240000;
  const timeLeft = () => deadline - (Date.now() - started);
  const supabase = getSupabase();
  const date = todayET();

  const opened = await openRun(opts, date);
  if (opened.waiting) {
    return { date, mode: null, finished: false, emailed: false, jobs: [], waiting: opened.waiting, email: null };
  }
  const key = opened.key;
  let run = opened.run;

  if (!run) {
    // The baseline each job moves to; taken before the check so nothing
    // added while the run works can slip under it.
    const startedAt = new Date().toISOString();
    // Pick up anything added since the last check, including earlier today.
    let detectError = null;
    try {
      await detectNewMarketingItems();
    } catch (err: any) {
      detectError = String(err?.message || err).slice(0, 300);
    }
    const { data: flagged } = await supabase
      .from('marketing_photo_selected_jobs')
      .select('job_id, job_name')
      .eq('included', true)
      .eq('needs_processing', true);
    run = {
      key,
      date,
      mode: opened.mode,
      trigger: opts.trigger === 'cron' ? 'friday' : 'run-now',
      startedAt,
      detectError,
      jobs: (flagged || [])
        .sort((a, b) => (a.job_name || '').localeCompare(b.job_name || ''))
        .map((f) => ({ jobId: f.job_id, name: f.job_name, copy: 'pending', profile: 'pending' })),
      emailed: false,
    };
    await cacheSet(key, run);
  }
  const draft = run.mode !== 'live';

  for (const j of run.jobs) {
    if (j.copy === 'done' && j.profile === 'done') continue;
    // A job's copy step only starts with most of a call ahead of it; the
    // next call (Hub click or the cron 10 minutes later) carries on.
    if (j.copy !== 'done' && timeLeft() < 150000) break;
    if (timeLeft() < 60000) break;

    try {
      // 1. Copy step. Capped so a stalled download or listing can never run
      // the call into Vercel's hard limit, where nothing would be saved.
      if (j.copy !== 'done') {
        const cap = Math.max(30000, timeLeft() - 15000);
        let r;
        try {
          r = await withTimeout(
            runCopyStep({ jobId: j.jobId, dryRun: draft, deadlineMs: Math.max(30000, timeLeft() - 60000) }),
            cap
          );
        } catch (err: any) {
          if (!err?.timedOut) throw err;
          j.timeouts = (j.timeouts || 0) + 1;
          if (j.timeouts >= 2) {
            j.error = 'Copying this job took too long twice in a row, so it was left for the next run.';
            j.copy = 'done';
            j.profile = 'done';
          }
          await cacheSet(key, run);
          break; // a fresh call retries it with the full time
        }
        if (r.skipped) {
          j.copy = 'done';
          j.profile = 'done';
          j.skipped = r.skipped;
          await cacheSet(key, run);
          continue;
        }
        // A live copy can take several calls; each call reports only what it
        // sent, so the counts and the file list add up across calls.
        const sentItems = draft ? r.send : r.sent;
        j.counts = draft ? countSent(sentItems) : addCounts(j.counts, countSent(sentItems));
        const items = (sentItems || []).map((s) => ({ kind: s.kind, name: s.ftpName || s.name, to: s.to || null }));
        j.items = (draft ? items : (j.items || []).concat(items)).slice(0, 80);
        j.waiting = (r.wait || []).length;
        j.excluded = (draft ? 0 : j.excluded || 0) + (r.exclude || []).length;
        j.failed = (draft ? [] : j.failed || []).concat((r.failed || []).map((f) => f.name + ': ' + f.error));
        j.earliestWaiting = r.earliestWaiting || null;
        j.folder = r.folderName || r.folder?.target || r.folder?.current;
        j.newFolder = !!j.newFolder || !!r.folder?.isNew;
        j.movedToCompleted = !!j.movedToCompleted || (!!r.folder && r.folder.current !== r.folder.target && /\(Completed\)$/.test(r.folder.target || ''));
        if (!r.done) {
          // Out of time partway through the uploads; this call ends here.
          await cacheSet(key, run);
          break;
        }
        j.copy = 'done';
        await cacheSet(key, run);
        if (timeLeft() < 60000) break;
      }

      // 2. Profile: adds to the job's existing writeup on the FTP.
      if (j.profile !== 'done') {
        let p;
        try {
          p = await withTimeout(
            runProfile({ jobId: j.jobId, mode: draft ? 'preview' : 'publish', emailPreview: false }),
            Math.max(30000, timeLeft() - 15000)
          );
        } catch (err: any) {
          if (!err?.timedOut) throw err;
          j.profileTimeouts = (j.profileTimeouts || 0) + 1;
          if (j.profileTimeouts >= 2) {
            j.error = 'Updating the writeup took too long twice in a row, so it was left for the next run.';
            j.profile = 'done';
          }
          await cacheSet(key, run);
          break;
        }
        j.profileUpdated = draft ? !p.nothingNew : p.published === true;
        j.profileWhatsNew = p.whatsNew?.text || null;
        j.profilePreviewUrl = p.downloadUrl || null;
        j.profile = 'done';
      }

      // 3. Live only: clear the flag and move the baseline to this run's
      // start. Photos still waiting for labels keep the baseline at their
      // date so they are picked up once labeled.
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
          trigger: run.trigger === 'friday' ? 'scheduled' : 'run-now',
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
    await cacheSet(key, run);
  }

  const finished = run.jobs.every((j) => j.copy === 'done' && j.profile === 'done');
  if (finished && !run.emailed) {
    run.email = await sendWeeklyEmail(run);
    run.emailed = true;
    run.finishedAt = new Date().toISOString();
    await cacheSet(key, run);
    if (!draft) {
      await cacheSet('marketing-weekly-last-live', {
        key,
        trigger: run.trigger,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        jobs: run.jobs.filter(hasNews).map((j) => displayName(j.name)),
        emailSent: !!run.email?.ok && !run.email?.skipped,
      });
      if (run.email?.ok) {
        await supabase.from('marketing_photo_runs').update({ email_status: 'sent' }).in('trigger', ['scheduled', 'run-now']).eq('email_status', 'held');
      }
    }
  }
  return { date, key, mode: run.mode, trigger: run.trigger, finished, emailed: run.emailed, jobs: run.jobs, email: run.email || null };
}

// ------------------------------------------------------------ Mike's email

const EMAIL_EXAMPLES = `Example 1:
Hi Mike,

I just added a fresh round of progress to the Henschel farmhouse folder on the FTP.

There are 15 new progress photos: inside, the home is framed out with its new window walls and exposed beams set against the original stone, and outside, the addition is up over its new foundation, roofed, and taking shape.

There are also 4 new walk-through videos in the Videos folder, a full interior progress walk-through, a closer look at the new window wall, and two of the exterior addition rising with the excavator working. The bathroom drawings are in the Plans and Renderings folder.

The writeup in the folder has a dated note at the top summarizing what is new.

Take a look when you get a chance and let me know what you think, or if you'd like anything organized differently.

Example 2:
Hi Mike,

Two more for you, both with finished professional photos now on the FTP.

Puglia Sunroom: I added the professional finished photos into the existing Puglia folder. They cover the four-season sunroom inside and out.

Hurley (Phase 2): there's a new folder, "Hurley-Phase 2 (Completed)," with the finished photos and a writeup. This one is a historic stone farmhouse, with exposed sandblasted stone walls, reclaimed-beam ceilings, a bright sunroom, deep covered porches, and a detached carriage house.

Both sets are the full-resolution images. Hurley's folder has the project writeup with the description, scope, and some marketing angles, and I noted the new photos in Puglia's existing writeup.

Take a look when you get a chance and let me know what you think, or if you'd like anything organized differently.`;

const EMAIL_SYSTEM = `You write a short email from Nathan King, owner of Brett King Builder (a high end residential renovation company in Bucks County, PA), to Mike, the web designer who builds the company's website project pages and social posts. Nathan has just put new project files on Mike's FTP. Mike must read this as a normal email Nathan typed himself.

Match the style of Nathan's past emails to Mike below: "Hi Mike," on its own line, then a few short plain paragraphs, then a closing line inviting Mike's thoughts. Friendly, specific, to the point. Contractions are fine. Do not copy the examples word for word; vary the wording naturally from week to week.

${EMAIL_EXAMPLES}

Rules:
- State the counts exactly as given in the facts. Never invent a count, a photo subject, a room, a material or a file.
- Describe what the photos or videos show only from the "what's new" note and file names in the facts. If there is little to go on, just give the counts and where they are. Do not pad.
- Use folder names as given: Photos, Videos, and Plans and Renderings. When a job has a new folder, give its exact folder name in quotes.
- When a job's writeup was updated, say so briefly (for example, that the writeup has a dated note at the top with what is new). When a job moved to its Completed folder, mention it once.
- One job: one or two short paragraphs about it. Several jobs: open with a line like "A few updates for you on the FTP." then one short paragraph per job, starting with the job's name and a colon.
- Never mention automation, software, a schedule, a system, a hub, a report, or that the email was generated. Never say "this week's batch".
- Never use an em dash or an en dash. Use commas, periods or the word "and".
- Never mention prices, costs, budgets or money. Never use a client's first name; job names are last names.
- No markdown, no bullets, no bold, no headings, no exclamation points.
- End with a closing line like the examples, then a blank line, then "Nathan".
- Subject: short and plain, like "New progress photos for Henschel" or "Updates for Edwards and Marrero". No date, no dashes.`;

const emailSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Short plain subject line, no dashes' },
    body: { type: 'string', description: 'The full plain text email body, paragraphs separated by blank lines, ending with Nathan' },
  },
  required: ['subject', 'body'],
};

function jobFacts(j) {
  const c = j.counts || {};
  const where = [];
  const photos = (c.finished || 0) + (c.progress || 0) + (c.before || 0);
  if (photos) where.push('Photos folder: ' + countLines({ finished: c.finished, progress: c.progress, before: c.before }).join(', '));
  if (c.videos || c.designVideos) where.push('Videos folder: ' + countLines({ videos: c.videos, designVideos: c.designVideos }).join(', '));
  if (c.plans || c.renderings) where.push('Plans and Renderings folder: ' + countLines({ plans: c.plans, renderings: c.renderings }).join(', '));
  const names = (j.items || [])
    .filter((i) => i.kind === 'video' || i.kind === 'design-video' || i.kind === 'plan' || i.kind === 'rendering')
    .slice(0, 12)
    .map((i) => i.name);
  return [
    'Job: ' + displayName(j.name),
    'FTP folder: "' + (j.folder || '') + '"' + (j.newFolder ? ' (a NEW folder created for this job)' : ' (an existing folder Mike already has)'),
    where.length ? 'New files: ' + where.join('; ') : 'New files: none',
    names.length ? 'Video, plan and rendering file names: ' + names.join('; ') : null,
    j.profileUpdated ? 'Writeup in the folder: updated, with a dated note at the top' : 'Writeup in the folder: not changed',
    j.profileWhatsNew ? "What's new note from the writeup: " + j.profileWhatsNew : null,
    j.movedToCompleted ? 'The job is now complete and its folder was renamed to (Completed)' : null,
  ].filter(Boolean).join('\n');
}

const DASH_RE = new RegExp('\\s*[\\u2012-\\u2015]\\s*', 'g');

function cleanEmailText(s: string) {
  return String(s || '')
    .replace(DASH_RE, ', ')
    .replace(/\*\*?/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain prose fallback if the writer fails, still in Nathan's register. */
function fallbackEmail(jobs) {
  const paras = jobs.map((j) => {
    const lines = countLines(j.counts || {});
    const parts = [];
    if (lines.length) parts.push(lines.join(', ').replace(/, ([^,]*)$/, lines.length > 1 ? ' and $1' : ', $1') + ' are in the "' + j.folder + '" folder');
    if (j.profileUpdated) parts.push('the writeup has a dated note at the top with what is new');
    if (j.movedToCompleted) parts.push('the job is now complete, so the folder moved to Completed');
    return displayName(j.name) + ': ' + (parts.join(', and ') || 'a small update in the folder') + '.';
  });
  const intro = jobs.length > 1 ? 'A few updates for you on the FTP.' : 'I just added an update to the FTP.';
  return {
    subject: jobs.length === 1 ? 'Updates for ' + displayName(jobs[0].name) : 'A few project updates on the FTP',
    body: ['Hi Mike,', intro, ...paras, "Take a look when you get a chance and let me know what you think, or if you'd like anything organized differently.", 'Nathan'].join('\n\n'),
  };
}

async function composeMikeEmail(jobs) {
  try {
    const out = await callForJson<{ subject: string; body: string }>({
      system: EMAIL_SYSTEM,
      user: 'Facts for this email, one block per job:\n\n' + jobs.map(jobFacts).join('\n\n') + '\n\nWrite the email.',
      toolName: 'write_email',
      toolDescription: 'Return the subject and plain text body of the email to Mike',
      schema: emailSchema,
      maxTokens: 2000,
    });
    const body = cleanEmailText(out.body);
    const subject = cleanEmailText(out.subject).replace(/,\s*$/, '').slice(0, 120);
    if (!/^Hi Mike/i.test(body) || body.length < 40 || /\$\s?\d/.test(body)) throw new Error('email did not pass checks');
    return { subject: subject || fallbackEmail(jobs).subject, body, written: 'claude' };
  } catch (err: any) {
    return { ...fallbackEmail(jobs), written: 'fallback', writerError: String(err?.message || err).slice(0, 200) };
  }
}

function toHtml(text: string) {
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">' +
    text.split(/\n{2,}/).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('') +
    '</div>';
}

async function sendWeeklyEmail(run) {
  const draft = run.mode !== 'live';
  const { data: settings } = await getSupabase()
    .from('marketing_photo_settings')
    .select('recipient, preview_recipient')
    .eq('id', 1)
    .maybeSingle();

  const newsJobs = run.jobs.filter((j) => !j.error && !j.skipped && hasNews(j));
  const problems = run.jobs.filter((j) => j.error || j.skipped || (j.failed && j.failed.length));

  if (!newsJobs.length && !draft && !problems.length) return { ok: true, skipped: 'nothing new for Mike' };

  const email = newsJobs.length ? await composeMikeEmail(newsJobs) : null;

  if (!draft) {
    const sent = email
      ? await sendEmail({
          to: settings?.recipient || 'mike@lighthoused.com',
          bcc: NATHAN,
          subject: email.subject,
          text: email.body,
          html: toHtml(email.body),
          from: 'Nathan King <nathan@brettkingbuilder.com>',
          replyTo: NATHAN,
        })
      : { ok: true, skipped: 'nothing new for Mike' };
    if (problems.length) await sendProblemNote(run, problems);
    return { ...sent, subject: email?.subject || null, written: email?.written || null };
  }

  // Draft: Nathan sees exactly what Mike would get, plus the details.
  const notes = run.jobs.map((j) => {
    const parts = [
      displayName(j.name) + ':',
      j.skipped ? 'skipped (' + j.skipped + ')' : null,
      j.error ? 'ERROR ' + j.error : null,
      countLines(j.counts || {}).join(', ') || null,
      j.waiting ? plural(j.waiting, 'photo') + ' waiting for labels' : null,
      j.excluded ? plural(j.excluded, 'file') + ' left out for good' : null,
      j.failed?.length ? 'failed: ' + j.failed.join('; ') : null,
      j.profileWhatsNew ? "profile What's new: " + j.profileWhatsNew : null,
    ].filter(Boolean);
    if (parts.length === 1) parts.push('nothing new');
    return { text: parts.join(' '), url: j.profilePreviewUrl };
  });
  const mikePart = email
    ? '<p><strong>Subject:</strong> ' + esc(email.subject) + '</p>' + toHtml(email.body)
    : '<p>Nothing new for Mike, so no email would go to him.</p>';
  const draftHtml =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">' +
    '<p style="background:#fff4d6;padding:8px 10px;border-radius:6px"><strong>Draft.</strong> This is what Mike would get. Nothing was copied to the FTP, no profile was published, nothing was recorded as sent, and this went only to you.' +
    (email?.written === 'fallback' ? ' (The writer failed, so this uses the plain backup wording.)' : '') + '</p>' +
    '<hr style="border:none;border-top:1px solid #ddd">' + mikePart + '<hr style="border:none;border-top:1px solid #ddd">' +
    '<p><strong>Details per job</strong></p><ul>' +
    notes.map((n) => '<li>' + esc(n.text) + (n.url ? ' <a href="' + n.url + '">Profile preview (.docx)</a>' : '') + '</li>').join('') +
    '</ul></div>';
  const textMike = email ? 'Subject: ' + email.subject + '\n\n' + email.body : 'Nothing new for Mike.';
  return sendEmail({
    to: settings?.preview_recipient || NATHAN,
    subject: '[Draft] ' + (email?.subject || 'Marketing update, nothing new') + ' (' + longDate(run.date) + ')',
    text: 'DRAFT: nothing was copied or published, sent only to you.\n\n' + textMike + '\n\nDetails:\n' + notes.map((n) => '- ' + n.text + (n.url ? ' ' + n.url : '')).join('\n'),
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
    subject: 'Marketing run: ' + (problems.length === 1 ? '1 job needs' : problems.length + ' jobs need') + ' a look (' + longDate(run.date) + ')',
    text: lines.join('\n'),
    html: '<ul>' + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>',
    from: 'Nathan King <nathan@brettkingbuilder.com>',
  });
}

function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
