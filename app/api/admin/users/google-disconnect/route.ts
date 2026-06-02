// POST /api/admin/users/google-disconnect   — OWNER ONLY
//   body: { userId: string }
//
// Clears the stored Google OAuth refresh token + linked email for that user,
// and invalidates the in-memory access-token cache so the next Google API
// call doesn't keep using the old account.
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { clearUserGoogleLink, getAppUser, isOwner } from '@/app/lib/access';
import { clearGoogleTokenCache } from '@/app/lib/google-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isOwner(auth.userId))) {
    return NextResponse.json({ error: 'Forbidden — owner only' }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const userId = (body.userId || '').trim();
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  if (!(await getAppUser(userId))) {
    return NextResponse.json({ error: 'Unknown user' }, { status: 404 });
  }

  await clearUserGoogleLink(userId);
  clearGoogleTokenCache(userId);
  return NextResponse.json({ success: true });
}
