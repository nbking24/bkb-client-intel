// @ts-nocheck
/**
 * Marketing pipeline, Step 4: build or update one job's Marketing Project
 * Profile.
 *
 *   First run for a job: download its current profile .docx from Mike's FTP
 *   and read it into structured content (marketing_photo_doc_state.content
 *   .profile). If there is no profile yet, write a full one.
 *   Every run: add the new material (What's new line, Status, Progress Update
 *   photos, videos, renderings, plans, change orders) and rebuild the whole
 *   .docx from the stored content.
 *
 * mode "preview": build it and email it to Nathan. Nothing goes to the FTP
 *   and the stored profile does not change (except saving the first read of
 *   the existing document, which only records what is already there).
 * mode "publish": back up the current .docx to private storage, upload the
 *   new one to the job folder root, and save the new content.
 *
 * Style note: no em or en dashes in this file.
 */
import { getSupabase } from '@/app/api/lib/supabase';
import { pave } from '@/app/lib/jobtread';
import { folderNameForJob } from '@/app/api/lib/jobtread';
import { downloadFile, listNames, uploadFile } from '@/app/api/lib/ftp';
import { sendEmail } from '@/app/api/lib/email';
import { statusLabel } from '@/app/api/lib/marketing/ftp-plan';
import { parseProfileDocx, BUCKET } from './parse-profile';
import { gatherSources } from './sources';
import { buildNewProfile, writeUpdate, isPhoto, isVideo, isRendering, isPlan } from './write';
import { renderProfile, longDate } from './render-docx';

const NATHAN = 'nathan@brettkingbuilder.com';
const JT_ID_RE = /^22P[A-Za-z0-9]{9}$/;

export function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function allJtIds(v: any, out = new Set<string>()) {
  if (typeof v === 'string' && JT_ID_RE.test(v)) out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => allJtIds(x, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) if (k !== 'profile') allJtIds(v[k], out);
  return out;
}

/** Image loader for the renderer: profile images from storage, JobTread photos as resized JPEGs. */
function imageLoader() {
  const supabase = getSupabase();
  return async (ref) => {
    if (ref?.source === 'storage') {
      const { data, error } = await supabase.storage.from(BUCKET).download(ref.path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    }
    if (ref?.source === 'jobtread') {
      // A resized JPEG keeps the .docx a sensible size; HEIC comes back as JPEG.
      const res: any = await pave({ file: { $: { id: ref.fileId }, url: { $: { size: 1600 } } } });
      const url = res?.file?.url;
      if (!url) return null;
      const r = await fetch(url, { cache: 'no-store' });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    }
    return null;
  };
}

/**
 * Logged entry point: one marketing_photo_runs row per profile run (trigger
 * profile-preview or profile-publish) with each step's timing, so a failed
 * or slow run can be read back afterwards.
 */
export async function runProfile(opts: { jobId: string; mode: 'preview' | 'publish'; emailPreview?: boolean }) {
  const supabase = getSupabase();
  const started = Date.now();
  const steps: { step: string; ms: number }[] = [];
  const { data: row } = await supabase
    .from('marketing_photo_runs')
    .insert({ job_id: opts.jobId, trigger: 'profile-' + opts.mode, status: 'processing', email_status: 'skipped' })
    .select('id')
    .single();
  const runId = row?.id;
  const step = async (name: string) => {
    steps.push({ step: name, ms: Date.now() - started });
    if (runId) await supabase.from('marketing_photo_runs').update({ change_summary: JSON.stringify({ steps }) }).eq('id', runId);
  };
  try {
    const result = await runProfileCore(opts, step);
    await step('finished');
    if (runId) {
      await supabase
        .from('marketing_photo_runs')
        .update({
          status: 'complete',
          profile_updated: opts.mode === 'publish' && (result as any).published === true,
          email_status: opts.mode === 'preview' ? ((result as any).emailed ? 'sent' : 'skipped') : 'skipped',
          change_summary: JSON.stringify({ steps, result: { ...result, downloadUrl: undefined } }),
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }
    return result;
  } catch (err: any) {
    if (runId) {
      await supabase
        .from('marketing_photo_runs')
        .update({ status: 'error', error: String(err?.stack || err?.message || err).slice(0, 4000), change_summary: JSON.stringify({ steps }), completed_at: new Date().toISOString() })
        .eq('id', runId);
    }
    throw err;
  }
}

/**
 * Keep a copy of the original profile's Word XML (text, styles, header,
 * footer, page setup) so the rebuilt layout can be checked against it.
 * Stored once per job in agent_cache under marketing-profile-source:<jobId>.
 */
async function snapshotSource(jobId: string, fileName: string, buf: Buffer) {
  const supabase = getSupabase();
  const key = 'marketing-profile-source:' + jobId;
  const { data: have } = await supabase.from('agent_cache').select('key').eq('key', key).maybeSingle();
  if (have) return;
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const parts: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    if (/^word\/(document|styles|numbering|settings|header\d*|footer\d*)\.xml$/.test(name) || name === 'word/_rels/document.xml.rels') {
      parts[name] = await zip.file(name)!.async('string');
    }
  }
  await supabase.from('agent_cache').upsert(
    { key, data: { file: fileName, bytes: buf.length, saved_at: new Date().toISOString(), parts }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

async function runProfileCore(opts: { jobId: string; mode: 'preview' | 'publish'; emailPreview?: boolean }, step: (name: string) => Promise<void>) {
  const supabase = getSupabase();
  const today = todayET();

  const { data: sel } = await supabase
    .from('marketing_photo_selected_jobs')
    .select('job_id, job_name, folder_name, last_processed_at')
    .eq('job_id', opts.jobId)
    .maybeSingle();
  if (!sel) throw new Error('That job is not selected for the photo engine');
  if (!sel.folder_name) throw new Error('This job has no folder on the FTP yet. Run the copy step first.');

  const { data: docRow } = await supabase.from('marketing_photo_doc_state').select('*').eq('job_id', opts.jobId).maybeSingle();
  const content = docRow?.content || {};
  const notes: string[] = [];

  // Find the profile file in the folder root.
  const rootNames = await listNames(sel.folder_name);
  const existingName = rootNames.find((n) => /\.docx$/i.test(n) && /profile/i.test(n)) || null;

  // ---- first run: read the existing profile into stored content
  let current = content.profile || null;
  let existingBytes: Buffer | null = null;
  if (existingName && !content.profile_last_built) {
    // Until this pipeline has published, the FTP file is the original profile.
    existingBytes = await downloadFile(sel.folder_name + '/' + existingName);
    await snapshotSource(opts.jobId, existingName, existingBytes);
    await step('downloaded and snapshotted the current profile');
  }
  if (!current && existingName) {
    current = await parseProfileDocx(opts.jobId, existingBytes);
    await step('read the current profile into content');
    const shown = allJtIds(content);
    if (docRow?.updated_at) {
      const { data: earlier } = await supabase
        .from('marketing_photo_assets')
        .select('jobtread_file_id, created_at')
        .eq('job_id', opts.jobId)
        .eq('excluded', false)
        .lte('created_at', docRow.updated_at);
      for (const r of earlier || []) if (r.jobtread_file_id) shown.add(r.jobtread_file_id);
    }
    const saved = {
      ...content,
      profile: current,
      profile_source: { file: existingName, read_at: new Date().toISOString() },
      shown_ids: Array.from(shown),
    };
    await supabase.from('marketing_photo_doc_state').upsert({
      job_id: opts.jobId,
      folder_name: sel.folder_name,
      content: saved,
      whats_new_log: docRow?.whats_new_log || [],
      doc_version: docRow?.doc_version || 1,
      updated_at: docRow?.updated_at || new Date().toISOString(),
    });
    Object.assign(content, saved);
    notes.push('Read the existing profile "' + existingName + '" into stored content for the first time.');
  }

  const shownIds = new Set<string>(content.shown_ids || allJtIds(content));
  const since = content.profile_last_built || docRow?.updated_at || sel.last_processed_at || null;
  const src = await gatherSources(opts.jobId, since, shownIds);
  await step('gathered JobTread sources');
  const label = statusLabel(src.job.status, src.job.closed ? 'closed' : null).label || 'In Progress';

  // Change orders the profile already covers: from this pipeline, or from the
  // old engine's lists of ids and change order numbers.
  let shownCOs: string[] = content.shown_change_orders;
  if (!shownCOs) {
    const oldRefs = new Set<string>();
    for (const k of ['change_orders', 'change_orders_shown', 'cos_shown', 'changeOrdersShown']) {
      for (const v of content[k] || []) oldRefs.add(String(v));
    }
    shownCOs = src.changeOrders
      .filter((c) => oldRefs.has(c.id) || oldRefs.has(String(c.name).split('-').pop()))
      .map((c) => c.id);
  }
  const newCOs = src.changeOrders.filter((c) => !shownCOs.includes(c.id));

  let result;
  let nothingNew = false;
  if (!current) {
    result = await buildNewProfile(src, today, label);
    notes.push('No profile on the FTP yet, so wrote a full one.');
  } else if (src.newAssets.length || newCOs.length) {
    result = await writeUpdate(current, src, newCOs, today, label);
  } else {
    nothingNew = true;
    result = { content: current, shownIds: [], shownChangeOrders: [], rulesFixed: 0, rulesScrubbed: 0 };
    notes.push('Nothing new since the last profile, so the rebuild shows the stored content as is.');
  }

  await step('wrote the new material');
  const docx = await renderProfile(result.content, imageLoader());
  await step('rendered the .docx');
  const fileName = existingName || folderNameForJob(src.job.name) + ' Marketing Profile.docx';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const summary = {
    job: src.job.name,
    folder: sel.folder_name,
    fileName,
    mode: opts.mode,
    nothingNew,
    newPhotos: src.newAssets.filter(isPhoto).length,
    newRenderings: src.newAssets.filter(isRendering).length,
    newVideos: src.newAssets.filter(isVideo).length,
    newPlans: src.newAssets.filter(isPlan).length,
    newChangeOrders: newCOs.map((c) => c.name),
    whatsNew: nothingNew ? null : result.content.whatsNew[0],
    rulesFixed: result.rulesFixed,
    rulesScrubbed: result.rulesScrubbed,
    bytes: docx.length,
    notes,
  };

  if (opts.mode === 'preview') {
    const path = opts.jobId + '/previews/' + stamp + '.docx';
    await supabase.storage.from(BUCKET).upload(path, docx, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 7 * 24 * 3600);
    const lines = [
      'Here is the rebuilt marketing profile for ' + src.job.name + ' to review. It has not been uploaded to Mike\'s FTP.',
      '',
      ...notes,
      summary.whatsNew ? "What's new line: " + summary.whatsNew.text : 'No new material this time.',
      'New photos: ' + summary.newPhotos + '. New renderings: ' + summary.newRenderings + '. New videos: ' + summary.newVideos + '. New plans: ' + summary.newPlans + '.',
      newCOs.length ? 'New change orders covered: ' + newCOs.map((c) => c.name).join(', ') + '.' : 'No new change orders.',
      result.rulesFixed ? 'Writing rule fixes applied: ' + result.rulesFixed + (result.rulesScrubbed ? ' (' + result.rulesScrubbed + ' needed a hard scrub, worth a look)' : '') + '.' : '',
    ].filter((l) => l !== null);
    if (opts.emailPreview === false) {
      return { ...summary, previewPath: path, downloadUrl: signed?.signedUrl || null, emailed: false, emailError: null };
    }
    const mail = await sendEmail({
      to: NATHAN,
      subject: 'Profile preview: ' + src.job.name + ' (' + longDate(today) + ')',
      text: lines.join('\n'),
      html: lines.map((l) => (l ? '<p style="margin:0 0 10px">' + escapeHtml(l) + '</p>' : '')).join(''),
      from: 'Nathan King <nathan@brettkingbuilder.com>',
      replyTo: NATHAN,
      attachments: [{ filename: fileName, content: docx }],
    });
    return { ...summary, previewPath: path, downloadUrl: signed?.signedUrl || null, emailed: mail.ok, emailError: mail.ok ? null : mail.error };
  }

  // ---- publish
  if (nothingNew && content.profile_last_built) {
    return { ...summary, published: false, reason: 'Nothing new, the profile on the FTP is already current.' };
  }
  if (existingName) {
    const old = existingBytes || (await downloadFile(sel.folder_name + '/' + existingName));
    const { error } = await supabase.storage.from(BUCKET).upload(opts.jobId + '/backups/' + stamp + '.docx', old, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    if (error) throw new Error('Could not back up the current profile, so it was not replaced: ' + error.message);
  }
  await uploadFile(sel.folder_name + '/' + fileName, docx);

  const newShown = Array.from(new Set([...(content.shown_ids || []), ...shownIds, ...result.shownIds]));
  const newCOsShown = Array.from(new Set([...shownCOs, ...result.shownChangeOrders]));
  const log = docRow?.whats_new_log || [];
  if (!nothingNew) log.unshift({ date: today, note: result.content.whatsNew[0]?.text || '' });
  await supabase.from('marketing_photo_doc_state').upsert({
    job_id: opts.jobId,
    folder_name: sel.folder_name,
    content: {
      ...content,
      profile: result.content,
      shown_ids: newShown,
      shown_change_orders: newCOsShown,
      profile_last_built: new Date().toISOString(),
      last_updated: today,
    },
    whats_new_log: log,
    doc_version: (docRow?.doc_version || 0) + 1,
    updated_at: new Date().toISOString(),
  });
  return { ...summary, published: true };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
