import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';

export async function POST(request: NextRequest) {
  const key = process.env.JOBTREAD_API_KEY;
  if (!key) return NextResponse.json({ error: 'No API key' }, { status: 500 });

  const { query } = await request.json();
  const body = {
    query: {
      $: { grantKey: key },
      ...query,
    },
  };

  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data);
}
