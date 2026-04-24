import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

/**
 * GET /api/cron/inbox-cleanup
 *
 * DISABLED 2026-04-24 — this endpoint previously used AI to classify
 * inbox emails and auto-archive junk into the "BKB Cleanup" label.
 * It was archiving emails Nathan wanted to keep. Cron entry has been
 * removed from vercel.json, and this handler now short-circuits so
 * no emails can be moved even if the route is hit manually.
 *
 * To re-enable, restore the original implementation from git history
 * (commit before a791dbf) and re-add the cron entry to vercel.json.
 */
export async function GET(_req: NextRequest) {
  return NextResponse.json({
    disabled: true,
    message: 'inbox-cleanup is disabled — no emails will be moved',
  });
}
