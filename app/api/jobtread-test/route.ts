// @ts-nocheck
// Diagnostic endpoint - tests multiple auth methods against Pave API
import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';

export async function GET(req: NextRequest) {
        const apiKey = process.env.JOBTREAD_API_KEY || '';
        const keyInfo = apiKey ? `SET (${apiKey.length} chars, starts with ${apiKey.slice(0, 4)}...)` : 'MISSING';

  const diagnostics: Record<string, unknown> = {
            apiKeyStatus: keyInfo,
            timestamp: new Date().toISOString(),
  };

  const simpleQuery = {
            jobs: {
                        $: { first: 1 },
                        nodes: { id: {}, name: {} },
            },
  };

  // Method 1: grantKey in body $ (current approach)
  try {
            const body1 = { $: { grantKey: apiKey }, ...simpleQuery };
            const res1 = await fetch(JT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body1),
            });
            const text1 = await res1.text();
            diagnostics.method1_grantKeyInBody = { status: res1.status, response: text1.slice(0, 300) };
  } catch (e: any) {
            diagnostics.method1_grantKeyInBody = { error: e.message };
  }

  // Method 2: Bearer token in Authorization header
  try {
            const res2 = await fetch(JT_URL, {
                        method: 'POST',
                        headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify(simpleQuery),
            });
            const text2 = await res2.text();
            diagnostics.method2_bearerHeader = { status: res2.status, response: text2.slice(0, 300) };
  } catch (e: any) {
            diagnostics.method2_bearerHeader = { error: e.message };
  }

  // Method 3: grantKey as query param
  try {
            const res3 = await fetch(`${JT_URL}?grantKey=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(simpleQuery),
            });
            const text3 = await res3.text();
            diagnostics.method3_grantKeyQueryParam = { status: res3.status, response: text3.slice(0, 300) };
  } catch (e: any) {
            diagnostics.method3_grantKeyQueryParam = { error: e.message };
  }

  // Method 4: send body as string to check serialization
  try {
            const bodyStr = JSON.stringify({ $: { grantKey: apiKey }, ...simpleQuery });
            diagnostics.method4_bodyPreview = bodyStr.slice(0, 300);
  } catch (e: any) {
            diagnostics.method4_bodyPreview = { error: e.message };
  }

  return NextResponse.json(diagnostics, {
            headers: { 'Cache-Control': 'no-store' },
  });
}
