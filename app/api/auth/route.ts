import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { pin, userId } = await req.json();
    if (!pin || pin !== process.env.APP_PIN) {
      return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
    }
    // Token format: pin:userId:timestamp (userId included for user identity tracking)
    // If no userId provided (backward compat), token is pin:timestamp
    const tokenPayload = userId
      ? `${pin}:${userId}:${Date.now()}`
      : `${pin}:${Date.now()}`;
    const token = Buffer.from(tokenPayload).toString('base64');
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: 'Auth failed' }, { status: 500 });
  }
}
