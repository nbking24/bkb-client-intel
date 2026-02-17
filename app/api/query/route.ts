import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateAuth } from '../lib/auth';
import { getContactNotes, searchConversations, getConversationMessages, getContactTasks } from '../lib/ghl';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { contactId, contactName, question } = await req.json();
    if (!contactId || !question) {
      return NextResponse.json({ error: 'Missing contactId or question' }, { status: 400 });
    }
    const [notes, conversations, tasks] = await Promise.allSettled([
      getContactNotes(contactId),
      searchConversations(contactId),
      getContactTasks(contactId),
    ]);
    const noteData = notes.status === 'fulfilled' ? notes.value : [];
    const convData = conversations.status === 'fulfilled' ? conversations.value : [];
    const taskData = tasks.status === 'fulfilled' ? tasks.value : [];
    let messagesText = '';
    if (Array.isArray(convData)) {
      const convSlice = convData.slice(0, 3);
      for (const conv of convSlice) {
        try {
          const cid = (conv as Record<string, string>).id;
          const msgs = await getConversationMessages(cid, 20);
          if (Array.isArray(msgs)) {
            messagesText += msgs.map((m: Record<string, string>) =>
              '[' + (m.direction || 'unknown') + '] ' + (m.body || '').slice(0, 500)
            ).join('\n');
          }
        } catch { /* skip */ }
      }
    }
    const context =
      '=== NOTES ===\n' + JSON.stringify(noteData, null, 2).slice(0, 20000) +
      '\n\n=== MESSAGES ===\n' + messagesText.slice(0, 15000) +
      '\n\n=== TASKS ===\n' + JSON.stringify(taskData, null, 2).slice(0, 5000);
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: 'You are an AI assistant for Brett King Builder, a high-end residential renovation company. Answer questions about clients based on their CRM data. Be specific and reference actual data from the notes and messages.',
      messages: [{
        role: 'user',
        content: 'Client: ' + (contactName || 'Unknown') + '\n\nQuestion: ' + question + '\n\nClient Data:\n' + context,
      }],
    });
    const reply = message.content[0].type === 'text' ? message.content[0].text : '';
    return NextResponse.json({ reply });
  } catch (err) {
    console.error('Query error:', err);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
}
