// @ts-nocheck
// Diagnostic endpoint - NO AUTH - temporary for debugging
import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';

export async function GET(req: NextRequest) {
      const apiKey = process.env.JOBTREAD_API_KEY || '';
      const keyInfo = apiKey ? `SET (${apiKey.length} chars, starts with ${apiKey.slice(0, 4)}...)` : 'MISSING';

  // Test 1: Check if API key exists
  const diagnostics: Record<string, unknown> = {
          apiKeyStatus: keyInfo,
          timestamp: new Date().toISOString(),
  };

  // Test 2: Try getActiveJobs
  try {
          const jobsBody = {
                    $: { grantKey: apiKey },
                    jobs: {
                                $: { first: 3, where: { closedOn: { eq: null } }, orderBy: { createdAt: 'DESC' } },
                                nodes: { id: {}, name: {} },
                    },
          };
          const jobsRes = await fetch(JT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(jobsBody),
          });
          const jobsText = await jobsRes.text();
          diagnostics.getActiveJobs = {
                    status: jobsRes.status,
                    response: jobsText.slice(0, 500),
          };
  } catch (e: any) {
          diagnostics.getActiveJobs = { error: e.message };
  }

  // Test 3: Try createTask with known job ID
  try {
          const taskBody = {
                    $: { grantKey: apiKey },
                    createTask: {
                                $: {
                                              targetId: '22PEn8bysN7v',
                                              targetType: 'job',
                                              name: 'Vercel Diagnostic Test ' + Date.now(),
                                },
                                createdTask: {
                                              id: {},
                                              name: {},
                                },
                    },
          };
          const taskRes = await fetch(JT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskBody),
          });
          const taskText = await taskRes.text();
          diagnostics.createTask = {
                    status: taskRes.status,
                    response: taskText.slice(0, 500),
          };
  } catch (e: any) {
          diagnostics.createTask = { error: e.message };
  }

  return NextResponse.json(diagnostics);
}
