// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { searchContacts } from '@/app/lib/ghl';

/**
 * GET /api/dashboard/search-contacts?q=...
 *
 * Searches GHL contacts by phone, email, or name.
 * Used by the new-lead form to detect duplicates before creation.
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q')?.trim();
    if (!q || q.length < 2) {
      return NextResponse.json({ contacts: [] });
    }

    const contacts = await searchContacts(q, 10);
    return NextResponse.json({ contacts });
  } catch (err: any) {
    console.error('[search-contacts] Error:', err);
    return NextResponse.json({ error: err.message || 'Search failed' }, { status: 500 });
  }
}
