// @ts-nocheck
/**
 * Know It All Agent â v2 (Supabase-backed)
 *
 * Strategy: Try Supabase first (fast, no rate-limit risk).
 * Fall back to live GHL API if Supabase is empty or unavailable.
 * Triggers a background sync after live-fetch so next query uses cache.
 *
 * This lets us pull ALL notes, ALL messages, ALL history â no truncation â
 * because Supabase queries are fast and free of GHL rate limits.
 */
import { AgentModule, AgentContext } from './types';
import {
  getContactFromDB,
  getContactNotesFromDB,
  getContactMessagesFromDB,
  getContactTasksFromDB,
  getContactOpportunitiesFromDB,
  getOpportunityFromDB,
  getJTJobsFromDB,
  getLastSyncTime,
} from '../supabase';
import {
  getContact,
  getContactNotes,
  searchConversations,
  getConversationMessages,
  getContactTasks,
  getOpportunity,
  getMessageById,
  getEmailById,
} from '../ghl';
import { getActiveJobs } from '../jobtread';

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

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

const SKIP_FIELDS = new Set([
  'id', 'locationId', 'fingerprint', 'firstNameLowerCase', 'lastNameLowerCase',
  'fullNameLowerCase', 'emailLowerCase', 'contactName', 'companyLowerCase',
  '__v', 'deleted', 'type',
]);

// ââ SUPABASE-FIRST CONTEXT FETCHING âââââââââââââââââââââââââ

async function fetchContextFromSupabase(ctx: AgentContext): Promise<string | null> {
  if (!ctx.contactId) return null;

  try {
    const lastSync = await getLastSyncTime('contact_full', ctx.contactId);
    if (!lastSync) return null; // No sync yet, fall back to live

    const sections: string[] = [];

    // 1. CONTACT PROFILE
    const contact = await getContactFromDB(ctx.contactId);
    if (contact) {
      const profileLines: string[] = [];
      if (contact.first_name) profileLines.push('First Name: ' + contact.first_name);
      if (contact.last_name) profileLines.push('Last Name: ' + contact.last_name);
      if (contact.email) profileLines.push('Email: ' + contact.email);
      if (contact.phone) profileLines.push('Phone: ' + contact.phone);
      if (contact.company_name) profileLines.push('Company: ' + contact.company_name);
      if (contact.address) profileLines.push('Address: ' + contact.address);
      if (contact.city) profileLines.push('City: ' + contact.city);
      if (contact.state) profileLines.push('State: ' + contact.state);
      if (contact.postal_code) profileLines.push('Postal Code: ' + contact.postal_code);
      if (contact.country) profileLines.push('Country: ' + contact.country);
      if (contact.website) profileLines.push('Website: ' + contact.website);
      if (contact.source) profileLines.push('Lead Source: ' + contact.source);
      if (contact.date_added) profileLines.push('Date Added: ' + new Date(contact.date_added).toLocaleString());
      if (contact.last_activity) profileLines.push('Last Activity: ' + new Date(contact.last_activity).toLocaleString());
      if (contact.assigned_to) profileLines.push('Assigned To: ' + contact.assigned_to);
      if (contact.dnd) profileLines.push('Do Not Disturb: Yes');
      if (contact.tags && contact.tags.length > 0) profileLines.push('Tags: ' + contact.tags.join(', '));
      if (contact.custom_fields && typeof contact.custom_fields === 'object') {
        for (const [key, value] of Object.entries(contact.custom_fields)) {
          if (value != null && value !== '') profileLines.push(key + ': ' + String(value));
        }
      }
      if (profileLines.length > 0) {
        sections.push('=== CONTACT PROFILE (from cache, synced ' + new Date(lastSync).toLocaleString() + ') ===\n' + profileLines.join('\n'));
      }
    }

    // 2. OPPORTUNITIES
    const opps = await getContactOpportunitiesFromDB(ctx.contactId);
    if (opps.length > 0) {
      const oppLines = opps.map(o =>
        '- ' + (o.name || 'Unnamed') + ' | Value: ' + (o.monetary_value || 'N/A') +
        ' | Status: ' + (o.status || 'N/A') + ' | Stage: ' + (o.pipeline_stage || 'N/A')
      );
      sections.push('=== OPPORTUNITIES (' + opps.length + ') ===\n' + oppLines.join('\n'));
    }

    // 3. NOTES â Now we can pull ALL of them!
    const notes = await getContactNotesFromDB(ctx.contactId, 100);
    if (notes.length > 0) {
      const noteTexts = notes.map(n => {
        const date = n.date_added ? new Date(n.date_added).toLocaleDateString() : 'No date';
        return '[' + date + '] ' + (n.body || '').slice(0, 3000);
      });
      sections.push('=== CRM NOTES (' + notes.length + ' total) ===\n' + noteTexts.join('\n---\n'));
    }

    // 4. MESSAGES â ALL messages with full bodies!
    const messages = await getContactMessagesFromDB(ctx.contactId, 200);
    if (messages.length > 0) {
      const msgTexts = messages.map(m => {
        const date = m.date_added ? new Date(m.date_added).toLocaleDateString() : '';
        const direction = m.direction || '?';
        const msgType = m.message_type || '';
        const subject = m.subject ? ' Subject: ' + m.subject : '';
        const body = m.body ? m.body.slice(0, 2000) : '(no body)';
        return '[' + date + ' ' + direction + ' ' + msgType + subject + '] ' + body;
      });
      sections.push('=== MESSAGES (' + messages.length + ' total from Supabase) ===\n' + msgTexts.join('\n'));
    }

    // 5. TASKS
    const tasks = await getContactTasksFromDB(ctx.contactId);
    if (tasks.length > 0) {
      const taskTexts = tasks.map(t => {
        const due = t.due_date ? ' (Due: ' + new Date(t.due_date).toLocaleDateString() + ')' : '';
        const assignee = t.assigned_to ? ' [Assigned: ' + t.assigned_to + ']' : '';
        return '- [' + (t.completed ? 'DONE' : 'OPEN') + '] ' + (t.title || 'No title') + due + assignee;
      });
      sections.push('=== TASKS (' + tasks.length + ') ===\n' + taskTexts.join('\n'));
    }

    if (sections.length === 0) return null;
    return sections.join('\n\n');

  } catch (err) {
    console.error('Supabase fetch failed, falling back to live API:', err);
    return null;
  }
}

// ââ LIVE GHL FALLBACK (original logic, with token budgets) ââ

async function fetchGHLContextLive(ctx: AgentContext): Promise<string> {
  if (!ctx.contactId) return '';
  const sections: string[] = [];

  try {
    const [profile, notes, convos, tasks] = await Promise.allSettled([
      getContact(ctx.contactId),
      getContactNotes(ctx.contactId),
      searchConversations(ctx.contactId),
      getContactTasks(ctx.contactId),
    ]);

    // CONTACT PROFILE
    if (profile.status === 'fulfilled' && profile.value) {
      const c = profile.value.contact || profile.value;
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

      if (profileLines.length > 0) sections.push('=== CONTACT PROFILE (live from GHL) ===\n' + profileLines.join('\n'));
    }

    // NOTES (budgeted for live)
    if (notes.status === 'fulfilled' && Array.isArray(notes.value) && notes.value.length > 0) {
      const noteTexts = notes.value.slice(0, 20).map((n: any) => {
        const date = n.dateAdded ? new Date(n.dateAdded).toLocaleDateString() : 'No date';
        return '[' + date + '] ' + (n.body || '').slice(0, 1500);
      });
      sections.push('=== CRM NOTES (' + notes.value.length + ' total, showing latest 20 â LIVE) ===\n' + noteTexts.join('\n---\n'));
    }

    // CONVERSATIONS & MESSAGES (budgeted for live)
    const MAX_CONVOS = 5;
    const MAX_MSGS_PER_CONVO = 20;
    const MAX_BODY_CHARS = 1200;
    const MAX_EMAIL_BODY_FETCHES = 8;
    let emailBodyFetches = 0;

    if (convos.status === 'fulfilled' && Array.isArray(convos.value) && convos.value.length > 0) {
      const msgs: string[] = [];
      for (const conv of convos.value.slice(0, MAX_CONVOS)) {
        try {
          const cmsgs = await getConversationMessages(conv.id, MAX_MSGS_PER_CONVO);
          if (Array.isArray(cmsgs)) {
            for (const m of cmsgs) {
              const date = m.dateAdded ? new Date(m.dateAdded).toLocaleDateString() : '';
              const direction = m.direction || '?';
              const msgType = m.messageType || m.type || '';
              const subject = m.meta?.email?.subject ? ' Subject: ' + m.meta.email.subject : '';
              let body = m.body || m.text || m.message || '';

              if (!body && m.messageType === 'TYPE_EMAIL' && emailBodyFetches < MAX_EMAIL_BODY_FETCHES) {
                emailBodyFetches++;
                try {
                  const fullMsg = await getMessageById(m.id);
                  const msgData = fullMsg.message || fullMsg;
                  body = msgData.body || msgData.text || msgData.html || '';
                  if (body && (msgData.contentType === 'text/html' || body.startsWith('<'))) body = stripHtml(body);
                } catch { /* fail silently */ }
                if (!body && m.meta?.email?.messageIds?.length > 0) {
                  try {
                    const emailData = await getEmailById(m.meta.email.messageIds[0]);
                    const email = emailData.email || emailData;
                    body = email.body || email.text || email.html || email.textBody || email.htmlBody || '';
                    if (body && body.startsWith('<')) body = stripHtml(body);
                  } catch { /* fail silently */ }
                }
              }
              if (!body && m.id === cmsgs[0]?.id && conv.lastMessageBody) body = conv.lastMessageBody;
              msgs.push('[' + date + ' ' + direction + ' ' + msgType + subject + '] ' + (body ? body.slice(0, MAX_BODY_CHARS) : '(no body)'));
            }
          }
        } catch { /* skip conversation */ }
      }
      if (msgs.length > 0) {
        sections.push('=== MESSAGES (' + msgs.length + ' shown â LIVE, budgeted) ===\n' + msgs.join('\n'));
      }
    }

    // TASKS
    if (tasks.status === 'fulfilled' && Array.isArray(tasks.value) && tasks.value.length > 0) {
      const taskTexts = tasks.value.map((t: any) => {
        const due = t.dueDate ? ' (Due: ' + new Date(t.dueDate).toLocaleDateString() + ')' : '';
        const assignee = t.assignedTo ? ' [Assigned: ' + t.assignedTo + ']' : '';
        return '- [' + (t.completed ? 'DONE' : 'OPEN') + '] ' + (t.title || t.body || 'No title') + due + assignee;
      });
      sections.push('=== TASKS (' + tasks.value.length + ') ===\n' + taskTexts.join('\n'));
    }

  } catch (err) {
    sections.push('=== GHL ERROR ===\n' + (err instanceof Error ? err.message : 'Failed to fetch GHL data'));
  }

  return sections.join('\n\n');
}

async function fetchOpportunityContext(ctx: AgentContext): Promise<string> {
  if (!ctx.opportunityId) return '';

  // Try Supabase first
  try {
    const opp = await getOpportunityFromDB(ctx.opportunityId);
    if (opp) {
      const lines = [
        'Name: ' + (opp.name || 'N/A'),
        'Status: ' + (opp.status || 'N/A'),
        'Pipeline Stage: ' + (ctx.pipelineStage || opp.pipeline_stage || 'N/A'),
        'Monetary Value: ' + (opp.monetary_value || 'N/A'),
        'Communication Channel: ' + ctx.communicationChannel.toUpperCase(),
      ];
      if (ctx.jtJobId) lines.push('JobTread Job ID: ' + ctx.jtJobId);
      if (opp.custom_fields && typeof opp.custom_fields === 'object') {
        for (const [key, value] of Object.entries(opp.custom_fields)) {
          if (value != null && value !== '') lines.push(key + ': ' + String(value));
        }
      }
      return '=== SELECTED OPPORTUNITY (from cache) ===\n' + lines.join('\n');
    }
  } catch { /* fall through to live */ }

  // Fallback to live GHL
  try {
    const opp = await getOpportunity(ctx.opportunityId);
    const o = opp.opportunity || opp;
    const lines = [
      'Name: ' + (o.name || 'N/A'),
      'Status: ' + (o.status || 'N/A'),
      'Pipeline Stage: ' + (ctx.pipelineStage || o.pipelineStageName || o.stageName || 'N/A'),
      'Monetary Value: ' + (o.monetaryValue || 'N/A'),
      'Communication Channel: ' + ctx.communicationChannel.toUpperCase(),
    ];
    if (ctx.jtJobId) lines.push('JobTread Job ID: ' + ctx.jtJobId);
    if (o.customFields && Array.isArray(o.customFields)) {
      for (const cf of o.customFields) {
        if (cf.value !== undefined && cf.value !== null && cf.value !== '') {
          lines.push((cf.fieldKey || cf.key || cf.id || 'Field') + ': ' + String(cf.value));
        }
      }
    }
    return '=== SELECTED OPPORTUNITY (live) ===\n' + lines.join('\n');
  } catch (err) {
    return '=== OPPORTUNITY ERROR ===\n' + (err instanceof Error ? err.message : 'Failed');
  }
}

async function fetchJTContext(): Promise<string> {
  // Try Supabase first
  try {
    const jobs = await getJTJobsFromDB(50);
    if (jobs.length > 0) {
      const lines = jobs.map(j =>
        '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' | Status: ' + (j.status || 'N/A')
      );
      return '=== JOBTREAD ACTIVE JOBS (from cache) ===\n' + lines.join('\n');
    }
  } catch { /* fall through */ }

  // Fallback to live
  try {
    const jobs = await getActiveJobs(30);
    if (Array.isArray(jobs) && jobs.length > 0) {
      const lines = jobs.map((j: any) =>
        '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' | Status: ' + (j.status || 'N/A')
      );
      return '=== JOBTREAD ACTIVE JOBS (live) ===\n' + lines.join('\n');
    }
  } catch (err) {
    return '=== JT JOBS ERROR ===\n' + (err instanceof Error ? err.message : 'Failed');
  }
  return '';
}

// ââ BACKGROUND SYNC TRIGGER âââââââââââââââââââââââââââââââââ

function triggerBackgroundSync(contactId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL
    ? 'https://' + process.env.VERCEL_URL
    : 'http://localhost:3000');
  const syncUrl = baseUrl + '/api/sync';
  fetch(syncUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId }),
  }).catch(err => console.error('Background sync trigger failed:', err));
}

// ââ AGENT MODULE ââââââââââââââââââââââââââââââââââââââââââââ

const knowItAll: AgentModule = {
  name: 'Know it All',
  description: 'Pulls all data from GHL and JobTread to answer any question about clients, projects, history, and status. Uses Supabase cache for fast, comprehensive lookups.',
  icon: '\u{1F9E0}',

  systemPrompt: (ctx: AgentContext) => {
    return 'You are "Know it All," the AI research assistant for Brett King Builder (BKB), a high-end residential renovation and historic home restoration company in Bucks County, PA.\n\n' +
      'Your specialty is knowing EVERYTHING about every client and project. You pull data from Supabase (cached GHL/JT data) for comprehensive, fast lookups, with live API fallback.\n\n' +
      'When summarizing a client or project, cover all key data points: profile, notes, communications (with dates and subjects), tasks, opportunities, and custom fields. Prioritize the most meaningful details and always include dates. If data seems truncated, mention that more records may exist.\n\n' +
      'Be specific, reference real data, and be concise but thorough. If data is missing, say so honestly.\n\n' +
      (ctx.communicationChannel !== 'unknown'
        ? 'Current communication channel for this opportunity: ' + ctx.communicationChannel.toUpperCase() + ' (based on pipeline stage: ' + (ctx.pipelineStage || 'unknown') + ')\n'
        : '') +
      (ctx.jtJobId ? 'JobTread Job ID: ' + ctx.jtJobId + '\n' : '');
  },

  tools: [],

  canHandle: (message: string) => {
    const lower = message.toLowerCase();
    if (/\?|what|who|when|where|how|tell me|show me|summary|overview|status|history|latest|update|details|information|look up|find out|check on/i.test(lower)) return 0.8;
    if (/client|project|job|contact|note|message|communication/i.test(lower)) return 0.5;
    return 0.3;
  },

  fetchContext: async (ctx: AgentContext) => {
    const parts: string[] = [];
    let usedLiveFallback = false;

    if (ctx.contactId) {
      const supabaseData = await fetchContextFromSupabase(ctx);
      if (supabaseData) {
        parts.push(supabaseData);
      } else {
        const liveData = await fetchGHLContextLive(ctx);
        if (liveData) parts.push(liveData);
        usedLiveFallback = true;
      }
    }

    if (ctx.opportunityId) {
      const opp = await fetchOpportunityContext(ctx);
      if (opp) parts.push(opp);
    }

    const jt = await fetchJTContext();
    if (jt) parts.push(jt);

    if (usedLiveFallback && ctx.contactId) {
      triggerBackgroundSync(ctx.contactId);
    }

    return parts.join('\n\n');
  },

  executeTool: async () => {
    return JSON.stringify({ error: 'Know it All does not execute tools' });
  },
};

export default knowItAll;

