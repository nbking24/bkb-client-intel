// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../../lib/auth';
import { getConversationWithMessages, addConversationMessage, deleteConversation } from '../../lib/supabase';

// GET /api/conversations/[id] — get conversation with all messages
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const data = await getConversationWithMessages(id);
    return NextResponse.json(data);
  } catch (err) {
    console.error('Get conversation error:', err);
    return NextResponse.json({ error: 'Failed to get conversation' }, { status: 500 });
  }
}

// POST /api/conversations/[id] — add a message to a conversation
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const body = await req.json();
    await addConversationMessage(id, body.role, body.content, body.agentName);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Add message error:', err);
    return NextResponse.json({ error: 'Failed to add message' }, { status: 500 });
  }
}

// DELETE /api/conversations/[id] — delete a conversation
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await params;
    await deleteConversation(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete conversation error:', err);
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
}
