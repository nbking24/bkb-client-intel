import { NextResponse } from 'next/server';
import { getActiveJobs } from '../../../../lib/jobtread';

export const dynamic = 'force-dynamic';

/** Active jobs list for the Trade Specs job picker. */
export async function GET() {
  try {
    const jobs = await getActiveJobs(500);
    return NextResponse.json({
      // getActiveJobs flattens location.account.name to clientName on the
      // returned object — reading j.location.account.name here gave undefined
      // for every job, which made the picker show "No client" everywhere.
      jobs: jobs.map((j: any) => ({
        id: j.id,
        name: j.name,
        number: j.number || '',
        account: j.clientName || '',
      })),
    });
  } catch (err: any) {
    console.error('Trade specs jobs API error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load jobs' }, { status: 500 });
  }
}
