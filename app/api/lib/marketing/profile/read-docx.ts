// @ts-nocheck
/**
 * Read an existing Marketing Project Profile (.docx) into an ordered list of
 * blocks: paragraphs (with style hints), tables, and embedded images. The
 * mapping from blocks to ProfileContent is done by parse-profile.ts.
 *
 * Only the main document body is read; the header and footer are fixed and
 * are written fresh by the renderer.
 *
 * Style note: no em or en dashes in this file.
 */
import JSZip from 'jszip';

export type DocBlock =
  | {
      t: 'p';
      text: string;
      style: string | null;
      bullet: boolean;
      level: number;
      align: string | null;
      bold: boolean; // every text run is bold
      italic: boolean; // every text run is italic
      sizePt: number | null;
      color: string | null;
      images: string[]; // media paths inside the zip, e.g. word/media/image3.jpeg
    }
  | { t: 'table'; rows: string[][] };

export type DocRead = {
  blocks: DocBlock[];
  media: Record<string, Buffer>; // only images referenced by the body
  style: { font: string | null; bodySizePt: number | null };
};

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function attr(xml: string, tag: string, name = 'w:val'): string | null {
  const m = xml.match(new RegExp('<' + tag + '\\b[^>]*\\s' + name + '="([^"]*)"'));
  return m ? m[1] : null;
}

function isOn(rPr: string, tag: string): boolean {
  const m = rPr.match(new RegExp('<' + tag + '(\\s[^>]*)?/?>'));
  if (!m) return false;
  const v = (m[1] || '').match(/w:val="([^"]*)"/);
  return !v || !['0', 'false', 'off'].includes(v[1]);
}

function readParagraph(p: string, rels: Record<string, string>): DocBlock {
  const pPr = (p.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/) || [])[1] || '';
  const style = attr(pPr, 'w:pStyle');
  const bullet = /<w:numPr>/.test(pPr) || /List/i.test(style || '');
  const level = Number(attr(pPr, 'w:ilvl') || 0);
  const align = attr(pPr, 'w:jc');

  let text = '';
  const runs = p.match(/<w:r\b[\s\S]*?<\/w:r>/g) || [];
  let textRuns = 0;
  let boldRuns = 0;
  let italicRuns = 0;
  let sizePt: number | null = null;
  let color: string | null = null;
  const images: string[] = [];
  for (const r of runs) {
    const rPr = (r.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || '';
    let rt = '';
    for (const piece of r.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>|<w:br [^>]*\/>/g) || []) {
      if (piece.startsWith('<w:tab')) rt += '\t';
      else if (piece.startsWith('<w:br')) rt += '\n';
      else rt += decode(piece.replace(/<[^>]+>/g, ''));
    }
    for (const m of r.matchAll(/r:embed="([^"]+)"/g)) {
      const target = rels[m[1]];
      if (target) images.push(target);
    }
    if (rt.trim()) {
      textRuns++;
      if (isOn(rPr, 'w:b')) boldRuns++;
      if (isOn(rPr, 'w:i')) italicRuns++;
      const sz = attr(rPr, 'w:sz');
      if (sz && sizePt == null) sizePt = Number(sz) / 2;
      const c = attr(rPr, 'w:color');
      if (c && color == null) color = c;
    }
    text += rt;
  }
  return {
    t: 'p',
    text: text.replace(/[  ]+/g, ' ').trim(),
    style,
    bullet,
    level,
    align,
    bold: textRuns > 0 && boldRuns === textRuns,
    italic: textRuns > 0 && italicRuns === textRuns,
    sizePt,
    color,
    images,
  };
}

function readTable(tbl: string): DocBlock {
  const rows = (tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []).map((tr) =>
    (tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map((tc) =>
      (tc.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [])
        .map((p) =>
          (p.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) || []).map((t) => decode(t.replace(/<[^>]+>/g, ''))).join('')
        )
        .join('\n')
        .trim()
    )
  );
  return { t: 'table', rows };
}

export async function readDocx(buf: Buffer): Promise<DocRead> {
  const zip = await JSZip.loadAsync(buf);
  const doc = await zip.file('word/document.xml')?.async('string');
  if (!doc) throw new Error('Not a Word document (no word/document.xml)');

  // Relationship id to media path.
  const relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('string')) || '';
  const rels: Record<string, string> = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1];
    const target = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (id && target && /image/i.test(m[0])) rels[id] = 'word/' + target.replace(/^\/?word\//, '').replace(/^\.\.\//, '');
  }

  const body = (doc.match(/<w:body>([\s\S]*)<\/w:body>/) || [])[1] || '';
  const blocks: DocBlock[] = [];
  // Top level tables and paragraphs in document order. A table is matched
  // whole first so its inner paragraphs are not read twice.
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const x = m[0];
    if (x.startsWith('<w:tbl')) blocks.push(readTable(x));
    else if (/\/>$/.test(x) && !x.includes('</w:p>')) continue; // empty paragraph
    else {
      const b = readParagraph(x, rels);
      if (b.text || b.images.length) blocks.push(b);
    }
  }

  const media: Record<string, Buffer> = {};
  for (const b of blocks) {
    if (b.t !== 'p') continue;
    for (const path of b.images) {
      if (media[path]) continue;
      const f = zip.file(path);
      if (f) media[path] = Buffer.from(await f.async('uint8array'));
    }
  }

  // Default font and size from the styles part.
  const styles = (await zip.file('word/styles.xml')?.async('string')) || '';
  const defaults = (styles.match(/<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/) || [])[1] || '';
  const normal = (styles.match(/<w:style\b[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/) || [])[0] || '';
  const font =
    attr(normal, 'w:rFonts', 'w:ascii') || attr(defaults, 'w:rFonts', 'w:ascii') || null;
  const sz = attr(normal, 'w:sz') || attr(defaults, 'w:sz');

  return { blocks, media, style: { font, bodySizePt: sz ? Number(sz) / 2 : null } };
}

/** One line per block, for the model that maps blocks to ProfileContent. */
export function blocksToOutline(blocks: DocBlock[], imageIds: Record<string, string>): string {
  return blocks
    .map((b, i) => {
      if (b.t === 'table') return '[' + i + '] TABLE ' + JSON.stringify(b.rows);
      const tags = [
        b.style ? 'style=' + b.style : null,
        b.bullet ? 'bullet' + (b.level ? ' level=' + b.level : '') : null,
        b.bold ? 'bold' : null,
        b.italic ? 'italic' : null,
        b.sizePt ? b.sizePt + 'pt' : null,
        b.color ? 'color=' + b.color : null,
        b.align && b.align !== 'left' ? 'align=' + b.align : null,
      ].filter(Boolean);
      const imgs = b.images.map((p) => 'IMAGE ' + imageIds[p]).join(' ');
      return '[' + i + '] P ' + tags.join(' ') + (imgs ? ' ' + imgs : '') + (b.text ? ': ' + b.text : '');
    })
    .join('\n');
}
