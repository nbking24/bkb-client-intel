// ============================================================
// Search GHL contacts for trade partners
//
// GET ?q=search_term
// Returns: GHL contacts matching the search term
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { searchContacts } from '@/app/lib/ghl';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');

    if (!query) {
      return NextResponse.json(
        { error: 'q query parameter is required' },
        { status: 400 }
      );
    }

    const contacts = await searchContacts(query, 20);

    return NextResponse.json({
      success: true,
      contacts: contacts.map((c: any) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
      })),
    });
  } catch (err: any) {
    console.error('Failed to search contacts:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to search contacts' },
      { status: 500 }
    );
  }
}
