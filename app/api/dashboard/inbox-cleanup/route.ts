import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * POST /api/dashboard/inbox-cleanup
 *
 * DISABLED 2026-04-24 — this endpoint previously classified inbox
 * emails and (in 'execute' mode) archived them into the "BKB Cleanup"
 * label. Nathan reported losing emails, so the handler now
 * short-circuits and will not move any emails.
 *
 * To re-enable, restore the original implementation from git history
 * (commit before a791dbf).
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json({
    disabled: true,
    message: 'inbox-cleanup is disabled — no emails will be moved',
    total: 0,
    toArchive: [],
    toKeep: [],
    archiveResult: null,
  });
}
