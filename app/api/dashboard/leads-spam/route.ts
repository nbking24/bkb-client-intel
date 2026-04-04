// @ts-nocheck
/**
 * POST /api/dashboard/leads-spam
 *
 * Marks a lead as spam by deleting the GHL opportunity and contact.
 * Body: { opportunityId: string, contactId: string }
 */

import { NextRequest, NextResponse } from 'next/server';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = () => process.env.GHL_API_KEY || '';

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_KEY()}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

export async function POST(req: NextRequest) {
  try {
    const { opportunityId, contactId } = await req.json();

    if (!opportunityId) {
      return NextResponse.json({ error: 'opportunityId is required' }, { status: 400 });
    }

    const log: string[] = [];

    // 1. Delete the GHL opportunity
    try {
      const oppRes = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
        method: 'DELETE',
        headers: ghlHeaders(),
      });
      if (oppRes.ok) {
        log.push(`Deleted opportunity ${opportunityId}`);
      } else {
        const errText = await oppRes.text();
        log.push(`Failed to delete opportunity (${oppRes.status}): ${errText.slice(0, 200)}`);
      }
    } catch (e: any) {
      log.push(`Error deleting opportunity: ${e.message}`);
    }

    // 2. Delete the GHL contact (if provided)
    if (contactId) {
      try {
        const ctRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
          method: 'DELETE',
          headers: ghlHeaders(),
        });
        if (ctRes.ok) {
          log.push(`Deleted contact ${contactId}`);
        } else {
          const errText = await ctRes.text();
          log.push(`Failed to delete contact (${ctRes.status}): ${errText.slice(0, 200)}`);
        }
      } catch (e: any) {
        log.push(`Error deleting contact: ${e.message}`);
      }
    }

    return NextResponse.json({ success: true, log });
  } catch (err: any) {
    console.error('[leads-spam] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to process spam' }, { status: 500 });
  }
}
