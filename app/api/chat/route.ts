// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateAuth } from '../lib/auth';
import { getContact, getContactNotes, searchConversations, getConversationMessages, getContactTasks } from '../lib/ghl';
import { getActiveJobs, getTeamMembers, getCustomers, getVendors, createTask } from '../lib/jobtread';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Detect what data we need based on the user message
function detectIntent(msg: string) {
  const lower = msg.toLowerCase();
  return {
    needsGHL: /note|message|conversation|history|communication|crm|email|sms|task|meeting|transcript|follow.?up|last.?contact|overview|summary|client|contact/i.test(lower),
    needsJTJobs: /job|project|budget|cost|revenue|schedule|daily.?log|comment|jobtread|active.*job|profit|margin|task|create.*task/i.test(lower),
    needsJTTeam: /team|member|assign|who.*work|staff|employee|crew/i.test(lower),
    needsJTCustomers: /customer|client.*list|all.*client|account/i.test(lower),
    needsJTVendors: /vendor|supplier|sub|trade.*partner/i.test(lower),
  };
}

// Helper to format any value for display
function formatValue(val: any): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    if (val.length === 0) return '';
    return val.map(v => {
      if (typeof v === 'object' && v !== null) {
        if (v.value !== undefined && v.value !== null && v.value !== '') {
          return (v.fieldKey || v.key || v.id || 'field') + ': ' + String(v.value);
        }
        return JSON.stringify(v);
      }
      return String(v);
    }).join(', ');
  }
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// Fields to skip when dynamically reading contact profile
const SKIP_FIELDS = new Set([
  'id', 'locationId', 'fingerprint', 'firstNameLowerCase', 'lastNameLowerCase',
  'fullNameLowerCase', 'emailLowerCase', 'contactName', 'companyLowerCase',
  '__v', 'deleted', 'type',
]);

// Extract JobTread IDs from GHL custom fields
function extractJTIds(contact: any): { jtCustomerId: string | null; jtJobId: string | null } {
  let jtCustomerId: string | null = null;
  let jtJobId: string | null = null;

  if (contact?.customFields && Array.isArray(contact.customFields)) {
    for (const cf of contact.customFields) {
      const key = (cf.fieldKey || cf.key || cf.id || '').toLowerCase();
      const val = cf.value;
      if (!val || val === '') continue;

      // Match JT Customer ID field
      if (key.includes('jt') && key.includes('customer')) {
        jtCustomerId = String(val);
      }
      // Match JT.ID field (the Job ID) - but not customer id
      if (key.includes('jt') && (key.includes('.id') || key.endsWith('_id') || key.endsWith('id')) && !key.includes('customer')) {
        jtJobId = String(val);
      }
    }
  }

  return { jtCustomerId, jtJobId };
}

async function fetchGHLData(contactId: string): Promise<{ text: string; jtCustomerId: string | null; jtJobId: string | null }> {
  const sections: string[] = [];
  let jtCustomerId: string | null = null;
  let jtJobId: string | null = null;

  try {
    const [profile, notes, convos, tasks] = await Promise.allSettled([
      getContact(contactId),
      getContactNotes(contactId),
      searchConversations(contactId),
      getContactTasks(contactId),
    ]);

    // === CONTACT PROFILE (all populated fields) ===
    if (profile.status === 'fulfilled' && profile.value) {
      const c = profile.value.contact || profile.value;

      // Extract JT IDs from custom fields
      const jtIds = extractJTIds(c);
      jtCustomerId = jtIds.jtCustomerId;
      jtJobId = jtIds.jtJobId;

      const profileLines: string[] = [];
      const priorityFields = [
        ['firstName', 'First Name'], ['lastName', 'Last Name'],
        ['email', 'Email'], ['phone', 'Phone'], ['companyName', 'Company'],
        ['address1', 'Address'], ['city', 'City'], ['state', 'State'],
        ['postalCode', 'Postal Code'], ['country', 'Country'],
        ['website', 'Website'], ['source', 'Lead Source'],
        ['dateAdded', 'Date Added'], ['dateOfBirth', 'Date of Birth'],
        ['assignedTo', 'Assigned To'], ['dnd', 'Do Not Disturb'],
        ['lastActivity', 'Last Activity'],
      ];

      const usedKeys = new Set();
      for (const [key, label] of priorityFields) {
        usedKeys.add(key);
        const val = formatValue(c[key]);
        if (val) {
          if (key === 'dateAdded' || key === 'lastActivity') {
            try { profileLines.push(label + ': ' + new Date(c[key]).toLocaleString()); } catch { profileLines.push(label + ': ' + val); }
          } else {
            profileLines.push(label + ': ' + val);
          }
        }
      }

      if (c.tags && Array.isArray(c.tags) && c.tags.length > 0) {
        profileLines.push('Tags: ' + c.tags.join(', '));
        usedKeys.add('tags');
      }

      if (c.customFields && Array.isArray(c.customFields) && c.customFields.length > 0) {
        for (const cf of c.customFields) {
          if (cf.value !== undefined && cf.value !== null && cf.value !== '') {
            profileLines.push((cf.fieldKey || cf.key || cf.id || 'Custom Field') + ': ' + String(cf.value));
          }
        }
        usedKeys.add('customFields');
      }

      if (c.additionalEmails && c.additionalEmails.length > 0) {
        profileLines.push('Additional Emails: ' + c.additionalEmails.join(', '));
        usedKeys.add('additionalEmails');
      }
      if (c.additionalPhones && c.additionalPhones.length > 0) {
        profileLines.push('Additional Phones: ' + c.additionalPhones.map((p: any) => p.phone || p).join(', '));
        usedKeys.add('additionalPhones');
      }

      if (c.opportunities && Array.isArray(c.opportunities) && c.opportunities.length > 0) {
        for (const opp of c.opportunities) {
          profileLines.push('Opportunity: ' + (opp.name || 'Unnamed') + ' | Value: ' + (opp.monetaryValue || 'N/A') + ' | Status: ' + (opp.status || 'N/A'));
        }
        usedKeys.add('opportunities');
      }

      for (const key of Object.keys(c)) {
        if (usedKeys.has(key) || SKIP_FIELDS.has(key)) continue;
        const val = formatValue(c[key]);
        if (val && val !== '[]' && val !== '{}') {
          profileLines.push(key + ': ' + val);
        }
      }

      // Add JT ID info prominently
      if (jtJobId) profileLines.push('** JobTread Job ID: ' + jtJobId + ' **');
      if (jtCustomerId) profileLines.push('** JobTread Customer ID: ' + jtCustomerId + ' **');

      if (profileLines.length > 0) sections.push('=== CONTACT PROFILE ===\n' + profileLines.join('\n'));
    }

    // === CRM NOTES ===
    if (notes.status === 'fulfilled' && Array.isArray(notes.value) && notes.value.length > 0) {
      const noteTexts = notes.value.slice(0, 50).map((n: any) => {
        const date = n.dateAdded ? new Date(n.dateAdded).toLocaleDateString() : 'No date';
        return '[' + date + '] ' + (n.body || '').slice(0, 65000);
      });
      sections.push('=== CRM NOTES (' + notes.value.length + ' total) ===\n' + noteTexts.join('\n---\n'));
    }

    // === CONVERSATIONS & MESSAGES ===
    if (convos.status === 'fulfilled' && Array.isArray(convos.value)) {
      const msgs: string[] = [];
      for (const conv of convos.value.slice(0, 10)) {
        try {
          const cmsgs = await getConversationMessages((conv as any).id, 40);
          if (Array.isArray(cmsgs)) {
            for (const m of cmsgs) {
              const mr = m as any;
              const date = mr.dateAdded ? new Date(mr.dateAdded).toLocaleDateString() : '';
              msgs.push('[' + date + ' ' + (mr.direction || '?') + ' ' + (mr.type || '') + '] ' + (mr.body || '').slice(0, 2000));
            }
          }
        } catch { /* skip */ }
      }
      if (msgs.length > 0) sections.push('=== MESSAGES (' + msgs.length + ' total) ===\n' + msgs.join('\n'));
    }

    // === TASKS ===
    if (tasks.status === 'fulfilled' && Array.isArray(tasks.value) && tasks.value.length > 0) {
      const taskTexts = tasks.value.map((t: any) => {
        const due = t.dueDate ? ' (Due: ' + new Date(t.dueDate).toLocaleDateString() + ')' : '';
        const assignee = t.assignedTo ? ' [Assigned: ' + t.assignedTo + ']' : '';
        const desc = t.description ? ' - ' + t.description.slice(0, 500) : '';
        return '- [' + (t.completed ? 'DONE' : 'OPEN') + '] ' + (t.title || t.body || 'No title') + due + assignee + desc;
      });
      sections.push('=== TASKS (' + tasks.value.length + ' total) ===\n' + taskTexts.join('\n'));
    }

  } catch (err) {
    sections.push('=== GHL ERROR ===\n' + (err instanceof Error ? err.message : 'Failed to fetch GHL data'));
  }

  return { text: sections.join('\n\n'), jtCustomerId, jtJobId };
}

async function fetchJTData(intent: ReturnType<typeof detectIntent>): Promise<string> {
  const sections: string[] = [];
  const fetches: Promise<void>[] = [];

  if (intent.needsJTJobs) {
    fetches.push(getActiveJobs(30).then(jobs => {
      if (Array.isArray(jobs) && jobs.length > 0) {
        const lines = jobs.map((j: any) =>
          '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' | Status: ' + (j.status || 'N/A')
        );
        sections.push('=== JOBTREAD ACTIVE JOBS ===\n' + lines.join('\n'));
      } else {
        sections.push('=== JOBTREAD JOBS ===\nNo active jobs found.');
      }
    }).catch(err => {
      sections.push('=== JT JOBS ERROR ===\n' + (err instanceof Error ? err.message : 'Failed'));
    }));
  }

  if (intent.needsJTTeam) {
    fetches.push(getTeamMembers().then(members => {
      if (Array.isArray(members) && members.length > 0) {
        const lines = members.map((m: any) => {
          const u = m.user as any;
          return '- ' + (u?.firstName || '') + ' ' + (u?.lastName || '') + ' (' + (m.role || 'member') + ') ' + (u?.email || '');
        });
        sections.push('=== JOBTREAD TEAM ===\n' + lines.join('\n'));
      }
    }).catch(err => {
      sections.push('=== JT TEAM ERROR ===\n' + (err instanceof Error ? err.message : 'Failed'));
    }));
  }

  if (intent.needsJTCustomers) {
    fetches.push(getCustomers().then(custs => {
      if (Array.isArray(custs) && custs.length > 0) {
        const lines = custs.map((c: any) => '- ' + (c.name || 'Unknown') + ' | ' + (c.email || '') + ' ' + (c.phone || ''));
        sections.push('=== JOBTREAD CUSTOMERS ===\n' + lines.join('\n'));
      }
    }).catch(err => {
      sections.push('=== JT CUSTOMERS ERROR ===\n' + (err instanceof Error ? err.message : 'Failed'));
    }));
  }

  if (intent.needsJTVendors) {
    fetches.push(getVendors().then(vends => {
      if (Array.isArray(vends) && vends.length > 0) {
        const lines = vends.map((v: any) => '- ' + (v.name || 'Unknown') + ' | ' + (v.email || '') + ' ' + (v.phone || ''));
        sections.push('=== JOBTREAD VENDORS ===\n' + lines.join('\n'));
      }
    }).catch(err => {
      sections.push('=== JT VENDORS ERROR ===\n' + (err instanceof Error ? err.message : 'Failed'));
    }));
  }

  await Promise.allSettled(fetches);
  return sections.join('\n\n');
}

// Tool definitions for Claude tool use
const TOOLS: any[] = [
  {
    name: 'create_jobtread_task',
    description: 'Create a new task in JobTread for a specific job/project. Use the JobTread Job ID from the contact GHL profile (the JT.ID custom field) as the jobId parameter.',
    input_schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The JobTread Job ID to create the task under. This comes from the JT.ID custom field in the GHL contact profile.' },
        name: { type: 'string', description: 'The task title/name' },
        description: { type: 'string', description: 'Detailed description of the task' },
        startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format (optional)' },
        endDate: { type: 'string', description: 'Due/end date in YYYY-MM-DD format (optional)' },
      },
      required: ['jobId', 'name'],
    },
  },
];

// Execute a tool call
async function executeTool(name: string, input: any): Promise<string> {
  try {
    if (name === 'create_jobtread_task') {
      const result = await createTask({
        jobId: input.jobId,
        name: input.name,
        description: input.description || '',
        startDate: input.startDate,
        endDate: input.endDate,
      });
      return JSON.stringify({ success: true, result });
    }
    return JSON.stringify({ error: 'Unknown tool: ' + name });
  } catch (err) {
    return JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Tool execution failed' });
  }
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

    if (!needsAnyData) {
      if (contactId) intent.needsGHL = true;
      else intent.needsJTJobs = true;
    }

    // Always fetch GHL data if contact is selected (need JT IDs for potential task creation)
    if (contactId && !intent.needsGHL) {
      intent.needsGHL = true;
    }

    const dataPromises: Promise<any>[] = [];
    let ghlDataPromise: Promise<{ text: string; jtCustomerId: string | null; jtJobId: string | null }> | null = null;

    if (contactId) {
      ghlDataPromise = fetchGHLData(contactId);
      dataPromises.push(ghlDataPromise);
    }

    if (intent.needsJTJobs || intent.needsJTTeam || intent.needsJTCustomers || intent.needsJTVendors) {
      dataPromises.push(fetchJTData(intent));
    }

    const dataResults = await Promise.allSettled(dataPromises);
    const contextParts: string[] = [];
    let jtJobId: string | null = null;
    let jtCustomerId: string | null = null;

    for (const r of dataResults) {
      if (r.status === 'fulfilled' && r.value) {
        if (typeof r.value === 'string') {
          contextParts.push(r.value);
        } else if (r.value.text) {
          contextParts.push(r.value.text);
          jtJobId = r.value.jtJobId;
          jtCustomerId = r.value.jtCustomerId;
        }
      }
    }

    // Build messages for Claude
    const claudeMessages: any[] = messages.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Inject context into the last user message
    if (contextParts.length > 0) {
      const jtInfo = jtJobId
        ? '\nJobTread Job ID for this contact: ' + jtJobId + (jtCustomerId ? '\nJobTread Customer ID: ' + jtCustomerId : '') + '\n'
        : '\nNo JobTread Job ID found for this contact. Task creation in JobTread will not be possible without a JT.ID custom field in GHL.\n';
      const contextBlock = '\n\n--- SYSTEM DATA (use this to answer the question) ---\n' +
        (contactName ? 'Selected Client: ' + contactName + '\n' : '') +
        jtInfo +
        contextParts.join('\n\n') +
        '\n--- END SYSTEM DATA ---';
      const lastIdx = claudeMessages.length - 1;
      claudeMessages[lastIdx].content = claudeMessages[lastIdx].content + contextBlock;
    }

    const systemPrompt = 'You are the AI assistant for Brett King Builder (BKB), a high-end residential renovation and historic home restoration company in Bucks County, PA. You help the team by answering questions about clients (from GHL CRM data) and projects (from JobTread). Be specific, reference real data, and be concise. Format responses clearly with relevant details.\n\nWhen summarizing a client, include ALL available information. Do not skip or truncate any information.\n\nIMPORTANT - Creating Tasks in JobTread:\nWhen asked to create a task in JobTread, you MUST use the create_jobtread_task tool. The JobTread Job ID needed for task creation is found in the SYSTEM DATA as \"JobTread Job ID for this contact\". Use that ID as the jobId parameter. If no JobTread Job ID is found, inform the user that the contact does not have a linked JobTread job and the task cannot be created automatically.\n\nIf data is missing or a query returned no results, say so honestly.';

    // Call Claude with tools enabled
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages: claudeMessages,
    });

    // Handle tool use loop (max 5 iterations)
    let iterations = 0;
    while (response.stop_reason === 'tool_use' && iterations < 5) {
      iterations++;

      // Add assistant response to messages
      claudeMessages.push({ role: 'assistant', content: response.content });

      // Process tool calls and collect results
      const toolResults: any[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      // Add tool results as user message
      claudeMessages.push({ role: 'user', content: toolResults });

      // Get next response from Claude
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages: claudeMessages,
      });
    }

    // Extract text from final response
    let reply = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        reply += block.text;
      }
    }
    if (!reply) reply = 'No response generated.';

    return NextResponse.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    const errorMsg = err instanceof Error ? err.message : 'Chat failed';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
  }
