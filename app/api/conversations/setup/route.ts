// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../../lib/auth';
import { getSupabase } from '../../lib/supabase';

// POST /api/conversations/setup — create the chat_conversations tables
export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();

  try {
    // Create chat_conversations table
    const { error: err1 } = await sb.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS chat_conversations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          title TEXT NOT NULL DEFAULT 'New conversation',
          jt_job_id TEXT,
          jt_job_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `
    });

    // Create chat_messages table
    const { error: err2 } = await sb.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          agent_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `
    });

    // Create index for fast message lookup
    const { error: err3 } = await sb.rpc('exec_sql', {
      sql: `
        CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_id ON chat_messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations(updated_at DESC);
      `
    });

    const errors = [err1, err2, err3].filter(Boolean);
    if (errors.length > 0) {
      return NextResponse.json({
        warning: 'Some operations had issues. Tables may already exist or exec_sql RPC not available. Try creating tables manually in Supabase dashboard.',
        errors: errors.map(e => e.message),
        manual_sql: MANUAL_SQL,
      }, { status: 207 });
    }

    return NextResponse.json({ success: true, message: 'Chat conversation tables created' });
  } catch (err) {
    return NextResponse.json({
      error: 'Setup failed. You may need to create the tables manually in the Supabase SQL editor.',
      manual_sql: MANUAL_SQL,
      detail: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}

const MANUAL_SQL = `
-- Run this in the Supabase SQL Editor if auto-setup fails:

CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'New conversation',
  jt_job_id TEXT,
  jt_job_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  agent_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_id ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations(updated_at DESC);
`;

// GET — return the SQL for manual setup
export async function GET(req: NextRequest) {
  return NextResponse.json({ sql: MANUAL_SQL.trim() });
}
