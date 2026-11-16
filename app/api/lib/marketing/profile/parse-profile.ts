// @ts-nocheck
/**
 * First run for a job: read the current profile .docx from Mike's FTP into
 * ProfileContent. The text is kept word for word; Claude only decides which
 * block belongs to which part of the profile. Embedded photos are copied to
 * the private marketing-profiles bucket so later rebuilds can include them.
 *
 * Style note: no em or en dashes in this file.
 */
import { getSupabase } from '@/app/api/lib/supabase';
import { readDocx, blocksToOutline } from './read-docx';
import { callForJson } from './claude';
import type { ProfileContent } from './types';

export const BUCKET = 'marketing-profiles';

const SYSTEM = `You map an existing Brett King Builder "Marketing Project Profile" Word document to its parts. You see the document as numbered blocks. Return block numbers only; the text is copied from the document by code, so never rewrite anything.

The document's parts, in order: title (job name), subtitle "Marketing Project Profile", a one line italic tagline, "What's new (<date>): ..." lines, a facts table (Project, Last Updated, Location, Project Type, Status, Standout Feature), then sections such as Project Description, Scope of Work (bold subheads with bullets), How the Project Evolved, Challenges & Solutions (Challenge: / Solution: pairs), Suggested Marketing Angles (bullets with a bold lead phrase and a colon), Plans & Renderings, Video Walk-Throughs, and photo sections (The Home Today, Design Vision, Photo Highlights, Progress Photos, Progress Update (<date>)) holding an italic intro line, images, and a caption line under each image.

Rules:
- Every section lists its heading block and the blocks under it, in order. Choose kind: paragraphs, scope, challenges, leadBullets, bullets, or photos.
- A section you do not recognize keeps its heading and becomes paragraphs or bullets.
- whatsNewBlocks: the "What's new (...)" lines near the top.
- If the document also has an older "What's New" section further down (bullets or dated notes), do not list it as a section. Instead put its items in olderWhatsNew as { date: "YYYY-MM-DD", text } with one entry per date (join same date items into one or two sentences, keep their wording).
- Leave out page header or footer text if it appears.`;

const parseSchema = {
  type: 'object',
  properties: {
    titleBlock: { type: 'integer' },
    subtitleBlock: { type: 'integer' },
    taglineBlock: { type: 'integer' },
    whatsNewBlocks: { type: 'array', items: { type: 'integer' } },
    olderWhatsNew: {
      type: 'array',
      items: { type: 'object', properties: { date: { type: 'string' }, text: { type: 'string' } }, required: ['date', 'text'] },
    },
    factsTableBlock: { type: 'integer' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['paragraphs', 'scope', 'challenges', 'leadBullets', 'bullets', 'photos'] },
          headingBlock: { type: 'integer' },
          blocks: { type: 'array', items: { type: 'integer' } },
        },
        required: ['kind', 'headingBlock', 'blocks'],
      },
    },
  },
  required: ['titleBlock', 'whatsNewBlocks', 'sections'],
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "What's new (October 23, 2026): text" to { date: "2026-10-23", text }. */
export function parseWhatsNew(line: string): { date: string; text: string } | null {
  const m = line.match(/^what.?s new\s*\(([^)]+)\)\s*:?\s*([\s\S]*)$/i);
  if (!m) return null;
  const d = m[1].trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  let date = m[1].trim();
  if (d && MONTHS.indexOf(d[1].toLowerCase()) >= 0) {
    date = d[3] + '-' + String(MONTHS.indexOf(d[1].toLowerCase()) + 1).padStart(2, '0') + '-' + d[2].padStart(2, '0');
  }
  return { date, text: m[2].trim() };
}

function splitLead(text: string): { lead: string; text: string } {
  const i = text.indexOf(':');
  if (i > 0 && i < 90) return { lead: text.slice(0, i).trim(), text: text.slice(i + 1).trim() };
  return { lead: text, text: '' };
}

/** Turn a mapped section into ProfileSection content, copying text from the blocks. */
function buildSection(kind: string, heading: string, blocks: any[], imageIds: Record<string, string>) {
  const texts = blocks.filter((b) => b.t === 'p' && b.text && !b.images.length);
  if (kind === 'paragraphs') return { kind, heading, paragraphs: texts.map((b) => b.text) };
  if (kind === 'bullets') {
    const intro = texts.find((b) => !b.bullet);
    return { kind, heading, intro: intro && intro === texts[0] ? intro.text : undefined, bullets: texts.filter((b) => b !== intro || intro !== texts[0]).map((b) => b.text) };
  }
  if (kind === 'leadBullets') {
    const first = texts[0];
    const hasIntro = first && !first.bullet && first.text.indexOf(':') < 0;
    return { kind, heading, intro: hasIntro ? first.text : undefined, items: texts.slice(hasIntro ? 1 : 0).map((b) => splitLead(b.text)) };
  }
  if (kind === 'scope') {
    const groups = [];
    for (const b of texts) {
      if (!b.bullet && (b.bold || groups.length === 0)) groups.push({ heading: b.bullet ? '' : b.text, bullets: [] });
      else {
        if (!groups.length) groups.push({ heading: '', bullets: [] });
        groups[groups.length - 1].bullets.push(b.text);
      }
    }
    return { kind, heading, groups };
  }
  if (kind === 'challenges') {
    const pairs = [];
    for (const b of texts) {
      const c = b.text.match(/^challenge\s*:\s*([\s\S]*)$/i);
      const so = b.text.match(/^solution\s*:\s*([\s\S]*)$/i);
      if (c) pairs.push({ challenge: c[1].trim(), solution: '' });
      else if (so && pairs.length) pairs[pairs.length - 1].solution = (pairs[pairs.length - 1].solution + ' ' + so[1]).trim();
      else if (pairs.length) pairs[pairs.length - 1].solution = (pairs[pairs.length - 1].solution + ' ' + b.text).trim();
    }
    return { kind, heading, pairs };
  }
  // photos: an intro line, then images each followed by a caption line.
  let intro = '';
  const photos = [];
  for (const b of blocks) {
    if (b.t !== 'p') continue;
    if (b.images.length) {
      for (const p of b.images) photos.push({ image: imageIds[p], caption: '' });
      if (b.text) photos[photos.length - 1].caption = b.text;
    } else if (b.text) {
      if (photos.length && !photos[photos.length - 1].caption) photos[photos.length - 1].caption = b.text;
      else if (!photos.length) intro = intro ? intro + ' ' + b.text : b.text;
      else photos[photos.length - 1].caption += ' ' + b.text;
    }
  }
  return { kind: 'photos', heading, intro, photos };
}

export async function parseProfileDocx(jobId: string, buf: Buffer): Promise<ProfileContent> {
  const read = await readDocx(buf);

  // Give every embedded image a short id for the model, and keep the bytes.
  const imageIds: Record<string, string> = {};
  const idToPath: Record<string, string> = {};
  let n = 0;
  for (const path of Object.keys(read.media)) {
    const id = 'img' + ++n;
    imageIds[path] = id;
    idToPath[id] = path;
  }

  const outline = blocksToOutline(read.blocks, imageIds);
  const map: any = await callForJson({
    system: SYSTEM,
    user: 'Document outline, one block per line ([index] type, style hints, text):\n\n' + outline,
    toolName: 'map_profile',
    toolDescription: 'Save which blocks make up each part of the profile.',
    schema: parseSchema,
    maxTokens: 8000,
  });

  const B = read.blocks;
  const textOf = (i) => (i != null && B[i] && B[i].t === 'p' ? B[i].text : '');
  const whatsNew = [
    ...(map.whatsNewBlocks || []).map((i) => parseWhatsNew(textOf(i))).filter(Boolean),
    ...(map.olderWhatsNew || []),
  ];
  // Newest first, one entry per date.
  const byDate = new Map();
  for (const w of whatsNew) if (!byDate.has(w.date)) byDate.set(w.date, w);
  const facts =
    map.factsTableBlock != null && B[map.factsTableBlock]?.t === 'table'
      ? B[map.factsTableBlock].rows.filter((r) => r.length >= 2 && r[0]).map((r) => ({ label: r[0], value: r.slice(1).join(' ').trim() }))
      : [];
  const parsed = {
    title: textOf(map.titleBlock),
    subtitle: textOf(map.subtitleBlock) || 'Marketing Project Profile',
    tagline: textOf(map.taglineBlock),
    whatsNew: Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1)),
    facts,
    sections: (map.sections || []).map((s) => buildSection(s.kind, textOf(s.headingBlock), (s.blocks || []).map((i) => B[i]).filter(Boolean), imageIds)),
  };

  // Store the images and swap ids for storage references.
  const supabase = getSupabase();
  const stored: Record<string, string> = {};
  for (const [id, path] of Object.entries(idToPath)) {
    const ext = (path.split('.').pop() || 'bin').toLowerCase();
    const dest = jobId + '/legacy/' + id + '.' + ext;
    const { error } = await supabase.storage.from(BUCKET).upload(dest, read.media[path], {
      contentType: ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg',
      upsert: true,
    });
    if (error) throw new Error('Could not store profile image ' + id + ': ' + error.message);
    stored[id] = dest;
  }

  // Heading size from the first section heading in the original.
  const firstHeading = read.blocks.find(
    (b) => b.t === 'p' && b.bold && b.sizePt && b.sizePt > (read.style.bodySizePt || 11) && b.sizePt < 20
  );

  const sections = (parsed.sections || []).map((s) =>
    s.kind === 'photos'
      ? {
          ...s,
          intro: s.intro || '',
          photos: (s.photos || [])
            .filter((p) => stored[p.image])
            .map((p) => ({ image: { source: 'storage', path: stored[p.image] }, caption: p.caption || '' })),
        }
      : s
  );

  return {
    title: parsed.title,
    subtitle: parsed.subtitle || 'Marketing Project Profile',
    tagline: parsed.tagline || '',
    whatsNew: parsed.whatsNew || [],
    facts: parsed.facts || [],
    sections,
    style: {
      font: read.style.font || 'Calibri',
      bodySizePt: read.style.bodySizePt || 11,
      headingSizePt: (firstHeading as any)?.sizePt || 14,
    },
  };
}
