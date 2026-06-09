// GET /api/me
//
// Returns the authenticated user's profile + resolved access (dashboards,
// features, overview widgets). The dashboard layout calls this to build the
// nav and gate widgets/features per user. Reads only.
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getEffectiveAccess } from '@/app/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getEffectiveAccess(auth.userId);
  if (!access) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if (!access.enabled) {
    return NextResponse.json({ error: 'Account disabled' }, { status: 403 });
  }

  return NextResponse.json({
    id: access.id,
    name: access.name,
    initials: access.initials,
    title: access.title,
    role: access.role,
    membershipId: access.jtMembershipId,
    email: access.email,
    signature: access.signature,
    dashboards: access.effectiveDashboards,
    features: access.features,
    overviewWidgets: access.overviewWidgets,
  });
}
