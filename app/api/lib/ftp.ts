// @ts-nocheck
/**
 * FTP helper for the Marketing Photo Engine folder browser.
 *
 * Connects to the web designer's FTP server and lets the Hub list, download,
 * and upload files under a single marketing root. All configuration comes from
 * environment variables. No credentials live in this file.
 *
 * Env:
 *   MARKETING_FTP_HOST      the FTP host
 *   MARKETING_FTP_USER      the FTP user
 *   MARKETING_FTP_PASSWORD  the FTP password
 *   MARKETING_FTP_PORT      the FTP port (default 21)
 *   MARKETING_FTP_ROOT      the marketing root folder (default "BKB Review")
 *
 * Style note: no em dashes in this file.
 */
import { Client } from 'basic-ftp';
import { Writable, Readable } from 'stream';

const HOST = process.env.MARKETING_FTP_HOST || '';
const USER = process.env.MARKETING_FTP_USER || '';
const PASSWORD = process.env.MARKETING_FTP_PASSWORD || '';
const PORT = Number(process.env.MARKETING_FTP_PORT || 21);
const ROOT = process.env.MARKETING_FTP_ROOT || 'BKB Review';

/** True only when host, user, and password are all set. */
export function isConfigured(): boolean {
  return Boolean(HOST && USER && PASSWORD);
}

/**
 * Reject any subpath that tries to escape the root, then join it onto ROOT.
 * Blocks "..", leading slashes, and null bytes. Returns the full server path.
 */
function safeJoin(subpath = ''): string {
  const sub = String(subpath || '').replace(/\\/g, '/');
  if (sub.includes('\0')) throw new Error('Invalid path');
  if (sub.startsWith('/')) throw new Error('Invalid path');
  // Reject any ".." segment.
  if (sub.split('/').some((seg) => seg === '..')) throw new Error('Invalid path');
  const trimmed = sub.replace(/^\/+|\/+$/g, '');
  return trimmed ? ROOT + '/' + trimmed : ROOT;
}

async function connect(): Promise<Client> {
  const client = new Client(30000);
  client.ftp.verbose = false;
  await client.access({
    host: HOST,
    user: USER,
    password: PASSWORD,
    port: PORT,
    secure: false,
  });
  return client;
}

/**
 * List the entries under ROOT/subpath. Directories first, then files, each
 * group sorted alphabetically (case-insensitive).
 */
export async function listPath(
  subpath = ''
): Promise<{ name: string; isDir: boolean; size: number }[]> {
  const full = safeJoin(subpath);
  const client = await connect();
  try {
    const list = await client.list(full);
    const entries = list
      .filter((e) => e.name !== '.' && e.name !== '..')
      .map((e) => ({
        name: e.name,
        // basic-ftp FileType: 2 is directory, 1 is file, 3 is symlink.
        isDir: e.isDirectory === true || e.type === 2,
        size: typeof e.size === 'number' ? e.size : 0,
      }));
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return entries;
  } finally {
    client.close();
  }
}

/** Download ROOT/subpath into a Buffer. */
export async function downloadFile(subpath: string): Promise<Buffer> {
  const full = safeJoin(subpath);
  const client = await connect();
  try {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    await client.downloadTo(sink, full);
    return Buffer.concat(chunks);
  } finally {
    client.close();
  }
}

/**
 * Upload a Buffer to ROOT/subpath. Ensures the parent folder exists first.
 */
export async function uploadFile(subpath: string, buffer: Buffer): Promise<void> {
  const full = safeJoin(subpath);
  const slash = full.lastIndexOf('/');
  const parent = slash > 0 ? full.slice(0, slash) : ROOT;
  const client = await connect();
  try {
    // ensureDir creates and changes into the parent folder. Return to the
    // server root before uploading with the absolute path so the target is
    // unambiguous no matter where ensureDir left the working directory.
    await client.ensureDir(parent);
    await client.cd('/');
    const readable = Readable.from(buffer);
    await client.uploadFrom(readable, full);
  } finally {
    client.close();
  }
}

/**
 * Delete a single file at ROOT/subpath. Files only, never directories: a
 * subpath ending in "/" is rejected. safeJoin keeps the target inside ROOT.
 */
export async function deleteFile(subpath: string): Promise<void> {
  const sub = String(subpath || '');
  if (!sub || sub.replace(/\\/g, '/').endsWith('/')) {
    throw new Error('Invalid path');
  }
  const full = safeJoin(sub);
  const client = await connect();
  try {
    await client.remove(full);
  } finally {
    client.close();
  }
}
