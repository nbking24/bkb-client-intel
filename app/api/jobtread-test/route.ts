// @ts-nocheck
// Diagnostic: test different body formats for Pave API
import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';

export async function GET(req: NextRequest) {
            const url = new URL(req.url);
            const apiKey = url.searchParams.get('key') || process.env.JOBTREAD_API_KEY || '';

  const query = { $: { grantKey: apiKey }, jobs: { $: { first: 1 }, nodes: { id: {}, name: {} } } };
            const diagnostics: Record<string, unknown> = { timestamp: new Date().toISOString() };

  // Format 1: JSON body with application/json
  try {
                const r = await fetch(JT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
                diagnostics.json_body = { status: r.status, body: (await r.text()).slice(0, 300) };
  } catch (e: any) { diagnostics.json_body = { error: e.message }; }

  // Format 2: form-encoded with query= param
  try {
                const r = await fetch(JT_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(JSON.stringify(query)) });
                diagnostics.form_query = { status: r.status, body: (await r.text()).slice(0, 300) };
  } catch (e: any) { diagnostics.form_query = { error: e.message }; }

  // Format 3: query as YAML text
  const yaml = `$:\n  grantKey: "${apiKey}"\njobs:\n  $:\n    first: 1\n  nodes:\n    id: {}\n    name: {}`;
            try {
                          const r = await fetch(JT_URL, { method: 'POST', headers: { 'Content-Type': 'text/yaml' }, body: yaml });
                          diagnostics.yaml_body = { status: r.status, body: (await r.text()).slice(0, 300) };
            } catch (e: any) { diagnostics.yaml_body = { error: e.message }; }

  // Format 4: JSON body with text/plain content type
  try {
                const r = await fetch(JT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(query) });
                diagnostics.text_plain = { status: r.status, body: (await r.text()).slice(0, 300) };
  } catch (e: any) { diagnostics.text_plain = { error: e.message }; }

  // Format 5: JSON wrapped in { query: ... }
  try {
                const r = await fetch(JT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
                diagnostics.wrapped_query = { status: r.status, body: (await r.text()).slice(0, 300) };
  } catch (e: any) { diagnostics.wrapped_query = { error: e.message }; }

  return NextResponse.json(diagnostics, { headers: { 'Cache-Control': 'no-store' } });
}
