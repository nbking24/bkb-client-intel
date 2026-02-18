// @ts-nocheck
// Diagnostic endpoint - accepts ?key= param to test any API key
import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';

export async function GET(req: NextRequest) {
          const url = new URL(req.url);
          const overrideKey = url.searchParams.get('key');
          const envKey = process.env.JOBTREAD_API_KEY || '';
          const apiKey = overrideKey || envKey;
          const keySource = overrideKey ? 'QUERY_PARAM' : 'ENV_VAR';

  const diagnostics: Record<string, unknown> = {
              keySource,
              keyInfo: apiKey ? `${apiKey.length} chars, starts: ${apiKey.slice(0, 6)}...` : 'MISSING',
              envKeyInfo: envKey ? `${envKey.length} chars, starts: ${envKey.slice(0, 6)}...` : 'MISSING',
              timestamp: new Date().toISOString(),
  };

  // Test: grantKey in body $
  try {
              const body = {
                            $: { grantKey: apiKey },
                            jobs: {
                                            $: { first: 1 },
                                            nodes: { id: {}, name: {} },
                            },
              };
              const res = await fetch(JT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
              });
              const text = await res.text();
              diagnostics.grantKeyInBody = { status: res.status, response: text.slice(0, 400) };
  } catch (e: any) {
              diagnostics.grantKeyInBody = { error: e.message };
  }

  // Test: createTask if jobs succeeded
  if ((diagnostics.grantKeyInBody as any)?.status === 200) {
              try {
                            const body = {
                                            $: { grantKey: apiKey },
                                            createTask: {
                                                              $: {
                                                                                  targetId: '22PEn8bysN7v',
                                                                                  targetType: 'job',
                                                                                  name: 'Key Test ' + Date.now(),
                                                              },
                                                              createdTask: { id: {}, name: {} },
                                            },
                            };
                            const res = await fetch(JT_URL, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(body),
                            });
                            const text = await res.text();
                            diagnostics.createTask = { status: res.status, response: text.slice(0, 400) };
              } catch (e: any) {
                            diagnostics.createTask = { error: e.message };
              }
  }

  return NextResponse.json(diagnostics, {
              headers: { 'Cache-Control': 'no-store' },
  });
}
