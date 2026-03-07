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
import {
  getAllOpenTasks,
  getTasksForJob,
  getJobSchedule,
  getMembers,
  getDocumentsForJob,
  getJob,
  getOpenTasksForMember,
  getApprovedDocuments,
  getDocumentContent,
  getFilesForJob,
  getDailyLogsForJob,
  getCostItemsForJob,
  getCostGroupsForJob,
  getCostCodes,
  getBillableDocuments,
  getSpecificationsForJob,
  getEventsForJob,
  getTimeEntriesForJob,
  getCommentsForTarget,
  getScheduleAudit,
  getGridScheduleData,
} from '@/app/lib/jobtread';
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
    // Inject current date/time so the agent knows what day it is
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateStr = dayName + ', ' + monthName + ' ' + now.getDate() + ', ' + now.getFullYear();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

    return 'You are "Know it All," the AI research assistant for Brett King Builder (BKB), a high-end residential renovation and historic home restoration company in Bucks County, PA.\n\n' +
      'CURRENT USER: The person chatting with you is NATHAN KING (not Brett King). When the user says "me", "myself", "I", or "my" — they mean Nathan King. Brett King is the company owner but is NOT the one using this tool. Always use "Nathan" (not "Brett") when referencing the current user in emails, summaries, or any content.\n\n' +
      'TODAY\'S DATE: ' + dateStr + ' (' + timeOfDay + '). ALWAYS use this as your reference for what is past, present, and future. Any date BEFORE today is in the PAST — say "was" not "is", "happened" not "upcoming". Any date AFTER today is in the FUTURE. For example, if today is March 6 2026 and you see a meeting on February 16 2026, that meeting ALREADY HAPPENED — never call it "upcoming." Also use the date when writing emails — never say "Hope you had a great weekend" on a Friday, or "Happy Monday" on a Wednesday. Match your greetings and references to the ACTUAL current day.\n\n' +
      'Your specialty is knowing EVERYTHING about every client and project. You pull data from Supabase (cached GHL/JT data) for comprehensive, fast lookups, with live API fallback.\n\n' +
      'IMPORTANT: You are the primary agent for DRAFTING CLIENT EMAILS AND COMMUNICATIONS.\n\n' +
      '=== EMAIL DRAFTING RULES (CRITICAL — READ CAREFULLY) ===\n' +
      'When the user asks you to write/draft/compose an email, you must write a COMPLETELY ORIGINAL email that sounds like Nathan King personally wrote it. Follow these rules:\n\n' +
      '1. NEVER COPY THE USER\'S BULLET POINTS OR INSTRUCTIONS VERBATIM. The user gives you topics and context — your job is to TRANSFORM that into a natural, conversational email in Nathan\'s voice.\n' +
      '2. USE THE BRAND VOICE & WRITING GUIDE BELOW. Nathan\'s emails are warm, direct, and confident. He uses casual-professional tone — like talking to a neighbor who happens to be a client. He says things like "Here\'s where we\'re at," "Let me walk you through," and "We\'ve got a solid plan." He does NOT sound robotic or formal.\n' +
      '3. ADD PERSONALITY AND WARMTH. Open with something personal or contextual (reference weather, season, project milestone, recent conversation). Close with enthusiasm about the project. Nathan genuinely cares about his clients and their homes — that comes through in every email.\n' +
      '4. REWRITE EVERY POINT IN YOUR OWN WORDS. If the user says "mention the baseboard heater issue," don\'t write "I wanted to discuss the baseboard heater issue." Instead, write something like "Good news on the heating front — we found a great solution for that baseboard situation in the master bedroom."\n' +
      '5. USE TRANSITIONS AND FLOW. Don\'t just list topics as separate paragraphs. Weave them together naturally. Use transitions like "On another note," "While we\'re at it," "Speaking of the kitchen," etc.\n' +
      '6. REFERENCE CLIENT HISTORY. Use the CRM data, notes, messages, and project details to personalize. Mention past conversations, previous decisions, or project milestones by name.\n' +
      '7. MATCH THE SITUATION\'S TONE. Use the Tone Calibration from the writing guide — exciting updates get enthusiasm, concerns get empathy and reassurance, routine updates are brief and breezy.\n' +
      '8. KEEP IT CONCISE BUT COMPLETE. Nathan doesn\'t write novels. Most emails are 3-5 short paragraphs. Get to the point with warmth.\n' +
      '9. NEVER USE EM DASHES (\u2014) OR EN DASHES (\u2013) IN EMAILS. Use a regular hyphen (-), a comma, or rewrite the sentence instead. This is a strict formatting rule with zero exceptions.\n\n' +
      'EMAIL OUTPUT FORMAT: Always provide the email TWICE:\n' +
      '1. First, show it in normal formatted text.\n' +
      '2. Then, below a "---" divider, show the SAME email inside a markdown code block (triple backticks with markdown language tag). THIS VERSION MUST USE PROPER MARKDOWN SYNTAX:\n' +
      '   - Section headers MUST use ## (e.g., "## Baseboard Heater Solution")\n' +
      '   - Bold/emphasis MUST use single asterisks: *bold text* (NEVER double asterisks **)\n' +
      '   - Bullet points must use - or * list syntax\n' +
      '   - Must be real, parseable markdown (NOT a plain text copy)\n' +
      '   - Include line breaks between sections for readability\n\n' +
      '=== JOBTREAD READ ACCESS (23 TOOLS) ===\n' +
      'You have comprehensive READ-ONLY tools for querying JobTread data:\n' +
      'JOBS & SEARCH:\n' +
      '- search_jobs — List all active jobs with IDs\n' +
      '- get_job_details — Full details for a specific job (jobId required)\n' +
      'TASKS & SCHEDULE:\n' +
      '- get_all_open_tasks — All incomplete tasks across ALL active jobs\n' +
      '- get_job_tasks — All tasks for a specific job\n' +
      '- get_member_tasks — Open tasks for a specific team member (membershipId required)\n' +
      '- get_job_schedule — Full phase/task hierarchy for a job\n' +
      '- get_schedule_audit — Schedule health check across all jobs\n' +
      '- get_grid_schedule — Gantt/grid view of all active job schedules\n' +
      'TEAM:\n' +
      '- get_members — List all team members with membership IDs\n' +
      'DOCUMENTS & FILES:\n' +
      '- get_job_documents — Documents (estimates, COs, invoices) for a job\n' +
      '- get_approved_documents — All approved documents across all jobs\n' +
      '- get_document_content — Line items and details of a specific document (documentId required)\n' +
      '- get_job_files — Uploaded files for a job\n' +
      '- get_billable_documents — Documents ready for billing\n' +
      'FINANCIAL:\n' +
      '- get_job_budget — Cost items/budget for a job\n' +
      '- get_cost_groups — Budget categories/groups for a job\n' +
      '- get_cost_codes — Organization-wide cost codes\n' +
      '- get_time_entries — Labor time entries for a job\n' +
      'ACTIVITY:\n' +
      '- get_job_daily_logs — Daily logs for a job\n' +
      '- get_job_comments — Comments/notes for a job\n' +
      '- get_job_events — Calendar events for a job\n' +
      'OTHER:\n' +
      '- get_specifications — Scope/specs for a job\n' +
      'USE THESE TOOLS when the user asks about tasks, schedules, team workload, documents, budgets, costs, files, or job details. Do NOT try to answer from context alone — call the tool to get fresh data.\n\n' +
      '=== CRITICAL: YOU CANNOT CREATE, UPDATE, OR DELETE JOBTREAD RECORDS ===\n' +
      'You have READ-ONLY access to JobTread. You CANNOT create tasks, update tasks, create daily logs, modify jobs, or make ANY changes in JobTread. If the user asks you to create a task, schedule something, or make a change in JobTread, you MUST say: "I can\'t modify JobTread directly — let me hand this off to the JT Entry Specialist. Could you rephrase your request so the system routes it to the right agent?" NEVER claim you have created, updated, or modified anything in JobTread. This is a zero-tolerance rule — fabricating confirmations of actions you did not take causes real business harm.\n\n' +
      'DOCUMENT ANALYSIS: Users may attach documents (contracts, change orders, proposals, budgets, vendor estimates, invoices, specs). The document content will appear in the message as "--- ATTACHED DOCUMENT: [filename] ---" blocks. When documents are attached, READ them thoroughly and reference their content when answering questions or drafting communications. Cite specific details from the documents (dollar amounts, dates, scope items, material specs) to show you\'ve analyzed them.\n\n' +
      'MATERIAL SPECIFICATION WRITING (CRITICAL — for vendor estimates, invoices, and material sign-off requests):\n' +
      'When the user uploads a vendor estimate/invoice and asks you to "write a material specification" or "write a spec" or requests a "material sign-off," you MUST extract the actual product details from the attached document and write a proper specification. DO NOT generate generic scope-of-work boilerplate.\n\n' +
      'For each area/location mentioned in the estimate, write a specification entry that includes:\n' +
      '- Product/Series name (e.g., "California-Slate," "Piazzo-Commune")\n' +
      '- Color/Finish (e.g., "Caramel Beige," "Satin")\n' +
      '- Size/Format (e.g., "12x24," "3x12," "1x4 Herringbone")\n' +
      '- Material type (e.g., "porcelain tile," "natural stone," "mosaic")\n' +
      '- Quantity and unit (e.g., "82.74 sqft," "38 sheets")\n' +
      '- Setting materials: grout color, caulk, trim, waterproofing, etc.\n' +
      '- Any threshold, transition, or accent pieces\n\n' +
      'MATERIAL SPEC FORMAT (follow this exactly):\n' +
      'Use markdown. Bold uses single asterisks *like this* (NEVER double asterisks). Organize by area.\n\n' +
      'Example output format:\n' +
      '## Material Specification — [Project Name] [Area]\n\n' +
      '*Area: Main Floor*\n' +
      '- Tile: [Manufacturer/Series], [Color], [Size], [finish]\n' +
      '- Quantity: [X] sqft\n' +
      '- Grout: [Brand], [Color]\n' +
      '- Layout: [pattern if specified]\n\n' +
      '*Area: Shower Walls*\n' +
      '- Tile: [Manufacturer/Series], [Color], [Size], [finish]\n' +
      '- Quantity: [X] sqft\n' +
      '- Grout: [Brand], [Color]\n\n' +
      'RULES:\n' +
      '- NEVER omit product names, colors, sizes, or quantities that appear in the vendor document.\n' +
      '- NEVER substitute generic descriptions (like "tile to be selected") when the vendor doc specifies exact products.\n' +
      '- NEVER mention the vendor/subcontractor name in the specification text.\n' +
      '- Include ALL setting materials (grout, caulk, trim, waterproofing, backer board, etc.).\n' +
      '- Include threshold/transition pieces if listed.\n' +
      '- If the estimate includes labor/installation as a line item, note it separately but do not include labor pricing in a "material only" spec unless asked.\n' +
      '- If the user says "material only sign-off," exclude labor/installation costs and focus on material selections and quantities.\n' +
      '- Always provide the spec TWICE: once formatted, and once in a markdown code block for easy copy/paste.\n\n' +
      'When summarizing a client or project, cover all key data points: profile, notes, communications (with dates and subjects), tasks, opportunities, and custom fields. Prioritize the most meaningful details and always include dates. If data seems truncated, mention that more records may exist.\n\n' +
      'Be specific, reference real data, and be concise but thorough. If data is missing, say so honestly.\n\n' +
      (ctx.communicationChannel !== 'unknown'
        ? 'Current communication channel for this opportunity: ' + ctx.communicationChannel.toUpperCase() + ' (based on pipeline stage: ' + (ctx.pipelineStage || 'unknown') + ')\n'
        : '') +
      (ctx.jtJobId ? 'JobTread Job ID: ' + ctx.jtJobId + '\n' : '') +
      '\n--- BRAND VOICE & WRITING GUIDE (use when drafting emails, messages, or any written communication) ---\n' +
      getBrandVoicePrompt() + '\n';
  },

  tools: [
    {
      name: 'get_all_open_tasks',
      description: 'Get all open (incomplete) tasks across ALL active jobs in JobTread. Returns task name, dates, progress, job name, and assigned team members.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_job_tasks',
      description: 'Get all tasks for a specific JobTread job. Returns task name, dates, progress, and assignees.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_job_schedule',
      description: 'Get the full phase/task hierarchy (schedule) for a specific job.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'search_jobs',
      description: 'Search for JobTread jobs. Returns active jobs with ID, number, name, and status.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_members',
      description: 'Get all team members in the JobTread organization with membership IDs.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_job_documents',
      description: 'Get documents (estimates, change orders, invoices) for a specific job.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_job_details',
      description: 'Get full details for a single job — name, number, status, client, location, description, custom fields, financials.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_member_tasks',
      description: 'Get all open tasks for a specific team member (by membership ID). Use get_members first to find the ID.',
      input_schema: { type: 'object', properties: { membershipId: { type: 'string', description: 'The membership ID' } }, required: ['membershipId'] },
    },
    {
      name: 'get_approved_documents',
      description: 'Get all approved documents across all jobs (estimates, COs, invoices).',
      input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max docs (default 100)' } }, required: [] },
    },
    {
      name: 'get_document_content',
      description: 'Get the full line items and content of a specific document (estimate, CO, invoice).',
      input_schema: { type: 'object', properties: { documentId: { type: 'string', description: 'The document ID' } }, required: ['documentId'] },
    },
    {
      name: 'get_job_files',
      description: 'Get all uploaded files for a job.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_job_daily_logs',
      description: 'Get all daily logs for a job. Daily logs track daily site activity.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_job_budget',
      description: 'Get cost items (budget line items) for a job. Use search to filter by keyword.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' }, search: { type: 'string', description: 'Optional keyword filter' } }, required: ['jobId'] },
    },
    {
      name: 'get_cost_codes',
      description: 'Get all cost codes in the organization (e.g., Electrical, Plumbing).',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_billable_documents',
      description: 'Get documents ready for billing across all jobs.',
      input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max docs (default 100)' } }, required: [] },
    },
    {
      name: 'get_time_entries',
      description: 'Get time entries (labor hours) for a specific job.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_cost_groups',
      description: 'Get cost groups (budget categories) for a job.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_specifications',
      description: 'Get the specifications (scope of work) for a job.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_job_events',
      description: 'Get calendar events for a job (meetings, site visits, inspections).',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_job_comments',
      description: 'Get all comments on a JobTread entity (job, task, document).',
      input_schema: { type: 'object', properties: { targetId: { type: 'string', description: 'ID of the entity' }, targetType: { type: 'string', description: '"job", "task", "document", "costItem"' } }, required: ['targetId', 'targetType'] },
    },
    {
      name: 'get_schedule_audit',
      description: 'Audit all active job schedules for issues — orphan tasks, missing dates, etc.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_grid_schedule',
      description: 'Get a grid/Gantt view of all active job schedules.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
  ],

  canHandle: (message: string) => {
    const lower = message.toLowerCase();
    // Documents should always come to Know-it-All for analysis & spec writing
    if (/--- ATTACHED DOCUMENT:/i.test(message)) return 0.95;
    // Spec writing from documents or general spec requests
    if (/(write|create|draft|generate).*(spec|specification|material)/i.test(lower)) return 0.92;
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

  executeTool: async (name: string, input: any, ctx: AgentContext) => {
    try {
      if (name === 'get_all_open_tasks') {
        const tasks = await getAllOpenTasks();
        if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No open tasks found.' });
        const lines = tasks.map((t: any) => {
          const status = t.progress >= 1 ? 'DONE' : t.progress > 0 ? 'IN PROGRESS' : 'NOT STARTED';
          const assigned = t.assignedMemberships?.nodes?.map((m: any) => m.user?.name || m.id).join(', ') || 'Unassigned';
          const job = t.job ? (t.job.name || t.job.id) : 'No job';
          return `- [${status}] "${t.name}" | Job: ${job} | Assigned: ${assigned} | Due: ${t.endDate || 'No date'} | Start: ${t.startDate || 'No date'}`;
        });
        return JSON.stringify({ success: true, count: tasks.length, tasks: lines.join('\n') });
      }

      if (name === 'get_job_tasks') {
        const tasks = await getTasksForJob(input.jobId);
        if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No tasks found.' });
        const lines = tasks.map((t: any) => {
          const status = t.progress >= 1 ? 'DONE' : t.progress > 0 ? 'IN PROGRESS' : 'NOT STARTED';
          return `- [${status}] "${t.name}" | Due: ${t.endDate || 'No date'} | Start: ${t.startDate || 'No date'}`;
        });
        return JSON.stringify({ success: true, count: tasks.length, tasks: lines.join('\n') });
      }

      if (name === 'get_job_schedule') {
        const schedule = await getJobSchedule(input.jobId);
        if (!schedule) return JSON.stringify({ success: true, message: 'No schedule found.' });
        // Format the schedule tree
        const formatNode = (node: any, depth = 0): string => {
          const indent = '  '.repeat(depth);
          const status = node.progress >= 1 ? 'DONE' : node.progress > 0 ? 'IN PROGRESS' : 'NOT STARTED';
          let line = `${indent}- [${status}] "${node.name}"`;
          if (node.endDate) line += ` | Due: ${node.endDate}`;
          if (node.startDate) line += ` | Start: ${node.startDate}`;
          if (node.children && node.children.length > 0) {
            line += '\n' + node.children.map((c: any) => formatNode(c, depth + 1)).join('\n');
          }
          return line;
        };
        const tree = Array.isArray(schedule) ? schedule : (schedule.children || [schedule]);
        const lines = tree.map((n: any) => formatNode(n));
        return JSON.stringify({ success: true, schedule: lines.join('\n') });
      }

      if (name === 'search_jobs') {
        const jobs = await getActiveJobs(50);
        if (!jobs || jobs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No active jobs found.' });
        const lines = (jobs as any[]).map((j: any) => `- #${j.number || '?'} "${j.name}" | ID: ${j.id} | Status: ${j.status || 'N/A'}`);
        return JSON.stringify({ success: true, count: jobs.length, jobs: lines.join('\n') });
      }

      if (name === 'get_members') {
        const members = await getMembers();
        if (!members || members.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No members found.' });
        const lines = members.map((m: any) => `- ${m.user?.name || 'Unknown'} | Membership ID: ${m.id}`);
        return JSON.stringify({ success: true, count: members.length, members: lines.join('\n') });
      }

      if (name === 'get_job_documents') {
        const docs = await getDocumentsForJob(input.jobId);
        if (!docs || docs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No documents found.' });
        const lines = (docs as any[]).map((d: any) => {
          const status = d.status || 'N/A';
          const total = d.total !== undefined ? `$${Number(d.total).toLocaleString()}` : 'N/A';
          return `- "${d.name || 'Untitled'}" | Type: ${d.type || 'N/A'} | Status: ${status} | Total: ${total}`;
        });
        return JSON.stringify({ success: true, count: docs.length, documents: lines.join('\n') });
      }

      if (name === 'get_job_details') {
        const job = await getJob(input.jobId);
        if (!job) return JSON.stringify({ success: false, error: 'Job not found: ' + input.jobId });
        return JSON.stringify({ success: true, job });
      }

      if (name === 'get_member_tasks') {
        const tasks = await getOpenTasksForMember(input.membershipId);
        if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No open tasks for this member.' });
        const lines = tasks.map((t: any) => {
          const status = t.progress >= 1 ? 'DONE' : t.progress > 0 ? 'IN PROGRESS' : 'NOT STARTED';
          const job = t.job ? (t.job.name || t.job.id) : 'No job';
          return `- [${status}] "${t.name}" | Job: ${job} | Due: ${t.endDate || 'No date'}`;
        });
        return JSON.stringify({ success: true, count: tasks.length, tasks: lines.join('\n') });
      }

      if (name === 'get_approved_documents') {
        const docs = await getApprovedDocuments();
        if (!docs || docs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No approved documents found.' });
        const lines = (docs as any[]).map((d: any) => {
          const total = d.total !== undefined ? `$${Number(d.total).toLocaleString()}` : 'N/A';
          const job = d.job ? (d.job.name || d.job.id) : 'No job';
          return `- "${d.name || 'Untitled'}" | Type: ${d.type || 'N/A'} | Total: ${total} | Job: ${job}`;
        });
        return JSON.stringify({ success: true, count: docs.length, documents: lines.join('\n') });
      }

      if (name === 'get_document_content') {
        const content = await getDocumentContent(input.documentId);
        if (!content) return JSON.stringify({ success: false, error: 'Document not found or empty.' });
        return JSON.stringify({ success: true, content });
      }

      if (name === 'get_job_files') {
        const files = await getFilesForJob(input.jobId);
        if (!files || files.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No files found.' });
        const lines = (files as any[]).map((f: any) => `- "${f.name || 'Untitled'}" | Type: ${f.contentType || 'N/A'} | Uploaded: ${f.createdAt || 'N/A'}`);
        return JSON.stringify({ success: true, count: files.length, files: lines.join('\n') });
      }

      if (name === 'get_job_daily_logs') {
        const logs = await getDailyLogsForJob(input.jobId);
        if (!logs || logs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No daily logs found.' });
        const lines = (logs as any[]).map((l: any) => {
          const author = l.createdByMembership?.user?.name || 'Unknown';
          return `- ${l.date || 'No date'} by ${author}: ${l.notes || '(no notes)'}`;
        });
        return JSON.stringify({ success: true, count: logs.length, logs: lines.join('\n') });
      }

      if (name === 'get_job_budget') {
        const items = await getCostItemsForJob(input.jobId);
        if (!items || items.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No cost items found.' });
        return JSON.stringify({ success: true, count: items.length, costItems: items });
      }

      if (name === 'get_cost_codes') {
        const codes = await getCostCodes();
        if (!codes || codes.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No cost codes found.' });
        const lines = (codes as any[]).map((c: any) => `- ${c.name} (${c.code || 'N/A'}) | ID: ${c.id}`);
        return JSON.stringify({ success: true, count: codes.length, codes: lines.join('\n') });
      }

      if (name === 'get_billable_documents') {
        const docs = await getBillableDocuments();
        if (!docs || docs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No billable documents found.' });
        const lines = (docs as any[]).map((d: any) => {
          const total = d.total !== undefined ? `$${Number(d.total).toLocaleString()}` : 'N/A';
          const job = d.job ? (d.job.name || d.job.id) : 'No job';
          return `- "${d.name || 'Untitled'}" | Total: ${total} | Job: ${job}`;
        });
        return JSON.stringify({ success: true, count: docs.length, documents: lines.join('\n') });
      }

      if (name === 'get_time_entries') {
        const entries = await getTimeEntriesForJob(input.jobId);
        if (!entries || entries.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No time entries found.' });
        return JSON.stringify({ success: true, count: entries.length, entries });
      }

      if (name === 'get_cost_groups') {
        const groups = await getCostGroupsForJob(input.jobId);
        if (!groups || groups.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No cost groups found.' });
        return JSON.stringify({ success: true, count: groups.length, groups });
      }

      if (name === 'get_specifications') {
        const specs = await getSpecificationsForJob(input.jobId);
        if (!specs || specs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No specifications found.' });
        return JSON.stringify({ success: true, count: specs.length, specifications: specs });
      }

      if (name === 'get_job_events') {
        const events = await getEventsForJob(input.jobId);
        if (!events || events.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No events found.' });
        return JSON.stringify({ success: true, count: events.length, events });
      }

      if (name === 'get_job_comments') {
        const comments = await getCommentsForTarget(input.jobId);
        if (!comments || comments.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No comments found.' });
        const lines = (comments as any[]).map((c: any) => {
          const author = c.createdByMembership?.user?.name || 'Unknown';
          return `- ${c.createdAt || 'No date'} by ${author}: ${c.message || '(no message)'}`;
        });
        return JSON.stringify({ success: true, count: comments.length, comments: lines.join('\n') });
      }

      if (name === 'get_schedule_audit') {
        const audit = await getScheduleAudit();
        if (!audit) return JSON.stringify({ success: true, message: 'No schedule audit data.' });
        return JSON.stringify({ success: true, audit });
      }

      if (name === 'get_grid_schedule') {
        const grid = await getGridScheduleData();
        if (!grid) return JSON.stringify({ success: true, message: 'No grid schedule data.' });
        return JSON.stringify({ success: true, grid });
      }

      return JSON.stringify({ error: 'Unknown tool: ' + name });
    } catch (err) {
      return JSON.stringify({ error: 'Tool failed: ' + (err instanceof Error ? err.message : String(err)) });
    }
  },
};

export default knowItAll;
