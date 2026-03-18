// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';

const GHL_BASE = 'https://services.leadconnectorhq.com';

function headers() {
  return {
    Authorization: 'Bearer ' + (process.env.GHL_API_KEY || ''),
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

export async function GET(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization')).valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const testContactId = req.nextUrl.searchParams.get('contactId') || '';
  const locationId = process.env.GHL_LOCATION_ID || '';

  const results: Record<string, any> = {
    timestamp: new Date().toISOString(),
    envCheck: {
      GHL_API_KEY: process.env.GHL_API_KEY ? 'SET (' + process.env.GHL_API_KEY.slice(0, 8) + '...)' : 'MISSING',
      GHL_LOCATION_ID: locationId ? 'SET (' + locationId + ')' : 'MISSING',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING',
      JOBTREAD_API_KEY: process.env.JOBTREAD_API_KEY ? 'SET' : 'MISSING',
    },
  };

  // Test 1: Contact lookup
  if (testContactId) {
    try {
      const res = await fetch(GHL_BASE + '/contacts/' + testContactId, { headers: headers() });
      const body = await res.text();
      results.contactLookup = {
        status: res.status,
        ok: res.ok,
        bodyPreview: body.slice(0, 300),
      };
    } catch (err) {
      results.contactLookup = { error: err instanceof Error ? err.message : 'Failed' };
    }
  }

  // Test 2: Conversations search
  if (testContactId && locationId) {
    try {
      const url = GHL_BASE + '/conversations/search?locationId=' + locationId + '&contactId=' + testContactId;
      const res = await fetch(url, { headers: headers() });
      const body = await res.text();
      results.conversationSearch = {
        status: res.status,
        ok: res.ok,
        bodyPreview: body.slice(0, 500),
      };
    } catch (err) {
      results.conversationSearch = { error: err instanceof Error ? err.message : 'Failed' };
    }
  }

  // Test 3: Contact notes
  if (testContactId) {
    try {
      const res = await fetch(GHL_BASE + '/contacts/' + testContactId + '/notes', { headers: headers() });
      const body = await res.text();
      results.contactNotes = {
        status: res.status,
        ok: res.ok,
        bodyPreview: body.slice(0, 300),
      };
    } catch (err) {
      results.contactNotes = { error: err instanceof Error ? err.message : 'Failed' };
    }
  }

  // Test 4: Contact tasks
  if (testContactId) {
    try {
      const res = await fetch(GHL_BASE + '/contacts/' + testContactId + '/tasks', { headers: headers() });
      const body = await res.text();
      results.contactTasks = {
        status: res.status,
        ok: res.ok,
        bodyPreview: body.slice(0, 300),
      };
    } catch (err) {
      results.contactTasks = { error: err instanceof Error ? err.message : 'Failed' };
    }
  }

  // Test 5: Pipelines (general GHL connectivity test)
  try {
    const res = await fetch(GHL_BASE + '/opportunities/pipelines?locationId=' + locationId, { headers: headers() });
    const body = await res.text();
    results.pipelines = {
      status: res.status,
      ok: res.ok,
      bodyPreview: body.slice(0, 300),
    };
  } catch (err) {
    results.pipelines = { error: err instanceof Error ? err.message : 'Failed' };
  }

  return NextResponse.json(results, { status: 200 });
}
