// @ts-nocheck
/**
 * POST /api/raffle/delete-spam-pipeline
 *
 * One-off: delete the 5 spam/vendor opportunities and their contacts
 * from Loop that were sitting in New Inquiry stage.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GHL_BASE = 'https://services.leadconnectorhq.com';

const TARGETS = [
  { name: 'Jennifer Wesley', opp: '4UbnnnjV96hVo20HmLER', contact: 'kOM18ci60CfDdT1zrCAv' },
  { name: 'Emma Thomas',     opp: '0ZyfpyATBa2EwHFipDQX', contact: 'dZQd8qLK5wlGxEDYSbO5' },
  { name: 'Leo Samuel',      opp: '4bi6gLHJrUAWcZRLhOYb', contact: 'QLS9unZeQ0VY1LNxSWPh' },
  { name: 'Chris Thomas',    opp: '9DX3isJ66IxmnbIRryKR', contact: 'VTeOm6XelkyeJpyTqg7T' },
  { name: 'Dan Jacques',     opp: 'QCuQ42gU6JGq9rFMlKuo', contact: 'IE4sfpMDD8qrB734a74s' },
];

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    Version: '2021-07-28',
  };
}

async function del(url: string) {
  try {
    const r = await fetch(url, { method: 'DELETE', headers: headers() });
    const t = await r.text();
    return { ok: r.ok, status: r.status, body: t.slice(0, 200) };
  } catch (e: any) {
    return { ok: false, status: 0, body: e?.message };
  }
}

export async function POST(_req: NextRequest) {
  const results: any[] = [];
  for (const t of TARGETS) {
    const oppRes = await del(`${GHL_BASE}/opportunities/${t.opp}`);
    const conRes = await del(`${GHL_BASE}/contacts/${t.contact}`);
    results.push({ name: t.name, opp: oppRes, contact: conRes });
  }
  return NextResponse.json({ ok: true, results });
}
