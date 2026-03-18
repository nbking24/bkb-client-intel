// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { listConversations, createConversation } from '../lib/supabase';

// GET /api/conversations — list recent conversations
export async function GET(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization')).valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const conversations = await listConversations(50);
    return NextResponse.json({ conversations });
  } catch (err) {
    console.error('List conversations error:', err);
    return NextResponse.json({ error: 'Failed to list conversations' }, { status: 500 });
  }
}

// POST /api/conversations — create a new conversation
export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization')).valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const conv = await createConversation(
      body.title || 'New conversation',
      body.jtJobId,
      body.jtJobName
    );
    return NextResponse.json({ conversation: conv });
  } catch (err) {
    console.error('Create conversation error:', err);
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
  }
}
