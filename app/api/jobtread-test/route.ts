// @ts-nocheck
// Diagnostic: verify Pave API with {query:...} wrapper
import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';

export async function GET(req: NextRequest) {
              const url = new URL(req.url);
              const apiKey = url.searchParams.get('key') || process.env.JOBTREAD_API_KEY || '';
              const diagnostics: Record<string, unknown> = { timestamp: new Date().toISOString() };

  // Test 1: Get active jobs using {query:...} wrapper
  const jobsQuery = {
                  $: { grantKey: apiKey },
                  jobs: {
                                    $: { first: 2, where: { closedOn: { eq: null } }, orderBy: { createdAt: 'DESC' } },
                                    nodes: { id: {}, name: {} },
                  },
  };
              try {
                              const r = await fetch(JT_URL, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ query: jobsQuery }),
                              });
                              const text = await r.text();
                              diagnostics.getJobs = { status: r.status, body: text.slice(0, 500) };
              } catch (e: any) { diagnostics.getJobs = { error: e.message }; }

  // Test 2: Create a test task on Wooley job (22PEn8bysN7v)
  const createQuery = {
                  $: { grantKey: apiKey },
                  createTask: {
                                    $: { targetId: '22PEn8bysN7v', targetType: 'job', name: 'API Test - delete me' },
                                    createdTask: { id: {}, name: {} },
                  },
  };
              try {
                              const r = await fetch(JT_URL, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ query: createQuery }),
                              });
                              const text = await r.text();
                              diagnostics.createTask = { status: r.status, body: text.slice(0, 500) };
              } catch (e: any) { diagnostics.createTask = { error: e.message }; }

  return NextResponse.json(diagnostics, { headers: { 'Cache-Control': 'no-store' } });
}
