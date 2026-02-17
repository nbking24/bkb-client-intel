import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { searchContacts } from '../lib/ghl';

export async function GET(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const q = req.nextUrl.searchParams.get('q') || '';
  if (q.length < 2) return NextResponse.json({ contacts: [] });
  try {
    const contacts = await searchContacts(q);
    return NextResponse.json({ contacts });
  } catch (err) {
    console.error('Contacts search error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
