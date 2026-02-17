import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { pin } = await req.json();
    if (!pin || pin !== process.env.APP_PIN) {
      return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
    }
    const token = Buffer.from(pin + ':' + Date.now()).toString('base64');
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: 'Auth failed' }, { status: 500 });
  }
}
