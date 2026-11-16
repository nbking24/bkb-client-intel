// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/profile
 * Body: { jobId, mode?: "preview" | "publish" }
 *
 * Marketing pipeline Step 4. mode defaults to "preview": the profile is built
 * and emailed to Nathan, and nothing goes to Mike's FTP. Only an explicit
 * mode "publish" backs up and replaces the profile on the FTP.
 *
 * Owner only.
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '@/app/api/lib/auth';
import { isConfigured } from '@/app/api/lib/ftp';
import { runProfile } from '@/app/api/lib/marketing/profile/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isConfigured()) return NextResponse.json({ error: 'The FTP connection is not set up in the Hub environment.' });

  const body = await req.json().catch(() => ({}));
  if (!body.jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  const mode = body.mode === 'publish' ? 'publish' : 'preview';

  try {
    return NextResponse.json(await runProfile({ jobId: String(body.jobId), mode }));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Profile build failed' });
  }
}
