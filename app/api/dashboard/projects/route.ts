import { NextRequest, NextResponse } from 'next/server';
import { getActiveJobs } from '@/app/lib/jobtread';

// GET /api/dashboard/projects - Returns active jobs with pre-con phase data
export async function GET(req: NextRequest) {
  try {
    const jobs = await getActiveJobs(50);

    // For now, return JT jobs directly. Once Supabase is connected,
    // this will join with precon_phases to get phase status per project.
    // TODO: Join with Supabase precon_phases table
    const projects = jobs.map((job: any) => ({
      id: job.id,
      name: job.name,
      number: job.number,
      status: job.status,
      clientName: job.clientName || '',
      createdAt: job.createdAt,
      // Placeholder phase data until Supabase is connected
      phases: Array.from({ length: 9 }, (_, i) => ({
        phaseNumber: i + 1,
        status: 'not_started' as const,
        targetDate: null,
      })),
    }));

    return NextResponse.json({ projects, count: projects.length });
  } catch (err: any) {
    console.error('Dashboard projects error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
