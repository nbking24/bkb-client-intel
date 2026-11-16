// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/ftp/folder-override
 * Body: { folder, keepName: true, label?: "Completed", note? }  to mark
 *       { folder, keepName: false }                              to clear
 *
 * Marks a folder on Mike's FTP as "no JobTread job, keep name" so the plan,
 * the reorg and later runs skip the job match and status check and never
 * rename it. Only changes the Hub's own record; nothing on the FTP changes.
 *
 * Owner only.
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '@/app/api/lib/auth';
import { setFolderOverride } from '@/app/api/lib/marketing/folder-overrides';

export const runtime = 'nodejs';

const LABELS = ['In Design', 'In Progress', 'Completed'];

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const folder = String(body.folder || '').trim();
  if (!folder || folder.includes('/') || folder.includes('\0')) {
    return NextResponse.json({ error: 'A top level folder name is required' }, { status: 400 });
  }
  const raw = body.label == null ? '' : String(body.label).trim();
  const label = raw ? LABELS.find((l) => l.toLowerCase() === raw.toLowerCase()) || raw : null;
  if (label && !LABELS.includes(label)) {
    return NextResponse.json({ error: 'Label must be one of ' + LABELS.join(', ') }, { status: 400 });
  }

  try {
    const folders = await setFolderOverride(
      folder,
      body.keepName === false
        ? null
        : { mode: 'no_job_keep_name', label, note: body.note ? String(body.note).slice(0, 500) : null, setBy: auth.userId || null }
    );
    return NextResponse.json({ ok: true, folder, override: folders[folder] || null });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not save' }, { status: 500 });
  }
}
