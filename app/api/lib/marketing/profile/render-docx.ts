// @ts-nocheck
/**
 * Render ProfileContent to a Marketing Project Profile .docx in the exact
 * format of the live profiles on Mike's FTP. Every measurement below was
 * read from the original Marrero-Kitchen Addition Marketing Profile.docx
 * (snapshot in agent_cache marketing-profile-source:22PAN3gjeRgh):
 *
 *   Page:     US Letter, margins top/bottom 1200, left/right 1440 (twips),
 *             header and footer distance 708
 *   Header:   right aligned, bold, blue 2E75B6, 8 pt,
 *             "BRETT KING BUILDER  |  Marketing Project Profile"
 *   Footer:   centered, gray 555555, 8 pt, "Page N"
 *   Font:     Arial 11 pt (from the original's styles)
 *   Title:    20 pt bold navy, after 40.  Subtitle: 13 pt blue, after 60.
 *   Tagline:  10 pt italic gray, after 240.
 *   Facts:    table 9360 wide, columns 2600 / 6760, thin DDDDDD borders,
 *             cell margins 80 / 140, label cells shaded EEF3F8, bold navy.
 *   Then an empty paragraph (after 120) and the What's new lines:
 *             10 pt bold italic navy, no spacing.
 *   Headings: Heading 1 style, 14 pt bold navy, blue rule under
 *             (2E75B6, size 6, space 4), before 300, after 140.
 *   Body:     after 140, line 276.  Scope subheads: bold navy, before 120,
 *             after 60.  Bullets: "•" indented 460, hanging 260.
 *   Challenges: bullet (after 40) "Challenge: " bold, then a Solution
 *             paragraph indented 460 (after 160) "Solution: " bold.
 *   Angles:   bullet (after 90) bold lead and colon.
 *   Videos and Plans text, photo intros, captions: 10 pt italic gray.
 *   Photos:   4.9 in wide, centered, before 120 after 40; caption centered
 *             after 200. A page break before The Home Today and Design Vision.
 *
 * Style note: no em or en dashes in this file.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { ProfileContent, ProfileSection } from './types';

export const NAVY = '1F3A5F';
export const BLUE = '2E75B6';
export const GRAY = '555555';
const SHADE = 'EEF3F8';
const BORDER = 'DDDDDD';

const IMAGE_WIDTH_IN = 4.9;
const MAX_IMAGE_HEIGHT_IN = 4.3;
const PX_PER_IN = 96;
const SMALL = 20; // 10 pt, in half points
const BULLET_REF = 'bkb-bullet';
const PAGE_BREAK_BEFORE = /^(the home today|design vision)$/i;
const ITALIC_TEXT_SECTIONS = /video|plans/i;

/** Width and height in pixels from a JPEG, PNG, GIF or BMP header. */
export function imageSize(buf: Buffer): { w: number; h: number; type: 'jpg' | 'png' | 'gif' | 'bmp' } | null {
  if (buf.length < 24) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
  }
  if (buf.toString('ascii', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), type: 'gif' };
  if (buf.toString('ascii', 0, 2) === 'BM') return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)), type: 'bmp' };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'jpg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Fetches the bytes for one photo. Returns null when the image is unavailable. */
export type ImageLoader = (ref: any) => Promise<Buffer | null>;

export async function renderProfile(c: ProfileContent, loadImageOne: ImageLoader): Promise<Buffer> {
  // Fetch every photo up front, six at a time, instead of one by one.
  const refs = (c.sections || []).flatMap((s: any) => (s.kind === 'photos' ? s.photos.map((p) => p.image) : []));
  const cache = new Map<string, Promise<Buffer | null>>();
  const keyOf = (r: any) => JSON.stringify(r);
  let next = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (next < refs.length) {
      const r = refs[next++];
      if (!cache.has(keyOf(r))) {
        const p = loadImageOne(r).catch(() => null);
        cache.set(keyOf(r), p);
        await p;
      }
    }
  });
  await Promise.all(workers);
  const loadImage = (r: any) => cache.get(keyOf(r)) || loadImageOne(r);

  const font = c.style?.font || 'Arial';
  const body = (c.style?.bodySizePt || 11) * 2; // half points
  const headingSize = (c.style?.headingSizePt || 14) * 2;

  const t = (text: string, o: any = {}) => new TextRun({ text, font, size: body, ...o });
  const small = (text: string, o: any = {}) => t(text, { italics: true, color: GRAY, size: SMALL, ...o });
  const children: any[] = [];

  // Title, subtitle, tagline.
  children.push(new Paragraph({ spacing: { after: 40 }, children: [t(c.title, { bold: true, size: 40, color: NAVY })] }));
  children.push(new Paragraph({ spacing: { after: 60 }, children: [t(c.subtitle || 'Marketing Project Profile', { size: 26, color: BLUE })] }));
  if (c.tagline) children.push(new Paragraph({ spacing: { after: 240 }, children: [small(c.tagline)] }));

  // Facts table.
  if (c.facts?.length) {
    const thin = { style: BorderStyle.SINGLE, size: 1, color: BORDER };
    const borders = { top: thin, bottom: thin, left: thin, right: thin };
    const margins = { top: 80, bottom: 80, left: 140, right: 140 };
    children.push(
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2600, 6760],
        rows: c.facts.map(
          (f) =>
            new TableRow({
              children: [
                new TableCell({
                  borders,
                  margins,
                  width: { size: 2600, type: WidthType.DXA },
                  shading: { type: ShadingType.CLEAR, color: 'auto', fill: SHADE },
                  children: [new Paragraph({ children: [t(f.label, { bold: true, color: NAVY })] })],
                }),
                new TableCell({
                  borders,
                  margins,
                  width: { size: 6760, type: WidthType.DXA },
                  children: [new Paragraph({ children: [t(f.value)] })],
                }),
              ],
            })
        ),
      })
    );
  }

  // A spacer, then the What's new lines, newest first.
  children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  for (const w of c.whatsNew || []) {
    children.push(
      new Paragraph({
        children: [t("What's new (" + longDate(w.date) + '): ' + w.text, { bold: true, italics: true, color: NAVY, size: SMALL })],
      })
    );
  }

  const bodyPara = (text: string, italicGray = false) =>
    new Paragraph({ spacing: { after: 140, line: 276 }, children: [italicGray ? small(text) : t(text)] });
  const bullet = (runs: any[], after: number) =>
    new Paragraph({ numbering: { reference: BULLET_REF, level: 0 }, spacing: { after }, children: runs });

  for (const s of c.sections || []) {
    if (PAGE_BREAK_BEFORE.test((s.heading || '').trim())) children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, children: [new TextRun({ text: s.heading })] }));
    await renderSection(s);
  }

  async function renderSection(s: ProfileSection) {
    const quiet = ITALIC_TEXT_SECTIONS.test(s.heading || '');
    if (s.kind === 'paragraphs') {
      for (const p of s.paragraphs) children.push(bodyPara(p, quiet));
    } else if (s.kind === 'scope') {
      for (const g of s.groups) {
        if (g.heading) children.push(new Paragraph({ spacing: { before: 120, after: 60 }, keepNext: true, children: [t(g.heading, { bold: true, color: NAVY })] }));
        for (const b of g.bullets) children.push(bullet([t(b)], 60));
      }
    } else if (s.kind === 'challenges') {
      for (const pr of s.pairs) {
        children.push(bullet([t('Challenge: ', { bold: true }), t(pr.challenge)], 40));
        children.push(new Paragraph({ indent: { left: 460 }, spacing: { after: 160 }, children: [t('Solution: ', { bold: true }), t(pr.solution)] }));
      }
    } else if (s.kind === 'leadBullets') {
      if (s.intro) children.push(bodyPara(s.intro, quiet));
      for (const it of s.items) children.push(bullet([t(it.lead + ': ', { bold: true }), t(it.text)], 90));
    } else if (s.kind === 'bullets') {
      if (s.intro) children.push(bodyPara(s.intro, quiet));
      for (const b of s.bullets) children.push(bullet([t(b)], 60));
    } else if (s.kind === 'photos') {
      if (s.intro) children.push(new Paragraph({ spacing: { after: 140, line: 276 }, keepNext: true, children: [small(s.intro)] }));
      for (const ph of s.photos) {
        const bytes = await loadImage(ph.image).catch(() => null);
        const size = bytes ? imageSize(bytes) : null;
        if (!bytes || !size || !size.w || !size.h) continue;
        let w = IMAGE_WIDTH_IN * PX_PER_IN;
        let h = (w * size.h) / size.w;
        const maxH = MAX_IMAGE_HEIGHT_IN * PX_PER_IN;
        if (h > maxH) {
          w = (w * maxH) / h;
          h = maxH;
        }
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { before: 120, after: 40 },
            children: [new ImageRun({ type: size.type, data: bytes, transformation: { width: Math.round(w), height: Math.round(h) } })],
          })
        );
        if (ph.caption) {
          children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [small(ph.caption)] }));
        }
      }
    }
  }

  const doc = new Document({
    creator: 'Brett King Builder',
    title: c.title + ' Marketing Project Profile',
    styles: {
      default: { document: { run: { font, size: body } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font, bold: true, color: NAVY, size: headingSize },
          paragraph: {
            spacing: { before: 300, after: 140 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } },
            outlineLevel: 0,
          },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 460, hanging: 260 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // US Letter
            margin: { top: 1200, bottom: 1200, left: 1440, right: 1440, header: 708, footer: 708 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [t('BRETT KING BUILDER  |  Marketing Project Profile', { bold: true, size: 16, color: BLUE })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [t('Page ', { size: 16, color: GRAY }), new TextRun({ children: [PageNumber.CURRENT], font, size: 16, color: GRAY })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** "2026-11-16" to "November 16, 2026". */
export function longDate(iso: string): string {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}
