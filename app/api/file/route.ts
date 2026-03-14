import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';

/**
 * File redirect endpoint — resolves a JobTread file ID to its CDN URL and redirects.
 *
 * Usage: GET /api/file?id=22PR87FSiVp9
 *
 * This avoids the AI having to reproduce long, complex CDN URLs in its responses.
 * Instead, the AI only needs to include a short file ID, and this endpoint handles
 * the CDN URL lookup and redirect.
 */
export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get('id');

  if (!fileId) {
    return NextResponse.json({ error: 'Missing file id parameter' }, { status: 400 });
  }

  try {
    // Look up the file URL via PAVE
    const body = {
      query: {
        $: { grantKey: JT_KEY() },
        file: {
          $: { id: fileId },
          id: {},
          name: {},
          url: {},
        },
      },
    };

    const res = await fetch(JT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to look up file' }, { status: 502 });
    }

    const data = await res.json();
    const fileUrl = data?.file?.url;

    if (!fileUrl) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Redirect to the actual CDN URL
    return NextResponse.redirect(fileUrl, 302);
  } catch (err) {
    console.error('File redirect error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
