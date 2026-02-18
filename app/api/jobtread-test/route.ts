// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { getActiveJobs, createTask } from '../lib/jobtread';

export async function GET(req: NextRequest) {
    if (!validateAuth(req.headers.get('authorization'))) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

  try {
        const jobs = await getActiveJobs(5);
        return NextResponse.json({
                success: true,
                message: 'JobTread Pave API connection OK',
                activeJobs: jobs,
        });
  } catch (err) {
        return NextResponse.json({
                success: false,
                error: err instanceof Error ? err.message : 'Connection test failed',
        }, { status: 500 });
  }
}
