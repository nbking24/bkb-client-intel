// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateAuth } from '../lib/auth';
import { getContactNotes, searchConversations, getConversationMessages, getContactTasks } from '../lib/ghl';
import { getActiveJobs, getTeamMembers, getCustomers, getVendors } from '../lib/jobtread';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Detect what data we need based on the user message
function detectIntent(msg: string) {
  const lower = msg.toLowerCase();
  return {
    needsGHL: /note|message|conversation|history|communication|crm|email|sms|task|meeting|transcript|follow.?up|last.?contact|overview|summary/i.test(lower),
    needsJTJobs: /job|project|budget|cost|revenue|schedule|daily.?log|comment|jobtread|active.*job|profit|margin/i.test(lower),
    needsJTTeam: /team|member|assign|who.*work|staff|employee|crew/i.test(lower),
    needsJTCustomers: /customer|client.*list|all.*client|account/i.test(lower),
    needsJTVendors: /vendor|supplier|sub|trade.*partner/i.test(lower),
  };
}

async function fetchGHLData(contactId: string): Promise<string> {
  const sections: string[] = [];
  try {
    const [notes, convos, tasks] = await Promise.allSettled([
      getContactNotes(contactId),
      searchConversations(contactId),
      getContactTasks(contactId),
    ]);
    if (notes.status === 'fulfilled' && Array.isArray(notes.value) && notes.value.length > 0) {
      const noteTexts = notes.value.slice(0, 10).map((n: Record<string, string>) => {
        const date = n.dateAdded ? new Date(n.dateAdded).toLocaleDateString() : 'No date';
        return '[' + date + '] ' + (n.body || '').slice(0, 2000);
      });
      sections.push('=== CRM NOTES ===\n' + noteTexts.join('\n---\n'));
    }
    if (convos.status === 'fulfilled' && Array.isArray(convos.value)) {
      const msgs: string[] = [];
      for (const conv of convos.value.slice(0, 3)) {
        try {
          const cmsgs = await getConversationMessages((conv as Record<string, string>).id, 15);
          if (Array.isArray(cmsgs)) {
            for (const m of cmsgs) {
              const mr = m as Record<string, string>;
              msgs.push('[' + (mr.direction || '?') + ' ' + (mr.type || '') + '] ' + (mr.body || '').slice(0, 400));
            }
          }
        } catch { /* skip */ }
      }
      if (msgs.length > 0) sections.push('=== MESSAGES ===\n' + msgs.join('\n'));
    }
    if (tasks.status === 'fulfilled' && Array.isArray(tasks.value) && tasks.value.length > 0) {
      const taskTexts = tasks.value.map((t: Record<string, string>) =>
        '- [' + (t.completed ? 'DONE' : 'OPEN') + '] ' + (t.title || t.body || 'No title')
      );
      sections.push('=== TASKS ===\n' + taskTexts.join('\n'));
    }
  } catch (err) {
    sections.push('=== GHL ERROR ===\n' + (err instanceof Error ? err.message : 'Failed to fetch GHL data'));
  }
  return sections.join('\n\n');
}

async function fetchJTData(intent: ReturnType<typeof detectIntent>): Promise<string> {
  const sections: string[] = [];
  const fetches: Promise<void>[] = [];
  if (intent.needsJTJobs) {
    fetches.push(getActiveJobs(30).then(jobs => {
      if (Array.isArray(jobs) && jobs.length > 0) {
        const lines = jobs.map((j: Record<string, string>) =>
          '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' | Status: ' + (j.status || 'N/A')
        );
        sections.push('=== JOBTREAD ACTIVE JOBS ===\n' + lines.join('\n'));
      } else {
        sections.push('=== JOBTREAD JOBS ===\nNo active jobs found.');
      }
    }).catch(err => { sections.push('=== JT JOBS ERROR ===\n' + (err instanceof Error ? err.message : 'Failed')); }));
  }
  if (intent.needsJTTeam) {
    fetches.push(getTeamMembers().then(members => {
      if (Array.isArray(members) && members.length > 0) {
        const lines = members.map((m: Record<string, unknown>) => {
          const u = m.user as Record<string, string> | undefined;
          return '- ' + (u?.firstName || '') + ' ' + (u?.lastName || '') + ' (' + (m.role || 'member') + ') ' + (u?.email || '');
        });
        sections.push('=== JOBTREAD TEAM ===\n' + lines.join('\n'));
      }
    }).catch(err => { sections.push('=== JT TEAM ERROR ===\n' + (err instanceof Error ? err.message : 'Failed')); }));
  }
  if (intent.needsJTCustomers) {
    fetches.push(getCustomers().then(custs => {
      if (Array.isArray(custs) && custs.length > 0) {
        const lines = custs.map((c: Record<string, string>) => '- ' + (c.name || 'Unknown') + ' | ' + (c.email || '') + ' ' + (c.phone || ''));
        sections.push('=== JOBTREAD CUSTOMERS ===\n' + lines.join('\n'));
      }
    }).catch(err => { sections.push('=== JT CUSTOMERS ERROR ===\n' + (err instanceof Error ? err.message : 'Failed')); }));
  }
  if (intent.needsJTVendors) {
    fetches.push(getVendors().then(vends => {
      if (Array.isArray(vends) && vends.length > 0) {
        const lines = vends.map((v: Record<string, string>) => '- ' + (v.name || 'Unknown') + ' | ' + (v.email || '') + ' ' + (v.phone || ''));
        sections.push('=== JOBTREAD VENDORS ===\n' + lines.join('\n'));
      }
    }).catch(err => { sections.push('=== JT VENDORS ERROR ===\n' + (err instanceof Error ? err.message : 'Failed')); }));
  }
  await Promise.allSettled(fetches);
  return sections.join('\n\n');
}

export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { messages, contactId, contactName } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    const intent = detectIntent(lastUserMsg);
    const needsAnyData = intent.needsGHL || intent.needsJTJobs || intent.needsJTTeam || intent.needsJTCustomers || intent.needsJTVendors;
    // If no specific intent detected, default to GHL if contact selected, otherwise JT jobs
    if (!needsAnyData) {
      if (contactId) intent.needsGHL = true;
      else intent.needsJTJobs = true;
    }
    // Fetch data in parallel
    const dataPromises: Promise<string>[] = [];
    if (contactId && intent.needsGHL) {
      dataPromises.push(fetchGHLData(contactId));
    }
    if (intent.needsJTJobs || intent.needsJTTeam || intent.needsJTCustomers || intent.needsJTVendors) {
      dataPromises.push(fetchJTData(intent));
    }
    const dataResults = await Promise.allSettled(dataPromises);
    const contextParts: string[] = [];
    for (const r of dataResults) {
      if (r.status === 'fulfilled' && r.value) contextParts.push(r.value);
    }
    // Build messages for Claude
    const claudeMessages = messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    // Inject context into the last user message
    if (contextParts.length > 0) {
      const contextBlock = '\n\n--- SYSTEM DATA (use this to answer the question) ---\n' +
        (contactName ? 'Selected Client: ' + contactName + '\n\n' : '') +
        contextParts.join('\n\n') +
        '\n--- END SYSTEM DATA ---';
      const lastIdx = claudeMessages.length - 1;
      claudeMessages[lastIdx].content = claudeMessages[lastIdx].content + contextBlock;
    }
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: 'You are the AI assistant for Brett King Builder (BKB), a high-end residential renovation and historic home restoration company in Bucks County, PA. You help the team by answering questions about clients (from GHL CRM data) and projects (from JobTread). Be specific, reference real data, and be concise. Format responses clearly with relevant details. If data is missing or a query returned no results, say so honestly.',
      messages: claudeMessages,
    });
    const reply = message.content[0].type === 'text' ? message.content[0].text : 'No response generated.';
    return NextResponse.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    const errorMsg = err instanceof Error ? err.message : 'Chat failed';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
