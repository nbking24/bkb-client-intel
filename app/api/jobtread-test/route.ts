import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { testConnection } from '../lib/jobtread';

export async function GET(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await testConnection();
  return NextResponse.json(result);
}
