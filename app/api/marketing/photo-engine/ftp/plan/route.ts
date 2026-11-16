// @ts-nocheck
/**
 * GET /api/marketing/photo-engine/ftp/plan
 *
 * Marketing pipeline Step 1: FTP inventory and reorg plan. READ ONLY. Lists
 * every job folder on Mike's FTP, matches it to its JobTread job, reads the
 * job Status, and returns the renames, file moves and missing subfolders the
 * one time reorganization would apply. Nothing on the FTP is changed.
 *
 * Owner only (signed in owner, or the marketing agent token).
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '@/app/api/lib/auth';
import { isConfigured } from '@/app/api/lib/ftp';
import { buildReorgPlan } from '@/app/api/lib/marketing/ftp-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!isConfigured()) {
    return NextResponse.json({ configured: false, error: 'The FTP connection is not set up in the Hub environment.' });
  }

  try {
    const plan = await buildReorgPlan();
    return NextResponse.json({ configured: true, ...plan });
  } catch (err: any) {
    return NextResponse.json(
      { configured: true, error: 'Could not build the plan: ' + (err?.message || 'unknown error') },
      { status: 200 }
    );
  }
}
