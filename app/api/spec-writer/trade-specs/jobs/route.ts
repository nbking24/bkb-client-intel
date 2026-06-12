import { NextResponse } from 'next/server';
import { getActiveJobs } from '../../../../lib/jobtread';

export const dynamic = 'force-dynamic';

/** Active jobs list for the Trade Specs job picker. */
export async function GET() {
  try {
    const jobs = await getActiveJobs(500);
    return NextResponse.json({
      jobs: jobs.map((j: any) => ({
        id: j.id,
        name: j.name,
        number: j.number || '',
        account: j.location?.account?.name || '',
      })),
    });
  } catch (err: any) {
    console.error('Trade specs jobs API error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load jobs' }, { status: 500 });
  }
}
