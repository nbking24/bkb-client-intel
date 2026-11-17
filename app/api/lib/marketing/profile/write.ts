// @ts-nocheck
/**
 * The profile writer. Claude (claude-sonnet-4-6 on the Hub's key) writes the
 * prose; this file decides what goes where and enforces the writing rules.
 *
 *   buildNewProfile:  full profile for a job with no profile yet.
 *   writeUpdate:      for an existing profile, only the new pieces: one
 *                     What's new line, Status, a Progress Update photo
 *                     section, new videos, new renderings, new plans, and
 *                     new approved change orders.
 *
 * Rules checked on every piece of text after writing: no em or en dashes,
 * no money, no client first names. Anything flagged gets one fix pass from
 * Claude, then a hard scrub.
 *
 * Style note: no em or en dashes in this file.
 */
import { callForJson, profileSchema } from './claude';
import { longDate } from './render-docx';
import type { NewAsset } from './sources';
import { SECTION_ORDER } from './types';
import type { ProfileContent, ProfileSection } from './types';

const VOICE = `You write for Brett King Builder (BKB), a high end residential renovation company in Bucks County, PA. The reader is Mike, the web designer and marketing team, who turns these profiles into website project pages and social posts.

Voice: warm, specific and confident, like a builder proud of careful work. Plain words. Name real materials, products and spaces.

Hard rules:
- Never use an em dash or an en dash. Use commas, periods or the word "and".
- Never mention prices, costs, budgets, allowances, fees, margins or any dollar figure.
- Never use the client's first name. "The homeowners" or "the <Last name> family" is fine.
- Name a product or material only if it appears in the source material. Never invent features, rooms, products or outcomes.
- Source notes may contain internal instructions to the crew (logs required, cleanup rules, "per Nathan", "not in scope"). Treat them only as facts about the work, never quote them.
- Captions: one sentence describing what the photo shows, based on its name and description.

Change orders (How the Project Evolved, and any What's new mention):
- Tell them as the design and construction story: what changed in the house and why it matters, for example removing the foyer columns and adding a steel beam to open the space.
- Never mention credits, deducts, refunds, savings, allowances, pricing or anything about money.
- Skip routine items such as touch up or repaint coats, extra paint prep, patching, or rehanging fixtures, unless they are part of a bigger design move. Skip a change order entirely if nothing in it is a real design or construction change.
- Never list change order numbers; describe the work.`;

// ------------------------------------------------------------ rule checks

const DASH_RE = /[\u2012\u2013\u2014\u2015]/;
const MONEY_RE = /\$\s?\d|\b\d[\d,.]*\s?(dollars|k)\b|\bprice[ds]?\b|\bcost[s]?\b|\bbudget\b|\ballowances?\b|\bmargin\b|\bcredit(s|ed)?\b|\bdeduct(s|ed|ion|ions)?\b|\brefund(s|ed)?\b|\bsavings?\b/i;

function firstNameRe(names: string[]) {
  return names.length ? new RegExp('\\b(' + names.map((n) => n.replace(/[^A-Za-z'-]/g, '')).join('|') + ')\\b') : null;
}

/** Every string in a value, with a path, for checking and fixing. */
function strings(v: any, path = '', out: { path: string; text: string }[] = []) {
  if (typeof v === 'string') out.push({ path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, path + '[' + i + ']', out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) if (k !== 'image' && k !== 'date') strings(v[k], path + '.' + k, out);
  return out;
}

export function findProblems(v: any, firstNames: string[]) {
  const fn = firstNameRe(firstNames);
  const problems = [];
  for (const s of strings(v)) {
    if (DASH_RE.test(s.text)) problems.push({ path: s.path, text: s.text, issue: 'contains an em or en dash' });
    if (MONEY_RE.test(s.text)) problems.push({ path: s.path, text: s.text, issue: 'mentions money or cost' });
    if (fn && fn.test(s.text)) problems.push({ path: s.path, text: s.text, issue: "uses the client's first name" });
  }
  return problems;
}

/** Last resort: fix whatever a fix pass left behind. */
function hardScrub(v: any, firstNames: string[]): any {
  const fn = firstNameRe(firstNames);
  const fix = (t: string) => {
    let s = t.replace(/\s*[\u2012\u2013\u2014\u2015]\s*/g, ', ');
    if (fn) s = s.replace(new RegExp(fn.source, 'g'), 'the homeowners');
    if (MONEY_RE.test(s)) {
      s = s
        .split(/(?<=[.!?])\s+/)
        .filter((sent) => !MONEY_RE.test(sent))
        .join(' ');
    }
    return s;
  };
  if (typeof v === 'string') return fix(v);
  if (Array.isArray(v)) return v.map((x) => hardScrub(x, firstNames));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = k === 'image' || k === 'date' ? v[k] : hardScrub(v[k], firstNames);
    return o;
  }
  return v;
}

async function enforceRules<T>(value: T, schema: any, firstNames: string[], label: string): Promise<{ value: T; fixed: number; scrubbed: number }> {
  const problems = findProblems(value, firstNames);
  if (!problems.length) return { value, fixed: 0, scrubbed: 0 };
  const fixedValue: any = await callForJson({
    system: VOICE,
    user:
      'Fix only the flagged strings in this ' + label + ' and return the whole thing otherwise unchanged.\n\nFlagged:\n' +
      problems.map((p) => '- ' + p.path + ': ' + p.issue + ': "' + p.text + '"').join('\n') +
      '\n\nCurrent JSON:\n' + JSON.stringify(value),
    toolName: 'save',
    toolDescription: 'Save the corrected ' + label + '.',
    schema,
  });
  const left = findProblems(fixedValue, firstNames);
  return { value: left.length ? hardScrub(fixedValue, firstNames) : fixedValue, fixed: problems.length, scrubbed: left.length };
}

// ------------------------------------------------------------ helpers

function sourceText(src) {
  const j = src.job;
  return [
    'JOB: ' + j.name + ' (Job #' + j.number + ')',
    'JobTread Status: ' + (j.status || 'not set') + (j.closed ? ' (job closed)' : ''),
    'Location: ' + j.address,
    "Client first names (never use): " + (j.clientFirstNames.join(', ') || 'none'),
    '',
    'BUDGET SPECIFICATIONS (scope of work):',
    ...src.specs.map((s) => '## ' + (s.group ? s.group + ' > ' : '') + s.name + (s.description ? '\n' + s.description : '')),
    '',
    'APPROVED CHANGE ORDERS:',
    ...(src.changeOrders.length
      ? src.changeOrders.map((c) => '## ' + c.name + ' (' + c.date + ')\n' + c.items.map((i) => '- ' + i.name + (i.description ? ': ' + i.description : '')).join('\n'))
      : ['none']),
    '',
    'DAILY LOG NOTES:',
    ...(src.dailyLogs.length ? src.dailyLogs.map((l) => l.date + ': ' + l.notes) : ['none']),
  ].join('\n');
}

function assetLine(a: NewAsset, id: string) {
  return '- ' + id + ' [' + a.kind + '] name: ' + a.name + (a.description ? ' | description: ' + a.description : '') + (a.tags.length ? ' | tags: ' + a.tags.join(', ') : '');
}

const PHOTO_KINDS = ['before', 'progress', 'finished', 'professional'];
export const isPhoto = (a: NewAsset) => PHOTO_KINDS.includes(a.kind);
export const isRendering = (a: NewAsset) => a.kind === 'rendering';
export const isVideo = (a: NewAsset) => a.kind === 'video' || a.kind === 'design-video';
export const isPlan = (a: NewAsset) => a.kind === 'plan';

function statusLine(status: string | null, closed: boolean) {
  return { status, closed };
}

// ------------------------------------------------------------ new profile

const MAX_PHOTOS_PER_SECTION = 12;

export async function buildNewProfile(src, today: string, folderLabel: string) {
  const assets: NewAsset[] = src.newAssets;
  const ids: Record<string, NewAsset> = {};
  assets.forEach((a, i) => (ids['new' + (i + 1)] = a));

  const user = [
    'Write a complete Marketing Project Profile for this job, from the source material below.',
    '',
    'Structure:',
    '- title: the job name. subtitle: "Marketing Project Profile".',
    '- tagline: the project in a phrase with the place, like "A Full-Home Renovation and Addition in Bucks County · Perkasie, PA".',
    '- whatsNew: exactly one entry dated ' + today + ' saying what the profile covers. ' + WHATS_NEW_RULES,
    '- facts, in this order: Project = "' + src.job.name + ' (Job #' + src.job.number + ')", Last Updated = "' + longDate(today) + '", Location = "' + src.job.address + '" (full street address), Project Type, Status (folder status is ' + folderLabel + '; describe the current stage in a few words), Standout Feature.',
    '- sections, in this order and with these headings: Project Description (kind paragraphs, two paragraphs: what the project is and how it respects the house, then the materials and spaces that make it special), Scope of Work (kind scope, subheads such as Structure & Site, Exterior, Systems, Interior Finishes, short bullets), How the Project Evolved (kind paragraphs, the approved change orders told as the design and construction story under the change order rules, leave out if none qualify), Challenges & Solutions (kind challenges, 2 to 4 pairs), Suggested Marketing Angles (kind leadBullets, 4 to 6), Plans & Renderings (kind paragraphs, one short paragraph naming what is in that folder, leave out if nothing), Video Walk-Throughs (kind leadBullets, lead = video title, text = what it shows; design walkthroughs are design concepts; leave out if no videos).',
    '- photo sections (kind photos), each with an intro line ending "These photos are also saved in this folder.": The Home Today (before photos), Design Vision (renderings), Progress Photos (progress and finished photos). Use at most ' + MAX_PHOTOS_PER_SECTION + ' photos per section, choosing the most telling. Refer to photos by id. Leave out a section with no photos.',
    '',
    'FILES SENT TO MIKE (ids for photos):',
    ...(assets.length ? assets.map((a, i) => assetLine(a, 'new' + (i + 1))) : ['none']),
    '',
    sourceText(src),
  ].join('\n');

  const raw: any = await callForJson({ system: VOICE, user, toolName: 'save_profile', toolDescription: 'Save the profile.', schema: profileSchema, maxTokens: 16000 });
  const checked = await enforceRules(raw, profileSchema, src.job.clientFirstNames, 'profile');
  const c: any = checked.value;
  if (c.whatsNew?.[0]) c.whatsNew[0].text = await fixWhatsNew(c.whatsNew[0].text, 'A new profile for ' + src.job.name + '.');
  c.sections = (c.sections || []).map((s) =>
    s.kind === 'photos'
      ? { ...s, intro: s.intro || '', photos: (s.photos || []).filter((p) => ids[p.image]).map((p) => ({ image: { source: 'jobtread', fileId: ids[p.image].fileId }, caption: p.caption || '' })) }
      : s
  );
  return { content: c, shownIds: assets.map((a) => a.fileId), shownChangeOrders: src.changeOrders.map((c) => c.id), rulesFixed: checked.fixed, rulesScrubbed: checked.scrubbed };
}

// ------------------------------------------------------------ update

// ------------------------------------------------------------ What's new line

const WHATS_NEW_RULES =
  "The What's new line describes the work, not the paperwork. Start with a lowercase verb and say what changed in the house or what was added, " +
  'like "opened up the foyer, removing the Greek columns and carrying the load on a new steel beam." or ' +
  '"added three progress photos of the new kitchen addition, weather-wrapped and tied into the stone farmhouse." ' +
  'Never use the words "change order" or "project record", and never say something "has been added to" a record or file.';

/** Paperwork wording a What's new line must not use (Nathan, 2026-11-16). */
const PAPERWORK_RE = /\bchange[\s-]?orders?\b|\bproject records?\b|\b(added|logged|recorded) (to|in) the (project )?(record|file|profile)\b|\b(has|have) been (added|recorded|logged)\b/i;

const IRREGULAR_PAST = new Set(['set', 'built', 'began', 'hung', 'laid', 'ran', 'put', 'cut', 'brought', 'took', 'made', 'got', 'fit', 'split', 'spread', 'dug', 'wrote', 'shot', 'sent', 'spent', 'tore', 'rebuilt', 'reset']);

/** Lowercase the opening verb ("Opened up..." to "opened up..."), end with a period. */
export function shapeWhatsNew(text: string): string {
  let t = (text || '').trim().replace(/^what.?s new\s*(\([^)]*\))?\s*:\s*/i, '');
  const first = (t.match(/^([A-Za-z]+)/) || [])[1] || '';
  if (/^[A-Z][a-z]+$/.test(first) && (/ed$/.test(first) || IRREGULAR_PAST.has(first.toLowerCase()))) {
    t = first.toLowerCase() + t.slice(first.length);
  }
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}

export function whatsNewProblems(text: string): string[] {
  const out = [];
  if (PAPERWORK_RE.test(text || '')) out.push('uses paperwork wording (change order, project record, has been added)');
  const first = ((text || '').trim().match(/^([A-Za-z]+)/) || [])[1] || '';
  if (/^[A-Z]/.test(first)) out.push('does not start with a lowercase verb');
  return out;
}

/** Rewrite the line until it follows the rules (two tries), then shape it. */
async function fixWhatsNew(line: string, context: string): Promise<string> {
  let t = shapeWhatsNew(line);
  for (let attempt = 0; attempt < 2 && whatsNewProblems(t).length; attempt++) {
    const r: any = await callForJson({
      system: VOICE,
      user:
        WHATS_NEW_RULES + '\n\nThis line breaks the rules (' + whatsNewProblems(t).join('; ') + '): "' + t + '"\n\n' +
        'What is new this time:\n' + context + '\n\nWrite the corrected line.',
      toolName: 'save_line',
      toolDescription: 'Save the corrected What\'s new line.',
      schema: { type: 'object', properties: { whatsNew: { type: 'string' } }, required: ['whatsNew'] },
      maxTokens: 500,
    });
    if (r?.whatsNew) t = shapeWhatsNew(r.whatsNew);
  }
  return t;
}

const updateSchema = {
  type: 'object',
  properties: {
    whatsNew: { type: 'string', description: 'One sentence for the What\'s new line, without the "What\'s new (date):" prefix. ' + WHATS_NEW_RULES },
    status: { type: 'string', description: 'New value for the Status row, in the same style as the current one.' },
    progressIntro: { type: 'string', description: 'Intro line for the Progress Update section, ending "These photos are also saved in this folder." Empty if no new photos.' },
    captions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, caption: { type: 'string' } }, required: ['id', 'caption'] } },
    videos: { type: 'array', description: 'One entry per new video', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'title', 'text'] } },
    plansSentence: { type: 'string', description: 'A sentence to add to the Plans & Renderings section naming the new plans or renderings. Empty if none.' },
    evolvedParagraph: { type: 'string', description: 'A paragraph to add to How the Project Evolved telling the change orders you chose to describe as the design and construction story. Empty if none qualify.' },
    describedChangeOrders: { type: 'array', items: { type: 'string' }, description: 'The ids (the [id] in brackets) of exactly the change orders your evolvedParagraph describes. Empty if none.' },
  },
  required: ['whatsNew', 'status', 'progressIntro', 'captions', 'videos', 'plansSentence', 'evolvedParagraph', 'describedChangeOrders'],
};

export async function writeUpdate(current: ProfileContent, src, newChangeOrders, today: string, folderLabel: string) {
  const assets: NewAsset[] = src.newAssets;
  const ids: Record<string, NewAsset> = {};
  assets.forEach((a, i) => (ids['new' + (i + 1)] = a));
  const currentStatus = (current.facts.find((f) => /status/i.test(f.label)) || {}).value || '';

  const user = [
    'Update an existing Marketing Project Profile with this week\'s new material. Write only the new pieces.',
    '',
    'Current profile (for voice and context, do not repeat it):',
    'Tagline: ' + current.tagline,
    'Recent What\'s new lines: ' + current.whatsNew.slice(0, 4).map((w) => w.date + ': ' + w.text).join(' | '),
    'Current Status row: ' + currentStatus,
    'Description: ' + ((current.sections.find((s) => s.kind === 'paragraphs') as any)?.paragraphs || []).join(' '),
    '',
    'Today: ' + today + '. Folder status: ' + folderLabel + '. JobTread Status: ' + (src.job.status || 'not set') + '.',
    '',
    'NEW FILES SENT TO MIKE:',
    ...(assets.length ? assets.map((a, i) => assetLine(a, 'new' + (i + 1))) : ['none']),
    '',
    'NEW APPROVED CHANGE ORDERS:',
    ...(newChangeOrders.length
      ? newChangeOrders.map((c) => '## [' + c.id + '] ' + c.name + ' (' + c.date + ')\n' + c.items.map((i) => '- ' + i.name + (i.description ? ': ' + i.description : '')).join('\n'))
      : ['none']),
    '',
    'NEW DAILY LOG NOTES:',
    ...(src.dailyLogs.length ? src.dailyLogs.map((l) => l.date + ': ' + l.notes) : ['none']),
    '',
    'EXACT COUNTS for this update (use these numbers, never estimate): ' + countsLine(updateCounts(assets, [])).replace(/^0 new approved change orders, /, '') + '. If you mention change orders, the number is how many you list in describedChangeOrders.',
    '',
    WHATS_NEW_RULES,
    '',
    'Write: one whatsNew sentence covering what is new (photos, videos, plans, the work in the change orders you describe, progress). A status value (keep the style of the current row, update it only if the stage has moved). A caption for every new photo and rendering id. A videos entry for every new video id (design walkthroughs are design concepts). A plansSentence only if there are new plans or renderings. An evolvedParagraph only if there are new change orders.',
  ].join('\n');

  const raw: any = await callForJson({ system: VOICE, user, toolName: 'save_update', toolDescription: 'Save the update pieces.', schema: updateSchema, maxTokens: 8000 });
  const checked = await enforceRules(raw, updateSchema, src.job.clientFirstNames, 'update');
  const u: any = checked.value;
  // Only change orders the paragraph actually describes are counted.
  const offered = new Set(newChangeOrders.map((c) => c.id));
  const described = (u.describedChangeOrders || []).filter((id) => offered.has(id));
  if (!u.evolvedParagraph || !u.evolvedParagraph.trim()) described.length = 0;
  // Counts in the prose must match what is actually included.
  const counts = updateCounts(assets, described);
  u.whatsNew = await fixWhatsNew(
    fixCounts(u.whatsNew, counts),
    [
      countsLine(counts).replace(/^\d+ new approved change orders?, /, ''),
      described.length ? 'Work from the change orders described: ' + (u.evolvedParagraph || '') : 'No change order work to mention.',
    ].join('\n')
  );
  u.evolvedParagraph = fixCounts(u.evolvedParagraph || '', counts);
  u.plansSentence = fixCounts(u.plansSentence || '', counts);
  const caption = (id: string) => (u.captions.find((c) => c.id === id) || {}).caption || '';

  // Merge into the stored profile.
  const c: ProfileContent = JSON.parse(JSON.stringify(current));
  const dated = longDate(today);
  c.whatsNew = [{ date: today, text: u.whatsNew }, ...c.whatsNew.filter((w) => w.date !== today)];
  setFact(c, 'Last Updated', dated);
  if (u.status) setFact(c, 'Status', u.status);

  const idOf = (a: NewAsset) => Object.keys(ids).find((k) => ids[k] === a);
  const photos = assets.filter(isPhoto);
  const renders = assets.filter(isRendering);
  const videos = assets.filter(isVideo);

  if (renders.length) {
    let dv: any = c.sections.find((s) => s.kind === 'photos' && /design vision/i.test(s.heading));
    if (!dv) {
      dv = { kind: 'photos', heading: 'Design Vision', intro: 'Design renderings for the project. These photos are also saved in this folder.', photos: [] };
      const firstPhotos = c.sections.findIndex((s) => s.kind === 'photos' && !/home today/i.test(s.heading));
      c.sections.splice(firstPhotos < 0 ? c.sections.length : firstPhotos, 0, dv);
    }
    for (const a of renders) dv.photos.push({ image: { source: 'jobtread', fileId: a.fileId }, caption: caption(idOf(a)) });
  }

  if (videos.length) {
    let vs: any = c.sections.find((s) => /video/i.test(s.heading));
    if (!vs) {
      vs = { kind: 'leadBullets', heading: 'Video Walk-Throughs', items: [] };
      insertInOrder(c, vs);
    }
    for (const v of u.videos) {
      if (vs.kind === 'leadBullets') vs.items.push({ lead: v.title, text: v.text });
      else if (vs.kind === 'bullets') vs.bullets.push(v.title + ': ' + v.text);
      else if (vs.kind === 'paragraphs') vs.paragraphs.push(v.title + ': ' + v.text);
    }
  }

  if (u.plansSentence && u.plansSentence.trim()) {
    let ps: any = c.sections.find((s) => /plans/i.test(s.heading) && s.kind !== 'photos');
    if (!ps) {
      ps = { kind: 'paragraphs', heading: 'Plans & Renderings', paragraphs: [] };
      insertInOrder(c, ps);
    }
    if (ps.kind === 'paragraphs') ps.paragraphs.push(u.plansSentence.trim());
    else if (ps.kind === 'bullets') ps.bullets.push(u.plansSentence.trim());
  }

  if (u.evolvedParagraph && u.evolvedParagraph.trim()) {
    let ev: any = c.sections.find((s) => /evolved/i.test(s.heading));
    if (!ev) {
      ev = { kind: 'paragraphs', heading: 'How the Project Evolved', paragraphs: [] };
      insertInOrder(c, ev);
    }
    if (ev.kind === 'paragraphs') ev.paragraphs.push(u.evolvedParagraph.trim());
    else if (ev.kind === 'bullets') ev.bullets.push(u.evolvedParagraph.trim());
  }

  if (photos.length) {
    c.sections.push({
      kind: 'photos',
      heading: 'Progress Update (' + dated + ')',
      intro: u.progressIntro || 'New photos from the job site. These photos are also saved in this folder.',
      photos: photos.map((a) => ({ image: { source: 'jobtread', fileId: a.fileId }, caption: caption(idOf(a)) })),
    });
  }

  return {
    content: c,
    shownIds: assets.map((a) => a.fileId),
    shownChangeOrders: newChangeOrders.map((x) => x.id),
    describedChangeOrders: newChangeOrders.filter((x) => described.includes(x.id)).map((x) => x.name),
    rulesFixed: checked.fixed,
    rulesScrubbed: checked.scrubbed,
  };
}

// ------------------------------------------------------------ counts

type Counts = Record<'changeOrder' | 'photo' | 'video' | 'rendering' | 'plan', number>;

export function updateCounts(assets: NewAsset[], newChangeOrders: any[]): Counts {
  return {
    changeOrder: newChangeOrders.length,
    photo: assets.filter(isPhoto).length,
    video: assets.filter(isVideo).length,
    rendering: assets.filter(isRendering).length,
    plan: assets.filter(isPlan).length,
  };
}

function countsLine(c: Counts) {
  return [
    c.changeOrder + ' new approved change order' + (c.changeOrder === 1 ? '' : 's'),
    c.photo + ' new photo' + (c.photo === 1 ? '' : 's'),
    c.video + ' new video' + (c.video === 1 ? '' : 's'),
    c.rendering + ' new rendering' + (c.rendering === 1 ? '' : 's'),
    c.plan + ' new plan file' + (c.plan === 1 ? '' : 's'),
  ].join(', ');
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const NOUNS: [keyof Counts, string][] = [
  ['changeOrder', 'change orders?'],
  ['photo', 'photos?|photographs?|progress photos?'],
  ['video', 'videos?|clips?'],
  ['rendering', 'renderings?'],
];

function numberWord(n: number, capital: boolean) {
  const w = n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
  return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

/**
 * Replace any count the writer put in front of these nouns ("three approved
 * change orders", "2 new photos") with the real count. Up to three words may
 * sit between the number and the noun.
 */
export function fixCounts(text: string, counts: Counts): string {
  if (!text) return text;
  let out = text;
  for (const [key, noun] of NOUNS) {
    const n = counts[key];
    if (!n) continue;
    const re = new RegExp('\\b(' + NUMBER_WORDS.join('|') + '|an|a|\\d+)((?:\\s+[A-Za-z-]+){0,3}?\\s+)(' + noun + ')\\b', 'gi');
    out = out.replace(re, (m, num, middle, word) => {
      // "a change order" is already right when there is one.
      if (/^an?$/i.test(num) && n === 1) return m;
      const capital = /^[A-Z]/.test(num);
      let w = word;
      if (n === 1) w = w.replace(/s$/i, '');
      else if (!/s$/i.test(w)) w = w + 's';
      return numberWord(n, capital) + middle + w;
    });
  }
  return out;
}

function setFact(c: ProfileContent, label: string, value: string) {
  const f = c.facts.find((x) => x.label.toLowerCase() === label.toLowerCase());
  if (f) f.value = value;
  else c.facts.push({ label, value });
}

/** Rank of a section in the spec's order; photo sections and unknown headings come after. */
function rank(s: ProfileSection): number {
  if (s.kind === 'photos') return 100;
  const i = SECTION_ORDER.findIndex((h) => h.toLowerCase() === s.heading.toLowerCase());
  return i < 0 ? 50 : i;
}

/** Put a new section before the first existing section that comes after it in the spec's order. */
function insertInOrder(c: ProfileContent, s: ProfileSection) {
  const r = rank(s);
  const i = c.sections.findIndex((x) => rank(x) > r);
  c.sections.splice(i < 0 ? c.sections.length : i, 0, s);
}
