// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/ftp/reorg
 * Body: { folder?: "<exact folder name>", jobId?: "<JobTread job id>",
 *         all?: true, dryRun?: boolean }
 *
 * Marketing pipeline Step 2: one time reorganization of Mike's FTP. dryRun
 * defaults to TRUE: only an explicit dryRun: false changes anything. Creates
 * missing subfolders, moves loose files into them, then renames the folder.
 * Never deletes anything. Every real action is logged to marketing_photo_runs.
 *
 * Owner only.
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '@/app/api/lib/auth';
import { isConfigured } from '@/app/api/lib/ftp';
import { runReorg } from '@/app/api/lib/marketing/ftp-reorg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isConfigured()) return NextResponse.json({ error: 'The FTP connection is not set up in the Hub environment.' });

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;

  try {
    const result = await runReorg({
      folder: body.folder ? String(body.folder) : undefined,
      jobId: body.jobId ? String(body.jobId) : undefined,
      all: body.all === true,
      dryRun,
      userId: auth.userId || null,
      // Leave room under the 300 second limit to finish the folder in hand.
      deadlineMs: 200000,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Reorg failed' }, { status: 200 });
  }
}
