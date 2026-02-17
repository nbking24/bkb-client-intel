// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateAuth } from '../lib/auth';
import { getContact, getContactNotes, searchConversations, getConversationMessages, getContactTasks } from '../lib/ghl';
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
        // Handle custom field objects
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

async function fetchGHLData(contactId: string): Promise<string> {
  const sections: string[] = [];

  try {
    // Fetch contact profile, notes, conversations, and tasks in parallel
    const [profile, notes, convos, tasks] = await Promise.allSettled([
      getContact(contactId),
      getContactNotes(contactId),
      searchConversations(contactId),
      getContactTasks(contactId),
    ]);

    // === CONTACT PROFILE (all populated fields) ===
    if (profile.status === 'fulfilled' && profile.value) {
      const c = profile.value.contact || profile.value;
      const profileLines: string[] = [];

      // Priority fields first for readability
      const priorityFields = [
        ['firstName', 'First Name'], ['lastName', 'Last Name'],
        ['email', 'Email'], ['phone', 'Phone'],
        ['companyName', 'Company'], ['address1', 'Address'],
        ['city', 'City'], ['state', 'State'], ['postalCode', 'Postal Code'], ['country', 'Country'],
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
          // Format dates nicely
          if (key === 'dateAdded' || key === 'lastActivity') {
            try { profileLines.push(label + ': ' + new Date(c[key]).toLocaleString()); } catch { profileLines.push(label + ': ' + val); }
          } else {
            profileLines.push(label + ': ' + val);
          }
        }
      }

      // Tags
      if (c.tags && Array.isArray(c.tags) && c.tags.length > 0) {
        profileLines.push('Tags: ' + c.tags.join(', '));
        usedKeys.add('tags');
      }

      // Custom fields
      if (c.customFields && Array.isArray(c.customFields) && c.customFields.length > 0) {
        for (const cf of c.customFields) {
          if (cf.value !== undefined && cf.value !== null && cf.value !== '') {
            profileLines.push((cf.fieldKey || cf.key || cf.id || 'Custom Field') + ': ' + String(cf.value));
          }
        }
        usedKeys.add('customFields');
      }

      // Additional emails and phones
      if (c.additionalEmails && c.additionalEmails.length > 0) {
        profileLines.push('Additional Emails: ' + c.additionalEmails.join(', '));
        usedKeys.add('additionalEmails');
      }
      if (c.additionalPhones && c.additionalPhones.length > 0) {
        profileLines.push('Additional Phones: ' + c.additionalPhones.map((p: any) => p.phone || p).join(', '));
        usedKeys.add('additionalPhones');
      }

      // Opportunities if included
      if (c.opportunities && Array.isArray(c.opportunities) && c.opportunities.length > 0) {
        for (const opp of c.opportunities) {
          profileLines.push('Opportunity: ' + (opp.name || 'Unnamed') + ' | Value: ' + (opp.monetaryValue || 'N/A') + ' | Status: ' + (opp.status || 'N/A'));
        }
        usedKeys.add('opportunities');
      }

      // Catch-all: any other populated fields we haven't explicitly handled
      for (const key of Object.keys(c)) {
        if (usedKeys.has(key) || SKIP_FIELDS.has(key)) continue;
        const val = formatValue(c[key]);
        if (val && val !== '[]' && val !== '{}') {
          profileLines.push(key + ': ' + val);
        }
      }

      if (profileLines.length > 0) sections.push('=== CONTACT PROFILE ===\n' + profileLines.join('\n'));
    }

    // === CRM NOTES (all notes, full content up to 65000 chars each) ===
    if (notes.status === 'fulfilled' && Array.isArray(notes.value) && notes.value.length > 0) {
      const noteTexts = notes.value.slice(0, 50).map((n: any) => {
        const date = n.dateAdded ? new Date(n.dateAdded).toLocaleDateString() : 'No date';
        return '[' + date + '] ' + (n.body || '').slice(0, 65000);
      });
      sections.push('=== CRM NOTES (' + notes.value.length + ' total) ===\n' + noteTexts.join('\n---\n'));
    }

    // === CONVERSATIONS & MESSAGES (all conversations, more messages) ===
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

  return sections.join('\n\n');
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

    const needsAnyData = intent.needsGHL || intent.needsJTJobs || intent.needsJTTeam ||
      intent.needsJTCustomers || intent.needsJTVendors;

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
      system: 'You are the AI assistant for Brett King Builder (BKB), a high-end residential renovation and historic home restoration company in Bucks County, PA. You help the team by answering questions about clients (from GHL CRM data) and projects (from JobTread). Be specific, reference real data, and be concise. Format responses clearly with relevant details. When summarizing a client, include ALL available information: their full profile (every field), every note in its entirety, all communication history, tasks, custom fields, tags, opportunities, and any other data provided. Do not skip or truncate any information. If data is missing or a query returned no results, say so honestly.',
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
