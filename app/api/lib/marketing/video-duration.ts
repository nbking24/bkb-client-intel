// @ts-nocheck
/**
 * Read a video's length in seconds from its MP4 or MOV header without
 * downloading the whole file. The length lives in the "mvhd" box inside
 * "moov", which phones write either at the start or at the end of the file,
 * so this asks for the first 512 KB and, if needed, the last 1 MB.
 *
 * Returns null when the length cannot be found (other formats, a server that
 * refuses ranges). Callers treat null as "unknown" and keep the video.
 *
 * Style note: no em or en dashes in this file.
 */

const HEAD_BYTES = 512 * 1024;
const TAIL_BYTES = 1024 * 1024;

/** Find an mvhd box in a buffer and return duration / timescale. */
export function durationFromBuffer(buf: Buffer): number | null {
  let i = buf.indexOf('mvhd');
  while (i >= 4) {
    const p = i + 4; // version byte
    if (p + 32 <= buf.length) {
      const version = buf[p];
      let timescale = 0;
      let duration = 0;
      if (version === 0) {
        timescale = buf.readUInt32BE(p + 12);
        duration = buf.readUInt32BE(p + 16);
      } else if (version === 1 && p + 36 <= buf.length) {
        timescale = buf.readUInt32BE(p + 20);
        duration = Number(buf.readBigUInt64BE(p + 24));
      }
      if (timescale > 0 && duration > 0) return duration / timescale;
    }
    i = buf.indexOf('mvhd', i + 4);
  }
  return null;
}

/** Fetch a byte range, reading at most `limit` bytes even if the server ignores Range. */
async function fetchRange(url: string, range: string, limit: number): Promise<Buffer | null> {
  // A stalled download must not hold up the whole run: give up after 20
  // seconds and treat the length as unknown (the video is kept).
  const res = await fetch(url, { headers: { Range: range }, cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!res.ok || !res.body) return null;
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  // A server that ignored the Range header sent the start of the file; that
  // is only useful for the head request.
  if (res.status !== 206 && range.startsWith('bytes=-')) return null;
  return Buffer.concat(chunks);
}

export async function videoDurationSeconds(url: string): Promise<number | null> {
  try {
    const head = await fetchRange(url, 'bytes=0-' + (HEAD_BYTES - 1), HEAD_BYTES);
    const fromHead = head ? durationFromBuffer(head) : null;
    if (fromHead != null) return fromHead;
    const tail = await fetchRange(url, 'bytes=-' + TAIL_BYTES, TAIL_BYTES);
    return tail ? durationFromBuffer(tail) : null;
  } catch {
    return null;
  }
}
