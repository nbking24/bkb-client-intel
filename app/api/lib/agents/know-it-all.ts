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
import { getCalendarEvents as getGHLCalendarEvents, getCalendars as getGHLCalendars, syncGHLMeetingsToJT } from '@/app/lib/ghl';
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
  createTask,
  updateTaskProgress,
  updateTask,
  updateTaskFull,
  deleteJTTask,
  createPhaseGroup,
  createPhaseTask,
  applyStandardTemplate,
  moveTaskToPhase,
  createDailyLog,
  updateDailyLog,
  deleteDailyLog,
  createComment,
  updateJob,
  updateCostGroup,
  applyPhaseDefaults,
  getCommentsFromDB,
  getDailyLogsFromDB,
  createCommentWithCache,
  createDailyLogWithCache,
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

  systemPrompt: (ctx: AgentContext, userMessage?: string) => {
    // Detect if this query needs email/writing capabilities
    const msg = (userMessage || '').toLowerCase();
    const isEmailQuery = /email|draft|compose|write.*to|message.*to|letter|communicate|outreach|follow.?up.*with|spec.*sign|material.*spec|sign.?off/i.test(msg);

    // Inject current date/time in Eastern Time so the agent knows what day it is
    const now = new Date();
    const etOptions: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const etDateStr = now.toLocaleDateString('en-US', etOptions);
    // Also get the YYYY-MM-DD in ET for unambiguous reference
    const etShort = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // en-CA gives YYYY-MM-DD
    const etHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
    const timeOfDay = etHour < 12 ? 'morning' : etHour < 17 ? 'afternoon' : 'evening';

    // Build a 14-day reference calendar so the AI never gets day-of-week wrong
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const calendarLines: string[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() + i * 86400000);
      const dayStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const dayName = days[new Date(dayStr + 'T12:00:00').getDay()];
      calendarLines.push(dayName + ' = ' + dayStr);
    }
    const calendarRef = calendarLines.join(', ');

    // === BUILD SYSTEM PROMPT — lean for data queries, full for email/writing ===
    const base =
      'You are "Know it All," the AI assistant for Brett King Builder (BKB), a high-end residential renovation company in Bucks County, PA.\n\n' +
      'CURRENT USER: NATHAN KING (not Brett King). "me"/"I"/"my" = Nathan King.\n\n' +
      'TODAY: ' + etDateStr + ' (' + etShort + ', ' + timeOfDay + ' ET). Dates BEFORE today are PAST. Dates AFTER today are FUTURE.\n' +
      'DATE REFERENCE: ' + calendarRef + '\n' +
      'ALWAYS use this reference when converting day names (e.g. "next Wednesday") to YYYY-MM-DD dates. Do NOT calculate dates in your head.\n\n' +
      '=== JOB FOCUS (CRITICAL) ===\n' +
      (ctx.jtJobId
        ? 'A SPECIFIC JOB IS SELECTED (Job ID: ' + ctx.jtJobId + '). ALL queries MUST be scoped to THIS job ONLY unless the user explicitly asks about other jobs or all jobs.\n' +
          '- "open tasks" / "what tasks are open" → get_job_tasks with jobId=' + ctx.jtJobId + '. Do NOT use get_all_open_tasks.\n' +
          '- "budget" / "what was ordered" → get_job_budget with jobId=' + ctx.jtJobId + '.\n' +
          '- "schedule" / "what\'s the timeline" → get_job_schedule with jobId=' + ctx.jtJobId + '.\n' +
          '- "documents" / "invoices" → get_job_documents with jobId=' + ctx.jtJobId + '.\n' +
          '- "daily logs" → get_job_daily_logs with jobId=' + ctx.jtJobId + '.\n' +
          '- Any job-specific tool → ALWAYS pass jobId=' + ctx.jtJobId + '.\n' +
          'ONLY use cross-job tools (get_all_open_tasks, search_jobs, get_approved_documents, etc.) if the user EXPLICITLY asks about "all jobs", "across jobs", or references a DIFFERENT job.\n\n'
        : 'No specific job is selected. Use cross-job tools like get_all_open_tasks, search_jobs, etc.\n' +
          'If the user references a specific job by name or number, search_jobs first to find the ID, then use job-specific tools.\n\n') +
      '=== TOOL USAGE (CRITICAL) ===\n' +
      'You operate under a strict time budget. ALWAYS prefer the SINGLE most efficient tool:\n' +
      (ctx.jtJobId
        ? '- "list open tasks" → get_job_tasks with jobId (scoped to selected job).\n'
        : '- "list open tasks" → get_all_open_tasks (ONE call). NEVER loop through jobs.\n') +
      '- "active jobs" → search_jobs (ONE call).\n' +
      '- "tasks for [person]" → get_member_tasks (ONE call).\n' +
      '- NEVER make more than 2 tool calls for a simple query.\n' +
      '- Present results IMMEDIATELY after tool call. No "Let me check..." filler.\n\n' +
      '=== RESPONSE STYLE (CRITICAL) ===\n' +
      'For READ queries (lookups, "is there a task...", "show me...", "what is the status of..."), answer the question DIRECTLY. ' +
      'Do NOT offer multiple options or ask what the user wants to do next. Do NOT ask "Would you like me to..." after a simple lookup. ' +
      'If a schedule is empty or a task does not exist, just say so clearly. ' +
      'Only ask clarifying questions if the user\'s intent is genuinely ambiguous (e.g., multiple matching jobs).\n' +
      'Keep answers concise — 2-4 sentences for simple lookups. No walls of text.\n\n' +
      'WRITE OPERATIONS: ALWAYS confirm with user before any create/update/delete.\n\n' +
      'TEAM: Nathan King, Terri Dalavai, David Steich, Evan Harrington, John Molnar, Karen Molnar, Chrissy Zajick\n\n' +
      'BKB 9-PHASE SCHEDULE: 1.Admin 2.Concept 3.Design Development 4.Contract 5.Pre-Construction 6.Production 7.Inspections 8.Punch/Closeout 9.Project Closeout\n\n' +
      '=== SELECTIONS & ORDERING STATUS ===\n' +
      'Cost items in JobTread have custom fields tracking selection/ordering status:\n' +
      '- Status: e.g. "Ordered/Finalized", "Internal Selection Needed", "Pricing/Agreement Pending", etc.\n' +
      '- Vendor: which vendor/supplier the item is ordered from (e.g. Build.com, Ferguson)\n' +
      '- Internal Notes: details like order numbers, shipping info, who it was sent to\n' +
      'When asked "was X ordered?", "what is the status of the mirror?", "where was X ordered from?", etc.:\n' +
      '  → Use get_job_budget with a search keyword matching the item name.\n' +
      '  → The response includes {Status:}, {Vendor:}, and {Notes:} fields for each cost item.\n' +
      '  → Answer directly from these fields. "Ordered/Finalized" means the item has been ordered.\n\n' +
      '=== SCHEDULE & CALENDAR (CRITICAL) ===\n' +
      'TWO calendars exist: JobTread (construction tasks/milestones) and GHL/GoHighLevel (client meetings/appointments).\n' +
      'GHL is the SOURCE OF TRUTH for client meetings, consultations, site visits, and appointments.\n' +
      'JobTread schedule tracks construction tasks, phases, and crew work — NOT client meetings.\n' +
      'When asked about "schedule", "meetings", "appointments", "what\'s coming up", or "client calendar":\n' +
      '  1. ALWAYS call get_ghl_calendar for client-facing appointments\n' +
      '  2. Call get_job_schedule or get_all_open_tasks for construction task deadlines\n' +
      '  3. Present BOTH sources clearly labeled (GHL Appointments + JT Tasks)\n' +
      'For date ranges, use Eastern Time (ET). Default range if not specified: today through 14 days out.\n' +
      'MEETING SYNC: Use sync_ghl_meetings_to_jt to push GHL appointments into JobTread as tasks.\n' +
      'This runs automatically each morning at 5 AM, but can also be triggered on-demand.\n' +
      'Synced tasks are prefixed with 📅 and include meeting details in the description.\n\n';

    // Task creation rules (always needed for write operations)
    const taskRules =
      '=== TASK CREATION (MANDATORY CONFIRMATION — NO EXCEPTIONS) ===\n' +
      'TASK NAMING: Max 5-8 words. Details go in description.\n' +
      'PHASE ASSIGNMENT: Every task MUST go under a phase. Call get_job_schedule first to get phase IDs.\n\n' +
      'CRITICAL RULE: You MUST NEVER call create_phase_task or create_jobtread_task directly.\n' +
      'ALWAYS output a @@TASK_CONFIRM@@ block FIRST and STOP. Wait for user approval.\n' +
      'The user will see an editable confirmation card where they can change the phase, assignee, dates, etc.\n' +
      'Only after receiving [APPROVED TASK DATA] should the task be created.\n\n' +
      'STEP 1 — Look up the schedule: Call get_job_schedule to find available phases and their IDs.\n' +
      'STEP 2 — Output the confirmation block (then STOP — do NOT call any create tool):\n' +
      '@@TASK_CONFIRM@@\n' +
      '{"name":"short name","phase":"Phase Name","phaseId":"id","jobId":"the-job-id","description":"details","assignee":"Name","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}\n' +
      '@@END_CONFIRM@@\n' +
      'DATE RULES: New tasks are ALWAYS 1-day tasks. Set BOTH startDate AND endDate to the SAME date.\n' +
      'If the user says "due Friday" or gives any single date, set both to that date. NEVER leave startDate empty.\n' +
      'EDIT RULES: When rescheduling/moving a task to a new date, ONLY set startDate to the new date.\n' +
      'Do NOT set endDate — the system will automatically preserve the task\'s existing duration.\n' +
      'Only set endDate explicitly if the user specifically asks to change the due date or duration.\n' +
      'IMPORTANT: Always include the jobId from the get_job_schedule call in the confirmation block.\n' +
      'STEP 3 — After the user approves with [APPROVED TASK DATA], call create_phase_task.\n' +
      'Field mapping: name→name, phaseId→parentGroupId, assignee→assignTo. Set durationDays=1.\n\n' +
      'VIOLATIONS: If you call create_phase_task or create_jobtread_task without [APPROVED TASK DATA] in the conversation, the tool will REJECT the call.\n\n';

    // Email/writing rules — ONLY included for email-related queries
    const emailRules = isEmailQuery ? (
      '=== EMAIL DRAFTING RULES ===\n' +
      'Write COMPLETELY ORIGINAL emails in Nathan\'s voice. NEVER copy user bullet points verbatim.\n' +
      'Tone: warm, direct, casual-professional. Like talking to a neighbor who is a client.\n' +
      'Phrases Nathan uses: "Here\'s where we\'re at," "Let me walk you through," "We\'ve got a solid plan."\n' +
      'Add personality/warmth. Reference client history from CRM data. Keep 3-5 short paragraphs.\n' +
      'NEVER use em dashes or en dashes. Use hyphens, commas, or rewrite.\n' +
      'Provide email TWICE: formatted text, then markdown code block.\n\n' +
      'MATERIAL SPEC WRITING: Extract real product details from attached documents. Include product name, color, size, quantity, setting materials. Organize by area. Never omit specifics.\n\n' +
      '--- BRAND VOICE & WRITING GUIDE ---\n' +
      getBrandVoicePrompt() + '\n\n'
    ) : '';

    // Document analysis (only if message has attachment markers or is email-related)
    const docRules = (isEmailQuery || msg.includes('attached') || msg.includes('document') || msg.includes('pdf')) ?
      'DOCUMENT ANALYSIS: Attached documents appear as "--- ATTACHED DOCUMENT: [filename] ---" blocks. Read thoroughly and cite specific details.\n\n' : '';

    return base + taskRules + emailRules + docRules +
      (ctx.communicationChannel !== 'unknown'
        ? 'Communication channel: ' + ctx.communicationChannel.toUpperCase() + '\n'
        : '');
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
      description: 'Get cost items (budget line items) for a job, including selection status (ordered, finalized, pending), vendor, and internal notes. Use search to filter by keyword — also searches status and vendor fields. Use this when asked about selections, ordering status, materials, or what has been ordered/finalized.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' }, search: { type: 'string', description: 'Optional keyword filter (searches name, description, cost code, group, status, vendor)' } }, required: ['jobId'] },
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
    {
      name: 'get_ghl_calendar',
      description: 'Get client meetings and appointments from GoHighLevel (GHL) CRM calendar. This is the SOURCE OF TRUTH for client meetings, consultations, and site visits. Use this for any schedule/calendar/meeting/appointment question. Dates should be ISO-8601 format (e.g. 2026-03-10T00:00:00-05:00).',
      input_schema: {
        type: 'object',
        properties: {
          startTime: { type: 'string', description: 'Start of date range in ISO-8601 format (e.g. 2026-03-10T00:00:00-05:00)' },
          endTime: { type: 'string', description: 'End of date range in ISO-8601 format (e.g. 2026-03-17T23:59:59-05:00)' },
          calendarId: { type: 'string', description: 'Optional: filter to a specific calendar ID' },
        },
        required: ['startTime', 'endTime'],
      },
    },
    {
      name: 'get_ghl_calendars_list',
      description: 'List all available calendars in GHL. Use this to find calendar IDs when filtering events.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'sync_ghl_meetings_to_jt',
      description: 'Sync GHL client meetings/appointments into JobTread as tasks. Pulls upcoming GHL appointments, matches contacts to active JT jobs by client name, and creates tasks for any new meetings. Use when asked to "sync meetings", "push meetings to JobTread", or "update JT with GHL appointments". Also runs automatically each morning via cron.',
      input_schema: {
        type: 'object',
        properties: {
          daysAhead: { type: 'number', description: 'How many days ahead to sync (default: 30)' },
          dryRun: { type: 'boolean', description: 'If true, shows what would be synced without actually creating tasks' },
        },
        required: [],
      },
    },
    {
      name: 'create_jobtread_task',
      description: 'Create a new task in JobTread for the selected job/project. Optionally assign to a team member.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID. Use the one from context if available.' },
          name: { type: 'string', description: 'The task title/name' },
          description: { type: 'string', description: 'Detailed description of the task' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format (optional)' },
          endDate: { type: 'string', description: 'Due/end date in YYYY-MM-DD format (optional)' },
          assignTo: { type: 'string', description: 'Name of the team member to assign this task to (optional). Use full or partial name.' },
        },
        required: ['jobId', 'name'],
      },
    },
    {
      name: 'update_task_progress',
      description: 'Update the progress of a task. 0 = not started, 0.5 = in progress, 1 = complete. Use this to mark tasks done or in progress.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID to update' },
          progress: { type: 'number', description: '0 = not started, 0.5 = in progress, 1 = complete' },
        },
        required: ['taskId', 'progress'],
      },
    },
    {
      name: 'update_task',
      description: 'Update a task\'s details — name, start date, end date (due date), description, or progress. Use this when the user wants to change/reschedule a task date, rename a task, or update any task field.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID to update. Use get_job_tasks or get_job_schedule first to find the ID.' },
          name: { type: 'string', description: 'New task name (optional)' },
          startDate: { type: 'string', description: 'New start date in YYYY-MM-DD format (optional)' },
          endDate: { type: 'string', description: 'New end/due date in YYYY-MM-DD format (optional)' },
          description: { type: 'string', description: 'New description (optional)' },
          progress: { type: 'number', description: '0 = not started, 0.5 = in progress, 1 = complete (optional)' },
        },
        required: ['taskId'],
      },
    },
    {
      name: 'delete_task',
      description: 'Delete a task from JobTread. ALWAYS confirm with the user before executing this.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID to delete' },
        },
        required: ['taskId'],
      },
    },
    {
      name: 'create_phase',
      description: 'Create a new phase (task group) on a job schedule. Phases organize tasks into logical groups like "Design", "Production", etc.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          name: { type: 'string', description: 'Phase name (e.g. "Design Development", "Production")' },
          startDate: { type: 'string', description: 'Phase start date in YYYY-MM-DD format (optional)' },
        },
        required: ['jobId', 'name'],
      },
    },
    {
      name: 'create_phase_task',
      description: 'Create a task within a specific phase (task group). The task will appear under the named phase.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          parentGroupId: { type: 'string', description: 'The phase/task group ID to add the task under' },
          name: { type: 'string', description: 'Task name' },
          description: { type: 'string', description: 'Task description (optional)' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format (optional)' },
          endDate: { type: 'string', description: 'Due/end date in YYYY-MM-DD format (optional)' },
          durationDays: { type: 'number', description: 'Duration in days (optional, default 1)' },
          assignTo: { type: 'string', description: 'Team member name for assignment (optional)' },
        },
        required: ['jobId', 'parentGroupId', 'name'],
      },
    },
    {
      name: 'apply_standard_template',
      description: 'Apply the BKB 9-phase standard template to a job. Creates phases: Admin, Concept, Design Development, Contract, Pre-Construction, Production, Inspections, Punch/Closeout, Project Closeout. WARN the user this creates multiple phases and tasks.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID to apply the template to' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'move_task_to_phase',
      description: 'Move a task from one phase to another. Note: this deletes and recreates the task under the new phase.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID to move' },
          targetPhaseId: { type: 'string', description: 'The target phase/task group ID' },
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['taskId', 'targetPhaseId', 'jobId'],
      },
    },
    {
      name: 'create_daily_log',
      description: 'Create a new daily log entry for a job. Records daily site activity, notes, and optionally assigns crew members.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format. Defaults to today if not specified.' },
          notes: { type: 'string', description: 'Daily log notes — what happened on site, crew activity, issues, etc.' },
          dailyLogType: { type: 'string', description: 'Type of daily log. Options: "Change Order", "Projects Review Meeting", "Client Meeting", "Receipts", "Other". Defaults to "Other" if not specified.' },
          assignTo: { type: 'string', description: 'Comma-separated team member names to assign to this log (optional)' },
          notify: { type: 'boolean', description: 'Whether to notify assigned members (default false)' },
        },
        required: ['jobId', 'notes'],
      },
    },
    {
      name: 'update_daily_log',
      description: 'Update an existing daily log — change the notes or date.',
      input_schema: {
        type: 'object',
        properties: {
          logId: { type: 'string', description: 'The daily log ID to update' },
          notes: { type: 'string', description: 'Updated notes (optional)' },
          date: { type: 'string', description: 'Updated date in YYYY-MM-DD format (optional)' },
        },
        required: ['logId'],
      },
    },
    {
      name: 'delete_daily_log',
      description: 'Delete a daily log entry. Always confirm with the user before executing.',
      input_schema: {
        type: 'object',
        properties: {
          logId: { type: 'string', description: 'The daily log ID to delete' },
        },
        required: ['logId'],
      },
    },
    {
      name: 'create_comment',
      description: 'Add a comment to any JobTread entity (job, task, document, etc.). Comments support replies and pinning.',
      input_schema: {
        type: 'object',
        properties: {
          targetId: { type: 'string', description: 'ID of the entity to comment on (job ID, task ID, etc.)' },
          targetType: { type: 'string', description: 'Type of entity: "job", "task", "document", "costItem"' },
          message: { type: 'string', description: 'The comment text' },
          assignTo: { type: 'string', description: 'Comma-separated team member names to notify (optional)' },
          isPinned: { type: 'boolean', description: 'Pin this comment to the top (optional)' },
          parentCommentId: { type: 'string', description: 'ID of parent comment if this is a reply (optional)' },
        },
        required: ['targetId', 'targetType', 'message'],
      },
    },
    {
      name: 'get_comments',
      description: 'Get all comments on a JobTread entity (job, task, document, etc.).',
      input_schema: {
        type: 'object',
        properties: {
          targetId: { type: 'string', description: 'ID of the entity (job ID, task ID, etc.)' },
          targetType: { type: 'string', description: 'Type of entity: "job", "task", "document", "costItem"' },
        },
        required: ['targetId', 'targetType'],
      },
    },
    {
      name: 'update_job',
      description: 'Update a job\'s details — name, description, specifications description, specifications footer, or close/reopen the job.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          name: { type: 'string', description: 'New job name (optional)' },
          description: { type: 'string', description: 'New job description (optional)' },
          specificationsDescription: { type: 'string', description: 'Job specifications description text (optional)' },
          specificationsFooter: { type: 'string', description: 'Job specifications footer text (optional)' },
          closedOn: { type: 'string', description: 'Date to close the job (YYYY-MM-DD) or null to reopen (optional)' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'update_task_full',
      description: 'Advanced task update — change assignees, time of day, parent phase, and all standard fields. Use this when the user wants to reassign a task or change time-specific details.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID to update' },
          name: { type: 'string', description: 'New task name (optional)' },
          description: { type: 'string', description: 'New description (optional)' },
          startDate: { type: 'string', description: 'New start date YYYY-MM-DD (optional)' },
          endDate: { type: 'string', description: 'New end date YYYY-MM-DD (optional)' },
          startTime: { type: 'string', description: 'Start time HH:MM (optional)' },
          endTime: { type: 'string', description: 'End time HH:MM (optional)' },
          progress: { type: 'number', description: '0=not started, 0.5=in progress, 1=complete (optional)' },
          assignTo: { type: 'string', description: 'Comma-separated team member names to reassign task to (optional). Replaces current assignees.' },
        },
        required: ['taskId'],
      },
    },
    {
      name: 'update_cost_group',
      description: 'Update a cost group — change its name, markup percentage, or tax settings. Always confirm before executing.',
      input_schema: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: 'The cost group ID to update' },
          name: { type: 'string', description: 'New name (optional)' },
          markupPercent: { type: 'number', description: 'New markup percentage (optional)' },
          isTaxable: { type: 'boolean', description: 'Whether items in this group are taxable (optional)' },
        },
        required: ['groupId'],
      },
    },
    {
      name: 'apply_phase_defaults',
      description: 'Apply the standard phase template to a job that already has tasks. Creates any missing standard phases and optionally moves orphan tasks into appropriate phases. Always confirm before executing.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          moveOrphans: { type: 'boolean', description: 'Whether to auto-move orphan tasks into appropriate phases (default false)' },
        },
        required: ['jobId'],
      },
    },
  ],

  canHandle: (message: string) => {
    const lower = message.toLowerCase();
    // Documents should always come here for analysis & spec writing
    if (/--- ATTACHED DOCUMENT:/i.test(message)) return 0.95;
    // Spec writing from documents or general spec requests
    if (/(write|create|draft|generate).*(spec|specification|material)/i.test(lower)) return 0.92;
    // Very high for email/message drafting
    if (/(write|draft|compose|send|create|prepare|put together).*(email|message|letter|response|reply|communication|note to)/i.test(lower)) return 0.95;
    if (/(email|message|letter|response|reply).*(to|for|about).*(client|customer)/i.test(lower)) return 0.95;
    // Very high for explicit task/JT operations (formerly jt-entry patterns)
    if (/create.*task|add.*task|schedule.*task|new.*task|make.*task/i.test(lower)) return 0.95;
    if (/(create|add|update|edit|delete|remove|schedule|assign|change|modify).*(jobtread|job\s*tread|budget|comment|item|phase)/i.test(lower)) return 0.95;
    // Selections, ordering status, materials ordering
    if (/(order|ordered|finalized|selection|selected|vendor|where.*order|was.*order|has.*been.*order|material.*status|fixture)/i.test(lower)) return 0.9;
    if (/(update|change|move|reschedule|push|set|adjust).*(task|date|due|deadline|end date|start date|schedule)/i.test(lower)) return 0.95;
    if (/mark.*(complete|done|finished|progress)|complete.*task|finish.*task|update.*progress/i.test(lower)) return 0.9;
    if (/apply.*template|standard.*template|create.*phase|add.*phase/i.test(lower)) return 0.9;
    if (/(create|add|write|log|new).*(daily.*log|daily.*report|site.*log|field.*report)/i.test(lower)) return 0.95;
    // Calendar, meetings, appointments — always use Know-it-All for GHL calendar access
    if (/\b(meeting|appointment|consult|site visit|calendar|what.*coming up|what.*scheduled|schedule.*this week|schedule.*today|schedule.*tomorrow|client.*schedule|sync.*meeting|push.*meeting|sync.*calendar)\b/i.test(lower)) return 0.9;
    if (/(add|create|post|write|leave).*(comment|note)/i.test(lower)) return 0.9;
    if (/(update|change|edit|modify|close|reopen).*(job|project)/i.test(lower)) return 0.9;
    if (/(reassign|assign.*to|change.*assign)/i.test(lower)) return 0.9;
    if (/move.*task|delete.*task|remove.*task/i.test(lower)) return 0.85;
    // High for general research/lookup questions
    if (/\?|what|who|when|where|how|tell me|show me|summary|overview|status|history|latest|update|details|information|look up|find out|check on/i.test(lower)) return 0.8;
    // Medium for client/project context
    if (/client|project|job|contact|note|message|communication/i.test(lower)) return 0.5;
    // Medium for general CRUD verbs
    if (/create|add|schedule|update|edit|delete|assign|move|apply|change|modify|rename|reschedule/i.test(lower)) return 0.5;
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
        // When a specific job is selected, auto-scope to that job instead of ALL jobs
        if (ctx.jtJobId) {
          const tasks = await getTasksForJob(ctx.jtJobId);
          if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No open tasks found for this job.' });
          const lines = tasks.map((t: any) => {
            const status = t.progress >= 1 ? 'DONE' : t.progress > 0 ? 'IN PROGRESS' : 'NOT STARTED';
            return `- [${status}] "${t.name}" | Due: ${t.endDate || 'No date'} | Start: ${t.startDate || 'No date'}`;
          });
          return JSON.stringify({ success: true, count: tasks.length, scopedToJob: true, tasks: lines.join('\n') });
        }
        const tasks = await getAllOpenTasks();
        if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No open tasks found.' });
        // Compact format to reduce token count
        const lines = tasks.map((t: any) => {
          const pct = Math.round((t.progress || 0) * 100);
          const assigned = t.assignedMemberships?.nodes?.map((m: any) => m.user?.name || '?').join('/') || '-';
          const job = t.job?.name || '-';
          return `${t.name} | ${job} | ${assigned} | ${pct}% | ${t.endDate || '-'}`;
        });
        return JSON.stringify({ count: tasks.length, tasks: lines.join('\n') });
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
        // Format the schedule tree using phases → childTasks.nodes hierarchy
        const lines: string[] = [];
        lines.push('Job: #' + (schedule.number || '?') + ' ' + schedule.name);
        lines.push('Overall Progress: ' + Math.round((schedule.totalProgress || 0) * 100) + '%');

        for (const phase of schedule.phases || []) {
          lines.push('');
          const phaseStatus = phase.progress >= 1 ? 'DONE' : phase.progress > 0 ? 'IN PROGRESS' : 'NOT STARTED';
          lines.push(`[${phaseStatus}] Phase: "${phase.name}" (ID: ${phase.id}) — ${Math.round((phase.progress || 0) * 100)}% complete`);
          const phaseTasks = phase.childTasks?.nodes || [];
          const taskList = Array.isArray(phaseTasks) ? phaseTasks : [];
          for (const task of taskList) {
            const status = task.progress >= 1 ? 'DONE' : task.progress > 0 ? 'IN PROGRESS' : 'NOT STARTED';
            const dates = [task.startDate, task.endDate].filter(Boolean).join(' → ');
            lines.push(`  - [${status}] "${task.name}" (ID: ${task.id})${dates ? ' (' + dates + ')' : ''}`);
          }
        }

        // Show orphan tasks (tasks not in any phase)
        if (schedule.orphanTasks && schedule.orphanTasks.length > 0) {
          lines.push('');
          lines.push('Tasks Not In Any Phase:');
          for (const task of schedule.orphanTasks) {
            const status = task.progress >= 1 ? 'DONE' : task.progress > 0 ? 'IN PROGRESS' : 'NOT STARTED';
            const dates = [task.startDate, task.endDate].filter(Boolean).join(' → ');
            lines.push(`  - [${status}] "${task.name}" (ID: ${task.id})${dates ? ' (' + dates + ')' : ''}`);
          }
        }

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

      if (name === 'create_jobtread_task') {
        const jobId = input.jobId || ctx.jtJobId;
        if (!jobId) {
          return JSON.stringify({ success: false, error: 'No JobTread Job ID available. Use search_jobs to find the right job first.' });
        }

        let assignedMembershipIds: string[] | undefined;
        let assignedName = '';
        if (input.assignTo) {
          try {
            const members = await getMembers();
            const search = input.assignTo.toLowerCase();
            const match = members.find((m: any) => {
              const mName = (m.user?.name || m.name || '').toLowerCase();
              return mName.includes(search) || search.includes(mName.split(' ')[0]);
            });
            if (match) {
              assignedMembershipIds = [match.id];
              assignedName = match.user?.name || match.name;
            }
          } catch (e) { /* ignore lookup errors */ }
        }

        const result = await createTask({
          jobId,
          name: input.name,
          description: input.description || '',
          startDate: input.startDate,
          endDate: input.endDate,
          assignedMembershipIds,
        });

        return JSON.stringify({ success: true, result, assignedTo: assignedName || undefined });
      }

      // ========== UPDATE TASK PROGRESS ==========
      if (name === 'update_task_progress') {
        const progress = Math.max(0, Math.min(1, input.progress));
        const result = await updateTaskProgress(input.taskId, progress);
        const statusLabel = progress >= 1 ? 'Complete' : progress > 0 ? 'In Progress' : 'Not Started';
        return JSON.stringify({ success: true, taskId: input.taskId, progress, statusLabel, result });
      }

      // ========== UPDATE TASK (general) ==========
      if (name === 'update_task') {
        const fields: any = {};
        if (input.name) fields.name = input.name;
        if (input.startDate) fields.startDate = input.startDate;
        if (input.endDate) fields.endDate = input.endDate;
        if (input.description) fields.description = input.description;
        if (input.progress !== undefined) fields.progress = input.progress;
        if (Object.keys(fields).length === 0) {
          return JSON.stringify({ success: false, error: 'No fields to update. Provide at least one of: name, startDate, endDate, description, progress.' });
        }
        const result = await updateTask(input.taskId, fields);
        const changes = Object.entries(fields).map(([k, v]) => k + ': ' + v).join(', ');
        return JSON.stringify({ success: true, taskId: input.taskId, changes, result });
      }

      // ========== DELETE TASK ==========
      if (name === 'delete_task') {
        const result = await deleteJTTask(input.taskId);
        return JSON.stringify({ success: true, taskId: input.taskId, message: 'Task deleted successfully.', result });
      }

      // ========== CREATE PHASE ==========
      if (name === 'create_phase') {
        const result = await createPhaseGroup({
          jobId: input.jobId,
          name: input.name,
          startDate: input.startDate,
        });
        return JSON.stringify({ success: true, phase: result, message: 'Phase "' + input.name + '" created.' });
      }

      // ========== CREATE PHASE TASK ==========
      if (name === 'create_phase_task') {
        let assignedMembershipIds: string[] | undefined;
        let assignedName = '';
        if (input.assignTo) {
          try {
            const members = await getMembers();
            const search = input.assignTo.toLowerCase();
            const match = members.find((m: any) => {
              const mName = (m.user?.name || m.name || '').toLowerCase();
              return mName.includes(search) || search.includes(mName.split(' ')[0]);
            });
            if (match) {
              assignedMembershipIds = [match.id];
              assignedName = match.user?.name || match.name;
            }
          } catch (e) { /* ignore */ }
        }

        const result = await createPhaseTask({
          jobId: input.jobId,
          parentGroupId: input.parentGroupId,
          name: input.name,
          description: input.description,
          startDate: input.startDate,
          endDate: input.endDate,
          assignedMembershipIds,
        });
        return JSON.stringify({ success: true, task: result, assignedTo: assignedName || undefined, message: 'Task "' + input.name + '" created in phase.' });
      }

      // ========== APPLY TEMPLATE ==========
      if (name === 'apply_standard_template') {
        const result = await applyStandardTemplate(input.jobId);
        return JSON.stringify({
          success: true,
          phasesCreated: result.phasesCreated,
          tasksCreated: result.tasksCreated,
          errors: result.errors,
          message: 'Standard template applied: ' + result.phasesCreated + ' phases and ' + result.tasksCreated + ' tasks created.',
        });
      }

      // ========== DOCUMENTS ==========
      if (name === 'get_job_documents') {
        const docs = await getDocumentsForJob(input.jobId);
        if (!docs || docs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No documents found.' });

        const lines = docs.map((d: any) =>
          '- ' + (d.name || 'Unnamed') + ' | Type: ' + (d.type || 'N/A') + ' | Status: ' + (d.status || 'N/A') + (d.number ? ' | #' + d.number : '')
        );
        return JSON.stringify({ success: true, count: docs.length, documents: lines.join('\n') });
      }

      // ========== FILES ==========
      if (name === 'get_job_files') {
        const files = await getFilesForJob(input.jobId);
        if (!files || files.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No files found.' });

        const lines = files.map((f: any) =>
          '- ' + (f.name || 'Unnamed') + ' | Type: ' + (f.type || 'N/A') + (f.url ? ' | URL: ' + f.url : '')
        );
        return JSON.stringify({ success: true, count: files.length, files: lines.join('\n') });
      }

      // ========== MOVE TASK ==========
      if (name === 'move_task_to_phase') {
        const result = await moveTaskToPhase({
          taskId: input.taskId,
          targetParentId: input.targetPhaseId,
          jobId: input.jobId,
        });
        return JSON.stringify({ success: true, result, message: 'Task moved to new phase.' });
      }

      // ========== DAILY LOGS ==========
      if (name === 'get_job_daily_logs') {
        const logs = await getDailyLogsFromDB(input.jobId);
        if (!logs || logs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No daily logs found for this job.' });
        const lines = logs.map((l: any) => {
          const assignees = l.assignedMemberships?.nodes?.map((a: any) => a.user?.name || '').filter(Boolean).join(', ');
          return '- [' + (l.date || 'No date') + '] (ID: ' + l.id + ')' + (assignees ? ' [' + assignees + ']' : '') + '\n  ' + (l.notes || '(no notes)').slice(0, 500);
        });
        return JSON.stringify({ success: true, count: logs.length, dailyLogs: lines.join('\n') });
      }

      if (name === 'create_daily_log') {
        const jobId = input.jobId || ctx.jtJobId;
        if (!jobId) return JSON.stringify({ success: false, error: 'No Job ID. Use search_jobs first.' });
        const date = input.date || new Date().toISOString().split('T')[0];

        let assignees: string[] | undefined;
        if (input.assignTo) {
          try {
            const members = await getMembers();
            const names = input.assignTo.split(',').map((n: string) => n.trim().toLowerCase());
            assignees = [];
            for (const searchName of names) {
              const match = members.find((m: any) => {
                const mName = (m.user?.name || '').toLowerCase();
                return mName.includes(searchName) || searchName.includes(mName.split(' ')[0]);
              });
              if (match) assignees.push(match.id);
            }
            if (assignees.length === 0) assignees = undefined;
          } catch (e) { /* ignore */ }
        }

        const result = await createDailyLogWithCache({ jobId, date, notes: input.notes, dailyLogType: input.dailyLogType, assignees, notify: input.notify });
        return JSON.stringify({ success: true, result, message: 'Daily log created for ' + date + '.' });
      }

      if (name === 'update_daily_log') {
        const fields: any = {};
        if (input.notes) fields.notes = input.notes;
        if (input.date) fields.date = input.date;
        if (Object.keys(fields).length === 0) return JSON.stringify({ success: false, error: 'No fields to update.' });
        const result = await updateDailyLog({ id: input.logId, ...fields });
        return JSON.stringify({ success: true, result, message: 'Daily log updated.' });
      }

      if (name === 'delete_daily_log') {
        await deleteDailyLog(input.logId);
        return JSON.stringify({ success: true, message: 'Daily log deleted.' });
      }

      // ========== COMMENTS ==========
      if (name === 'get_comments') {
        const comments = await getCommentsFromDB(input.targetId);
        if (!comments || comments.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No comments found.' });
        const lines = comments.map((c: any) => {
          const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '';
          const pin = c.isPinned ? '📌 ' : '';
          const reply = c.parentComment?.id ? '  ↳ Reply: ' : '- ';
          return reply + pin + '[' + date + '] ' + (c.name || 'Unknown') + ': ' + (c.message || '').slice(0, 500) + ' (ID: ' + c.id + ')';
        });
        return JSON.stringify({ success: true, count: comments.length, comments: lines.join('\n') });
      }

      if (name === 'create_comment') {
        let assignees: string[] | undefined;
        if (input.assignTo) {
          try {
            const members = await getMembers();
            const names = input.assignTo.split(',').map((n: string) => n.trim().toLowerCase());
            assignees = [];
            for (const searchName of names) {
              const match = members.find((m: any) => {
                const mName = (m.user?.name || '').toLowerCase();
                return mName.includes(searchName) || searchName.includes(mName.split(' ')[0]);
              });
              if (match) assignees.push(match.id);
            }
            if (assignees.length === 0) assignees = undefined;
          } catch (e) { /* ignore */ }
        }

        const result = await createCommentWithCache({
          targetId: input.targetId,
          targetType: input.targetType,
          message: input.message,
          assignees,
          isPinned: input.isPinned,
          parentCommentId: input.parentCommentId,
        });
        return JSON.stringify({ success: true, result, message: 'Comment added.' });
      }

      // ========== UPDATE JOB ==========
      if (name === 'update_job') {
        const fields: any = {};
        if (input.name) fields.name = input.name;
        if (input.description) fields.description = input.description;
        if (input.specificationsDescription !== undefined) fields.specificationsDescription = input.specificationsDescription;
        if (input.specificationsFooter !== undefined) fields.specificationsFooter = input.specificationsFooter;
        if (input.closedOn !== undefined) fields.closedOn = input.closedOn;
        if (Object.keys(fields).length === 0) return JSON.stringify({ success: false, error: 'No fields to update.' });
        const result = await updateJob(input.jobId, fields);
        return JSON.stringify({ success: true, result, message: 'Job updated.' });
      }

      // ========== BUDGET / COST ITEMS ==========
      if (name === 'get_job_budget') {
        const items = await getCostItemsForJob(input.jobId);
        if (!items || items.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No cost items found.' });
        const searchTerm = (input.search || '').toLowerCase().trim();
        let filtered = items;
        if (searchTerm) {
          filtered = items.filter((i: any) => {
            const searchable = [i.name, i.description, i.costCode?.name, i.costGroup?.name, i.status, i.vendor, i.internalNotes].filter(Boolean).join(' ').toLowerCase();
            return searchable.includes(searchTerm);
          });
        }
        let totalCost = 0, totalPrice = 0;
        const lines = filtered.slice(0, 75).map((i: any) => {
          const cost = (i.quantity || 0) * (i.unitCost || 0);
          const price = (i.quantity || 0) * (i.unitPrice || 0);
          totalCost += cost;
          totalPrice += price;
          const spec = i.isSpecification ? ' [SPEC]' : '';
          const code = i.costCode ? ' (' + i.costCode.number + ' ' + i.costCode.name + ')' : '';
          const group = i.costGroup ? ' [' + i.costGroup.name + ']' : '';
          // Include selection status, vendor, and internal notes when present
          const statusTag = i.status ? ' {Status: ' + i.status + '}' : '';
          const vendorTag = i.vendor ? ' {Vendor: ' + i.vendor + '}' : '';
          const notesTag = i.internalNotes ? ' {Notes: ' + i.internalNotes + '}' : '';
          return '- ' + i.name + spec + code + group + statusTag + vendorTag + notesTag + ' | Qty: ' + (i.quantity || 0) + ' | Cost: $' + cost.toFixed(2) + ' | Price: $' + price.toFixed(2);
        });
        if (filtered.length > 75) lines.push('... and ' + (filtered.length - 75) + ' more. Use search parameter to filter.');
        lines.push('');
        lines.push('SHOWING: ' + Math.min(filtered.length, 75) + ' of ' + items.length + ' total' + (searchTerm ? ' (filtered by "' + input.search + '")' : ''));
        lines.push('TOTALS' + (searchTerm ? ' (filtered)' : '') + ': Cost $' + totalCost.toFixed(2) + ' | Price $' + totalPrice.toFixed(2) + ' | Margin $' + (totalPrice - totalCost).toFixed(2));
        return JSON.stringify({ success: true, count: filtered.length, totalItems: items.length, costItems: lines.join('\n') });
      }

      // ========== JOB DETAILS ==========
      if (name === 'get_job_details') {
        const job = await getJob(input.jobId);
        if (!job) return JSON.stringify({ success: false, error: 'Job not found: ' + input.jobId });
        return JSON.stringify({ success: true, job });
      }

      // ========== MEMBERS ==========
      if (name === 'get_members') {
        const members = await getMembers();
        if (!members || members.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No members found.' });
        const lines = members.map((m: any) => `- ${m.user?.name || 'Unknown'} | Membership ID: ${m.id} | Email: ${m.user?.email || 'N/A'}`);
        return JSON.stringify({ success: true, count: members.length, members: lines.join('\n') });
      }

      // ========== MEMBER TASKS ==========
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

      // ========== APPROVED DOCUMENTS ==========
      if (name === 'get_approved_documents') {
        const docs = await getApprovedDocuments(input.limit || 100);
        if (!docs || docs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No approved documents found.' });
        const lines = (docs as any[]).map((d: any) => {
          const total = d.total !== undefined ? `$${Number(d.total).toLocaleString()}` : 'N/A';
          const jobName = d.job?.name || 'Unknown job';
          return `- "${d.name || 'Untitled'}" | Job: ${jobName} | Type: ${d.type || 'N/A'} | Status: ${d.status || 'N/A'} | Total: ${total} | ID: ${d.id}`;
        });
        return JSON.stringify({ success: true, count: docs.length, documents: lines.join('\n') });
      }

      // ========== DOCUMENT CONTENT ==========
      if (name === 'get_document_content') {
        const doc = await getDocumentContent(input.documentId);
        if (!doc) return JSON.stringify({ success: false, error: 'Document not found or empty.' });
        return JSON.stringify({ success: true, document: doc });
      }

      // ========== COST CODES ==========
      if (name === 'get_cost_codes') {
        const codes = await getCostCodes();
        if (!codes || codes.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No cost codes found.' });
        const lines = (codes as any[]).map((c: any) => `- #${c.number || '?'} ${c.name || 'Unnamed'} | ID: ${c.id}`);
        return JSON.stringify({ success: true, count: codes.length, costCodes: lines.join('\n') });
      }

      // ========== BILLABLE DOCUMENTS ==========
      if (name === 'get_billable_documents') {
        const docs = await getBillableDocuments(input.limit || 100);
        if (!docs || docs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No billable documents found.' });
        const lines = (docs as any[]).map((d: any) => {
          const total = d.total !== undefined ? `$${Number(d.total).toLocaleString()}` : 'N/A';
          const jobName = d.job?.name || 'Unknown job';
          return `- "${d.name || 'Untitled'}" | Job: ${jobName} | Type: ${d.type || 'N/A'} | Status: ${d.status || 'N/A'} | Total: ${total}`;
        });
        return JSON.stringify({ success: true, count: docs.length, documents: lines.join('\n') });
      }

      // ========== TIME ENTRIES ==========
      if (name === 'get_time_entries') {
        const entries = await getTimeEntriesForJob(input.jobId);
        if (!entries || entries.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No time entries found.' });
        const lines = (entries as any[]).map((e: any) => {
          const member = e.membership?.user?.name || 'Unknown';
          const hours = e.duration ? (e.duration / 60).toFixed(1) + 'h' : 'N/A';
          return `- ${e.date || 'No date'} | ${member} | ${hours} | ${e.description || '(no description)'}`;
        });
        return JSON.stringify({ success: true, count: entries.length, timeEntries: lines.join('\n') });
      }

      // ========== COST GROUPS ==========
      if (name === 'get_cost_groups') {
        const groups = await getCostGroupsForJob(input.jobId);
        if (!groups || groups.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No cost groups found.' });
        const lines = (groups as any[]).map((g: any) => {
          const markup = g.markupPercent !== undefined ? `Markup: ${g.markupPercent}%` : '';
          const taxable = g.isTaxable ? 'Taxable' : 'Not taxable';
          const totalCost = g.totalCost !== undefined ? `Cost: $${Number(g.totalCost).toLocaleString()}` : '';
          const totalPrice = g.totalPrice !== undefined ? `Price: $${Number(g.totalPrice).toLocaleString()}` : '';
          return `- "${g.name || 'Unnamed'}" (ID: ${g.id}) | ${markup} | ${taxable} | ${totalCost} | ${totalPrice}`;
        });
        return JSON.stringify({ success: true, count: groups.length, costGroups: lines.join('\n') });
      }

      // ========== UPDATE COST GROUP ==========
      if (name === 'update_cost_group') {
        const fields: any = {};
        if (input.name) fields.name = input.name;
        if (input.markupPercent !== undefined) fields.markupPercent = input.markupPercent;
        if (input.isTaxable !== undefined) fields.isTaxable = input.isTaxable;
        if (Object.keys(fields).length === 0) return JSON.stringify({ success: false, error: 'No fields to update.' });
        const result = await updateCostGroup(input.groupId, fields);
        return JSON.stringify({ success: true, result, message: 'Cost group updated.' });
      }

      // ========== SPECIFICATIONS ==========
      if (name === 'get_specifications') {
        const specs = await getSpecificationsForJob(input.jobId);
        if (!specs) return JSON.stringify({ success: true, message: 'No specifications found for this job.' });
        return JSON.stringify({ success: true, specifications: specs });
      }

      // ========== EVENTS ==========
      if (name === 'get_job_events') {
        const events = await getEventsForJob(input.jobId);
        if (!events || events.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No events found.' });
        const lines = (events as any[]).map((e: any) => {
          const start = e.startDate || 'No date';
          const end = e.endDate || '';
          return `- "${e.name || 'Untitled'}" | ${start}${end ? ' → ' + end : ''} | ${e.description || '(no description)'}`;
        });
        return JSON.stringify({ success: true, count: events.length, events: lines.join('\n') });
      }

      // ========== SCHEDULE AUDIT ==========
      if (name === 'get_schedule_audit') {
        const audit = await getScheduleAudit();
        return JSON.stringify({ success: true, audit });
      }

      // ========== GRID SCHEDULE ==========
      if (name === 'get_grid_schedule') {
        const grid = await getGridScheduleData();
        if (!grid || grid.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No schedule data found.' });
        const lines = grid.map((j: any) => {
          const phases = (j.phases || []).map((p: any) => `  📁 ${p.name} (${Math.round((p.progress || 0) * 100)}%)`).join('\n');
          return `- #${j.number || '?'} ${j.name} | Progress: ${Math.round((j.totalProgress || 0) * 100)}%\n${phases}`;
        });
        return JSON.stringify({ success: true, count: grid.length, schedules: lines.join('\n\n') });
      }

      // ========== GHL CALENDAR ==========
      if (name === 'get_ghl_calendar') {
        try {
          const events = await getGHLCalendarEvents({
            startTime: input.startTime,
            endTime: input.endTime,
            calendarId: input.calendarId,
          });
          if (!events || events.length === 0) {
            return JSON.stringify({ success: true, count: 0, message: 'No appointments found in that date range.' });
          }
          const lines = events.map((e: any) => {
            const title = e.title || e.name || 'Untitled';
            const start = e.startTime ? new Date(e.startTime).toLocaleString('en-US', { timeZone: 'America/New_York' }) : '?';
            const end = e.endTime ? new Date(e.endTime).toLocaleString('en-US', { timeZone: 'America/New_York' }) : '?';
            const contact = e.contact ? `${e.contact.name || ''} ${e.contact.email || ''}`.trim() : (e.contactId || 'No contact');
            const status = e.status || e.appointmentStatus || '';
            const cal = e.calendarId || '';
            const notes = e.notes || '';
            return `• ${title} | ${start} → ${end} | Contact: ${contact} | Status: ${status}${notes ? ' | Notes: ' + notes.substring(0, 200) : ''}`;
          });
          return JSON.stringify({ success: true, count: events.length, appointments: lines.join('\n') });
        } catch (err: any) {
          return JSON.stringify({ success: false, error: err?.message || 'Failed to fetch GHL calendar events' });
        }
      }

      if (name === 'get_ghl_calendars_list') {
        try {
          const calendars = await getGHLCalendars();
          if (!calendars || calendars.length === 0) {
            return JSON.stringify({ success: true, count: 0, message: 'No calendars found.' });
          }
          const lines = calendars.map((c: any) => `• ${c.name || 'Unnamed'} | ID: ${c.id} | Type: ${c.calendarType || c.type || '?'}`);
          return JSON.stringify({ success: true, count: calendars.length, calendars: lines.join('\n') });
        } catch (err: any) {
          return JSON.stringify({ success: false, error: err?.message || 'Failed to fetch GHL calendars' });
        }
      }

      // ========== GHL → JT MEETING SYNC ==========
      if (name === 'sync_ghl_meetings_to_jt') {
        try {
          const result = await syncGHLMeetingsToJT({
            daysAhead: input.daysAhead || 30,
            dryRun: input.dryRun || false,
          });
          return JSON.stringify({
            success: true,
            synced: result.synced,
            skipped: result.skipped,
            errors: result.errors,
            details: result.details.join('\n'),
          });
        } catch (err: any) {
          return JSON.stringify({ success: false, error: err?.message || 'Meeting sync failed' });
        }
      }

      // ========== APPLY PHASE DEFAULTS ==========
      if (name === 'apply_phase_defaults') {
        const result = await applyPhaseDefaults(input.jobId, input.moveOrphans || false);
        return JSON.stringify({ success: true, result, message: 'Phase defaults applied.' });
      }

      // ========== UPDATE TASK FULL (advanced) ==========
      if (name === 'update_task_full') {
        const fields: any = {};
        if (input.name) fields.name = input.name;
        if (input.description) fields.description = input.description;
        if (input.startDate) fields.startDate = input.startDate;
        if (input.endDate) fields.endDate = input.endDate;
        if (input.startTime) fields.startTime = input.startTime;
        if (input.endTime) fields.endTime = input.endTime;
        if (input.progress !== undefined) fields.progress = input.progress;

        if (input.assignTo) {
          try {
            const members = await getMembers();
            const names = input.assignTo.split(',').map((n: string) => n.trim().toLowerCase());
            const ids: string[] = [];
            for (const searchName of names) {
              const match = members.find((m: any) => {
                const mName = (m.user?.name || '').toLowerCase();
                return mName.includes(searchName) || searchName.includes(mName.split(' ')[0]);
              });
              if (match) ids.push(match.id);
            }
            if (ids.length > 0) fields.assignedMembershipIds = ids;
          } catch (e) { /* ignore */ }
        }

        if (Object.keys(fields).length === 0) return JSON.stringify({ success: false, error: 'No fields to update.' });
        const result = await updateTaskFull(input.taskId, fields);
        return JSON.stringify({ success: true, result, message: 'Task updated (advanced).' });
      }

      return JSON.stringify({ error: 'Unknown tool: ' + name });
    } catch (err) {
      return JSON.stringify({ error: 'Tool failed: ' + (err instanceof Error ? err.message : String(err)) });
    }
  },
};

export default knowItAll;
