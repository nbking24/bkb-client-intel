// @ts-nocheck
/**
 * POST /api/dashboard/link-job
 *
 * Link a GHL opportunity to a JobTread job by writing the JT Job ID
 * into the GHL opportunity's custom field.
 *
 * Body: { ghlOpportunityId: string, jtJobId: string }
 */

import { NextRequest, NextResponse } from 'next/server';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_CF_JT_JOB_ID = 'GjwWvbGyh7CQfGmFir5p';

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

export async function POST(req: NextRequest) {
  try {
    const { ghlOpportunityId, jtJobId } = await req.json();

    if (!ghlOpportunityId || !jtJobId) {
      return NextResponse.json(
        { error: 'Both ghlOpportunityId and jtJobId are required' },
        { status: 400 }
      );
    }

    if (!process.env.GHL_API_KEY) {
      return NextResponse.json(
        { error: 'GHL_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Write the JT Job ID to the GHL opportunity custom field
    const res = await fetch(`${GHL_BASE}/opportunities/${ghlOpportunityId}`, {
      method: 'PUT',
      headers: ghlHeaders(),
      body: JSON.stringify({
        customFields: [
          { id: GHL_CF_JT_JOB_ID, value: jtJobId },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `GHL update failed (${res.status}): ${errText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    return NextResponse.json({
      success: true,
      ghlOpportunityId,
      jtJobId,
      ghlResponse: {
        name: data.opportunity?.name || data.name || '',
        status: data.opportunity?.status || data.status || '',
      },
    });
  } catch (err: any) {
    console.error('[link-job] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to link job' },
      { status: 500 }
    );
  }
}
