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

/**
 * Read only. List ROOT itself and then each top level folder under ROOT, using
 * one connection for the whole walk. Used by the reorg plan, which needs every
 * job folder's contents but must never change anything on the server.
 *
 * Returns the root entries plus a map of folder name to its entries. A folder
 * that cannot be listed gets an error string instead of entries.
 */
const STANDARD_SUBFOLDERS = ['photos', 'plans & renderings', 'videos'];

export async function listRootTree(): Promise<{
  root: { name: string; isDir: boolean; size: number }[];
  folders: Record<string, { entries: { name: string; isDir: boolean; size: number }[]; subs?: Record<string, string[]>; error?: string }>;
}> {
  const client = await connect();
  const toEntries = (list: any[]) =>
    list
      .filter((e) => e.name !== '.' && e.name !== '..')
      .map((e) => ({
        name: e.name,
        isDir: e.isDirectory === true || e.type === 2,
        size: typeof e.size === 'number' ? e.size : 0,
      }));
  try {
    const root = toEntries(await client.list(ROOT));
    const folders: Record<string, any> = {};
    for (const e of root) {
      if (!e.isDir) continue;
      try {
        const entries = toEntries(await client.list(ROOT + '/' + e.name));
        // Also list the three standard subfolders when present, so the plan
        // can spot a file that would clash with one already moved there.
        const subs: Record<string, string[]> = {};
        for (const d of entries) {
          if (!d.isDir || !STANDARD_SUBFOLDERS.includes(d.name.toLowerCase())) continue;
          try {
            subs[d.name.toLowerCase()] = toEntries(await client.list(ROOT + '/' + e.name + '/' + d.name)).map((x) => x.name);
          } catch {
            subs[d.name.toLowerCase()] = [];
          }
        }
        folders[e.name] = { entries, subs };
      } catch (err: any) {
        folders[e.name] = { entries: [], error: err?.message || 'Could not list folder' };
      }
    }
    return { root, folders };
  } finally {
    client.close();
  }
}

/** The configured marketing root folder name, for display. */
export function rootName(): string {
  return ROOT;
}

/**
 * One time reorg of a single job folder. NEVER deletes anything: the only
 * server commands used are LIST, MKD (via ensureDir), CWD and RNFR/RNTO.
 *
 * Runs, in order: create missing subfolders, move loose files into them,
 * then rename the folder itself last so the paths above stay valid.
 *
 * Before every move or rename it re-lists the destination and refuses to go
 * ahead if something with that name is already there, because some FTP
 * servers let RNTO replace an existing file, which would lose it.
 *
 * onAction is awaited after each step so the caller can log it as it happens.
 */
export type ReorgAction =
  | { type: 'mkdir'; folder: string; sub: string }
  | { type: 'move'; folder: string; file: string; to: string }
  | { type: 'rename'; folder: string; to: string };

function assertName(n: string) {
  if (!n || n.includes('/') || n.includes('\\') || n.includes('\0') || n === '.' || n === '..') {
    throw new Error('Unsafe name: ' + n);
  }
}

export async function applyFolderReorg(
  actions: ReorgAction[],
  onAction: (a: ReorgAction, result: { ok: boolean; skipped?: string; error?: string }) => Promise<void>
): Promise<void> {
  const client = await connect();
  try {
    const home = await client.pwd();
    const names = async (path: string) =>
      new Set((await client.list(path)).map((e) => e.name.toLowerCase()));

    for (const a of actions) {
      try {
        assertName(a.folder);
        const folderPath = ROOT + '/' + a.folder;
        if (a.type === 'mkdir') {
          assertName(a.sub);
          if ((await names(folderPath)).has(a.sub.toLowerCase())) {
            await onAction(a, { ok: true, skipped: 'already there' });
            continue;
          }
          await client.ensureDir(folderPath + '/' + a.sub);
          await client.cd(home);
          await onAction(a, { ok: true });
        } else if (a.type === 'move') {
          assertName(a.file);
          assertName(a.to);
          const here = await names(folderPath);
          if (!here.has(a.file.toLowerCase())) {
            await onAction(a, { ok: false, skipped: 'file is no longer at the folder root' });
            continue;
          }
          if ((await names(folderPath + '/' + a.to)).has(a.file.toLowerCase())) {
            await onAction(a, { ok: false, skipped: 'a file with this name is already in ' + a.to + '/, left both alone' });
            continue;
          }
          await client.rename(folderPath + '/' + a.file, folderPath + '/' + a.to + '/' + a.file);
          await onAction(a, { ok: true });
        } else if (a.type === 'rename') {
          assertName(a.to);
          if ((await names(ROOT)).has(a.to.toLowerCase())) {
            await onAction(a, { ok: false, skipped: 'a folder with the new name already exists, left both alone' });
            continue;
          }
          await client.rename(folderPath, ROOT + '/' + a.to);
          await onAction(a, { ok: true });
        }
      } catch (err: any) {
        await onAction(a, { ok: false, error: err?.message || 'FTP error' });
        // Stop this folder on a real error so we never rename a folder that
        // is only partly moved. A rerun picks up where it stopped.
        throw err;
      }
    }
  } finally {
    client.close();
  }
}

/**
 * Upload a stream into ROOT/<folder>/<sub>/ under the wanted file name, never
 * replacing anything that is already there.
 *
 *   - If the wanted name is taken, " 2", " 3" and so on is added before the
 *     extension. Names in `reserved` (already chosen this run) count as taken.
 *   - The bytes go to a hidden temporary name first (".bkb-upload-<key>.part")
 *     and are renamed to the final name only after the upload finishes, so
 *     Mike never sees a half written file. If a run is cut off, the next run
 *     writes the same temporary name again (it only ever holds our own
 *     unfinished upload).
 *
 * Returns the final file name used.
 */
export async function uploadStreamNoOverwrite(opts: {
  folder: string;
  sub: string;
  fileName: string;
  key: string;
  stream: Readable;
  reserved?: Set<string>;
}): Promise<string> {
  const { folder, sub, fileName, key, stream } = opts;
  for (const n of [folder, sub, fileName]) {
    if (!n || /[\/\\\0]/.test(n) || n === '.' || n === '..') throw new Error('Unsafe name: ' + n);
  }
  const safeKey = String(key).replace(/[^A-Za-z0-9_-]/g, '');
  const dir = ROOT + '/' + folder + '/' + sub;
  const client = await connect();
  try {
    const home = await client.pwd();
    await client.ensureDir(dir);
    await client.cd(home);
    const taken = new Set((await client.list(dir)).map((e) => e.name.toLowerCase()));
    for (const r of opts.reserved || []) taken.add(r.toLowerCase());

    const dot = fileName.lastIndexOf('.');
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : '';
    let finalName = fileName;
    for (let n = 2; taken.has(finalName.toLowerCase()); n++) finalName = stem + ' ' + n + ext;

    const tmp = dir + '/.bkb-upload-' + safeKey + '.part';
    await client.uploadFrom(stream, tmp);

    // Check again right before the rename in case something arrived meanwhile.
    const now = new Set((await client.list(dir)).map((e) => e.name.toLowerCase()));
    for (let n = 2; now.has(finalName.toLowerCase()); n++) finalName = stem + ' ' + n + ext;
    await client.rename(tmp, dir + '/' + finalName);
    opts.reserved?.add(finalName);
    return finalName;
  } finally {
    client.close();
  }
}

/** Read only. Names in ROOT/<folder>/<sub>/, or [] if it does not exist. */
export async function listNames(folder: string, sub?: string): Promise<string[]> {
  const client = await connect();
  try {
    const path = ROOT + '/' + folder + (sub ? '/' + sub : '');
    try {
      return (await client.list(path)).map((e) => e.name);
    } catch {
      return [];
    }
  } finally {
    client.close();
  }
}
