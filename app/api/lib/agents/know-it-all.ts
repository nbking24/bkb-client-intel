// @ts-nocheck
/**
 * Know It All Agent - v2 (Supabase-backed)
 *
 * Strategy: Try Supabase first (fast, no rate-limit risk).
 * Fall back to live GHL API if Supabase is empty or unavailable.
 * Triggers a background sync after live-fetch so next query uses cache.
 *
 * This lets us pull ALL notes, ALL messages, ALL history - no truncation -
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
  getJTCommentsByJobId,
  getJTDailyLogsByJobId,
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
import { getBrandVoicePrompt } from '@/app/lib/bkb-brand-voice';

// -- TOKEN-AWARE CONTEXT BUDGETING ------------------------------------
// Claude Sonnet has ~200k context. We budget ~120k chars (~30k tokens)
// for system data so the model still has room for system prompt +
// conversation history + response generation.
const MAX_CONTEXT_CHARS = 120_000;

// Priority order: profile & opps are small and always included.
// Notes and messages are large and get trimmed (oldest first) if needed.
// Rough char-per-token ratio: ~4 chars = 1 token.
function trimToContextBudget(sections: { label: string; content: string; priority: number }[]): string {
  // Sort by priority (lower = more important, always included first)
  sections.sort((a, b) => a.priority - b.priority);

  let totalChars = 0;
  const included: string[] = [];

  for (const section of sections) {
    if (totalChars + section.content.length <= MAX_CONTEXT_CHARS) {
      included.push(section.content);
      totalChars += section.content.length;
    } else {
      // Partial inclusion: trim from the END (oldest entries) since
      // content is ordered newest-first from Supabase
      const remaining = MAX_CONTEXT_CHARS - totalChars;
      if (remaining > 500) {
        // Keep the newest entries (at the start of the string)
        const trimmed = section.content.slice(0, remaining);
        const lastNewline = trimmed.lastIndexOf('\n');
        const cleanCut = lastNewline > 0 ? trimmed.slice(0, lastNewline) : trimmed;
        included.push(cleanCut + '\n... (older records trimmed to fit context window)');
        totalChars += cleanCut.length;
      }
      break; // No room for remaining sections
    }
  }

  return included.join('\n\n');
}

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

// -- SUPABASE-FIRST CONTEXT FETCHING ---------------------------------

async function fetchContextFromSupabase(ctx: AgentContext): Promise<string | null> {
  if (!ctx.contactId) return null;

  try {
    const lastSync = await getLastSyncTime('contact_full', ctx.contactId);
    if (!lastSync) return null; // No sync yet, fall back to live

    // Fetch ALL data concurrently - no artificial limits
    const [contact, opps, notes, messages, tasks] = await Promise.all([
      getContactFromDB(ctx.contactId),
      getContactOpportunitiesFromDB(ctx.contactId),
      getContactNotesFromDB(ctx.contactId),
      getContactMessagesFromDB(ctx.contactId),
      getContactTasksFromDB(ctx.contactId),
    ]);

    const budgetSections: { label: string; content: string; priority: number }[] = [];

    // 1. CONTACT PROFILE - priority 1 (always included, small)
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
        budgetSections.push({
          label: 'profile',
          content: '=== CONTACT PROFILE (from cache, synced ' + new Date(lastSync).toLocaleString() + ') ===\n' + profileLines.join('\n'),
          priority: 1,
        });
      }
    }

    // 2. OPPORTUNITIES - priority 1 (always included, small)
    if (opps.length > 0) {
      const oppLines = opps.map(o =>
        '- ' + (o.name || 'Unnamed') + ' | Value: ' + (o.monetary_value || 'N/A') +
        ' | Status: ' + (o.status || 'N/A') + ' | Stage: ' + (o.pipeline_stage || 'N/A')
      );
      budgetSections.push({
        label: 'opportunities',
        content: '=== OPPORTUNITIES (' + opps.length + ') ===\n' + oppLines.join('\n'),
        priority: 1,
      });
    }

    // 3. TASKS - priority 1 (always included, usually small)
    if (tasks.length > 0) {
      const taskTexts = tasks.map(t => {
        const due = t.due_date ? ' (Due: ' + new Date(t.due_date).toLocaleDateString() + ')' : '';
        const assignee = t.assigned_to ? ' [Assigned: ' + t.assigned_to + ']' : '';
        return '- [' + (t.completed ? 'DONE' : 'OPEN') + '] ' + (t.title || 'No title') + due + assignee;
      });
      budgetSections.push({
        label: 'tasks',
        content: '=== TASKS (' + tasks.length + ') ===\n' + taskTexts.join('\n'),
        priority: 1,
      });
    }

    // 4. NOTES - priority 2 (important context, full bodies, trimmed if needed)
    if (notes.length > 0) {
      const noteTexts = notes.map(n => {
        const date = n.date_added ? new Date(n.date_added).toLocaleDateString() : 'No date';
        return '[' + date + '] ' + (n.body || '');
      });
      budgetSections.push({
        label: 'notes',
        content: '=== CRM NOTES (' + notes.length + ' total) ===\n' + noteTexts.join('\n---\n'),
        priority: 2,
      });
    }

    // 5. MESSAGES - priority 3 (largest dataset, trimmed first if overflow)
    if (messages.length > 0) {
      const msgTexts = messages.map(m => {
        const date = m.date_added ? new Date(m.date_added).toLocaleDateString() : '';
        const direction = m.direction || '?';
        const msgType = m.message_type || '';
        const subject = m.subject ? ' Subject: ' + m.subject : '';
        const body = m.body || '(no body)';
        return '[' + date + ' ' + direction + ' ' + msgType + subject + '] ' + body;
      });
      budgetSections.push({
        label: 'messages',
        content: '=== MESSAGES (' + messages.length + ' total from Supabase) ===\n' + msgTexts.join('\n'),
        priority: 3,
      });
    }

    if (budgetSections.length === 0) return null;

    // Smart truncation: fit everything into ~120k chars, trimming lowest-priority first
    return trimToContextBudget(budgetSections);

  } catch (err) {
    console.error('Supabase fetch failed, falling back to live API:', err);
    return null;
  }
}

// -- LIVE GHL FALLBACK (original logic, with token budgets) -----------

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
      sections.push('=== CRM NOTES (' + notes.value.length + ' total, showing latest 20 - LIVE) ===\n' + noteTexts.join('\n---\n'));
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
        sections.push('=== MESSAGES (' + msgs.length + ' shown - LIVE, budgeted) ===\n' + msgs.join('\n'));
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

// -- JT JOB DETAILS (comments + daily logs for a specific job) --------

async function fetchJTJobDetails(jobId: string): Promise<string | null> {
  try {
    const [comments, dailyLogs] = await Promise.all([
      getJTCommentsByJobId(jobId),
      getJTDailyLogsByJobId(jobId),
    ]);

    const budgetSections: { label: string; content: string; priority: number }[] = [];

    // JT Comments — priority 2 (important project discussion content)
    if (comments.length > 0) {
      const commentTexts = comments.map(c => {
        const date = c.created_at ? new Date(c.created_at).toLocaleDateString() : 'No date';
        const author = c.name || 'Unknown';
        const target = c.target_type ? ' [on ' + c.target_type + ']' : '';
        const pinned = c.is_pinned ? ' [PINNED]' : '';
        return '[' + date + ' by ' + author + target + pinned + '] ' + (c.message || '(empty)');
      });
      budgetSections.push({
        label: 'jt_comments',
        content: '=== JOBTREAD COMMENTS (' + comments.length + ' total for this job) ===\n' + commentTexts.join('\n---\n'),
        priority: 2,
      });
    }

    // JT Daily Logs — priority 2
    if (dailyLogs.length > 0) {
      const logTexts = dailyLogs.map(l => {
        const date = l.date || 'No date';
        const assigned = l.assigned_member_names && l.assigned_member_names.length > 0
          ? ' (Assigned: ' + l.assigned_member_names.join(', ') + ')'
          : '';
        return '[' + date + assigned + '] ' + (l.notes || '(empty)');
      });
      budgetSections.push({
        label: 'jt_daily_logs',
        content: '=== JOBTREAD DAILY LOGS (' + dailyLogs.length + ' total) ===\n' + logTexts.join('\n---\n'),
        priority: 2,
      });
    }

    if (budgetSections.length === 0) return null;

    return trimToContextBudget(budgetSections);
  } catch (err) {
    console.error('fetchJTJobDetails failed for job ' + jobId + ':', err);
    return null;
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

// -- BACKGROUND SYNC TRIGGER -----------------------------------------

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

// -- AGENT MODULE ----------------------------------------------------

const knowItAll: AgentModule = {
  name: 'Know it All',
  description: 'Pulls all data from GHL and JobTread to answer any question about clients, projects, history, and status. Uses Supabase cache for fast, comprehensive lookups.',
  icon: '\u{1F9E0}',

  systemPrompt: (ctx: AgentContext) => {
    return 'You are "Know it All," the AI research assistant for Brett King Builder (BKB), a high-end residential renovation and historic home restoration company in Bucks County, PA.\n\n' +
      'Your specialty is knowing EVERYTHING about every client and project. You pull data from Supabase (cached GHL/JT data) for comprehensive, fast lookups, with live API fallback.\n\n' +
      'IMPORTANT: You are also the primary agent for DRAFTING CLIENT EMAILS AND COMMUNICATIONS. When the user asks you to write, draft, compose, or prepare any email, message, or communication to a client, you MUST draft it. Use the brand voice guidelines below and the client context data to craft professional, on-brand emails. Review past communication history when available to match tone and context.\n\n' +
      'EMAIL OUTPUT FORMAT: When you draft an email, always provide it TWICE:\n' +
      '1. First, show the email in normal formatted text so the user can read it easily.\n' +
      '2. Then, below a "---" divider, show the SAME email again inside a markdown code block (triple backticks with markdown language tag). THIS VERSION MUST USE PROPER MARKDOWN SYNTAX:\n' +
      '   - Section headers MUST use ## (e.g., "## Baseboard Heater Solution")\n' +
      '   - Bold/emphasis MUST use single asterisks: *bold text* (NEVER double asterisks **)\n' +
      '   - Bullet points must use - or * list syntax\n' +
      '   - The markdown version must NOT be a plain text copy — it must be real, parseable markdown that renders correctly when pasted into any markdown editor\n' +
      '   - Include line breaks between sections for readability\n\n' +
      'When summarizing a client or project, cover all key data points: profile, notes, communications (with dates and subjects), tasks, opportunities, and custom fields. Prioritize the most meaningful details and always include dates. If data seems truncated, mention that more records may exist.\n\n' +
      'Be specific, reference real data, and be concise but thorough. If data is missing, say so honestly.\n\n' +
      (ctx.communicationChannel !== 'unknown'
        ? 'Current communication channel for this opportunity: ' + ctx.communicationChannel.toUpperCase() + ' (based on pipeline stage: ' + (ctx.pipelineStage || 'unknown') + ')\n'
        : '') +
      (ctx.jtJobId ? 'JobTread Job ID: ' + ctx.jtJobId + '\n' : '') +
      '\n--- BRAND VOICE & WRITING GUIDE (use when drafting emails, messages, or any written communication) ---\n' +
      getBrandVoicePrompt() + '\n';
  },

  tools: [],

  canHandle: (message: string) => {
    const lower = message.toLowerCase();
    // Very high for email/message drafting — this is Know-it-All's job
    if (/(write|draft|compose|send|create|prepare|put together).*(email|message|letter|response|reply|communication|note to)/i.test(lower)) return 0.95;
    if (/(email|message|letter|response|reply).*(to|for|about).*(client|customer)/i.test(lower)) return 0.95;
    // High for general research/lookup questions
    if (/\?|what|who|when|where|how|tell me|show me|summary|overview|status|history|latest|update|details|information|look up|find out|check on/i.test(lower)) return 0.8;
    // Medium for client/project context
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

    // Fetch JT job list (lightweight summary of all jobs)
    const jt = await fetchJTContext();
    if (jt) parts.push(jt);

    // Fetch JT comments & daily logs for the focused job (the detailed content)
    if (ctx.jtJobId) {
      const jtDetails = await fetchJTJobDetails(ctx.jtJobId);
      if (jtDetails) parts.push(jtDetails);
    }

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
