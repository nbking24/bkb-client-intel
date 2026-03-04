// @ts-nocheck
import { AgentModule, AgentContext } from './types';
import { getContact, getContactNotes, searchConversations, getConversationMessages, getContactTasks, getOpportunity, searchContacts as searchGHLContacts } from '../ghl';
import {
  getActiveJobs, getJob, getJobSchedule, getTasksForJob, getDocumentsForJob,
  getMembers, getAllOpenTasks, getDailyLogsForJob, getCommentsForTarget,
  getTimeEntriesForJob, getSpecificationsForJob, getCostItemsForJob,
  getEventsForJob, getFilesForJob, getDocumentContent,
} from '../../../lib/jobtread';

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

async function fetchGHLContext(ctx: AgentContext): Promise<string> {
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

      if (profileLines.length > 0) sections.push('=== CONTACT PROFILE ===\n' + profileLines.join('\n'));
    }

    // CRM NOTES
    if (notes.status === 'fulfilled' && Array.isArray(notes.value) && notes.value.length > 0) {
      const noteTexts = notes.value.slice(0, 50).map((n: any) => {
        const date = n.dateAdded ? new Date(n.dateAdded).toLocaleDateString() : 'No date';
        return '[' + date + '] ' + (n.body || '').slice(0, 65000);
      });
      sections.push('=== CRM NOTES (' + notes.value.length + ' total) ===\n' + noteTexts.join('\n---\n'));
    } else if (notes.status === 'rejected') {
      const errMsg = notes.reason instanceof Error ? notes.reason.message : 'Unknown error';
      sections.push('=== NOTES ERROR ===\nFailed to fetch notes: ' + errMsg);
    }

    // CONVERSATIONS & MESSAGES
    if (convos.status === 'fulfilled' && Array.isArray(convos.value)) {
      if (convos.value.length === 0) {
        sections.push('=== MESSAGES ===\nNo conversations found for this contact.');
      } else {
        const msgs: string[] = [];
        let msgFetchErrors = 0;

        for (const conv of convos.value.slice(0, 10)) {
          const convData = conv as any;
          if (convData.lastMessageBody) {
            const lastDate = convData.lastMessageDate ? new Date(convData.lastMessageDate).toLocaleDateString() : '';
            const lastType = convData.lastMessageType || convData.type || '';
            msgs.push('[CONV SUMMARY ' + lastDate + ' ' + lastType + '] Last message: ' + (convData.lastMessageBody || '').slice(0, 2000));
          }
          try {
            const cmsgs = await getConversationMessages(convData.id, 40);
            if (Array.isArray(cmsgs)) {
              for (const m of cmsgs) {
                const mr = m as any;
                const date = mr.dateAdded ? new Date(mr.dateAdded).toLocaleDateString() : '';
                const direction = mr.direction || mr.meta?.email?.direction || mr.meta?.direction || '?';
                const msgType = mr.messageType || mr.type || '';
                const subject = mr.meta?.email?.subject ? ' Subject: ' + mr.meta.email.subject : '';
                const body = mr.body || mr.text || mr.message || mr.altText || '';
                msgs.push('[' + date + ' ' + direction + ' ' + msgType + subject + '] ' + (body ? body.slice(0, 2000) : '(no body text)'));
              }
            }
          } catch (msgErr) {
            msgFetchErrors++;
          }
        }
        if (msgs.length > 0) {
          sections.push('=== MESSAGES (' + msgs.length + ' total) ===\n' + msgs.join('\n'));
        } else if (msgFetchErrors > 0) {
          sections.push('=== MESSAGES ERROR ===\nFound ' + convos.value.length + ' conversation(s) but failed to fetch messages from ' + msgFetchErrors + ' of them.');
        }
      }
    } else if (convos.status === 'rejected') {
      const errMsg = convos.reason instanceof Error ? convos.reason.message : 'Unknown error';
      sections.push('=== CONVERSATIONS ERROR ===\nFailed to fetch conversations: ' + errMsg);
    }

    // TASKS
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

async function fetchOpportunityContext(ctx: AgentContext): Promise<string> {
  if (!ctx.opportunityId) return '';
  try {
    const opp = await getOpportunity(ctx.opportunityId);
    const o = opp.opportunity || opp;
    const lines: string[] = [
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
    return '=== SELECTED OPPORTUNITY ===\n' + lines.join('\n');
  } catch (err) {
    return '=== OPPORTUNITY ERROR ===\n' + (err instanceof Error ? err.message : 'Failed');
  }
}

async function fetchJTContext(ctx: AgentContext): Promise<string> {
  const sections: string[] = [];
  try {
    const jobs = await getActiveJobs(30);
    if (Array.isArray(jobs) && jobs.length > 0) {
      const lines = jobs.map((j: any) =>
        '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' (ID: ' + j.id + ') | Status: ' + (j.status || 'N/A') + (j.clientName ? ' | Client: ' + j.clientName : '')
      );
      sections.push('=== JOBTREAD ACTIVE JOBS ===\n' + lines.join('\n'));
    }
  } catch (err) {
    sections.push('=== JT JOBS ERROR ===\n' + (err instanceof Error ? err.message : 'Failed'));
  }
  return sections.join('\n\n');
}

const knowItAll: AgentModule = {
  name: 'Know it All',
  description: 'Pulls all data from GHL and JobTread to answer any question about clients, projects, history, and status.',
  icon: '\u{1F9E0}',

  systemPrompt: (ctx: AgentContext) => {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return 'TODAY\'S DATE: ' + dateStr + '\n\n' +
      'You are "Know it All," the AI research assistant for Brett King Builder (BKB), a high-end residential renovation and historic home restoration company in Bucks County, PA.\n\n' +
      'Your specialty is knowing EVERYTHING about every client and project. You pull data from GHL (CRM) and JobTread (project management) and give comprehensive, detailed answers.\n\n' +
      'CAPABILITIES:\n' +
      '- Search and list all active JobTread jobs\n' +
      '- Get detailed information about any specific job (name, status, client, location, dates, custom fields)\n' +
      '- View full job schedules with phases and tasks\n' +
      '- Get task lists for any job\n' +
      '- View job documents and files\n' +
      '- Search GHL contacts by name or email\n' +
      '- Get all open tasks across the organization\n' +
      '- View team member information\n\n' +
      'TOOLS AVAILABLE:\n' +
      '- search_jobs: Search JobTread jobs by name, number, or client name. Returns matching jobs with IDs.\n' +
      '- get_job_details: Get full details for a specific job by its ID.\n' +
      '- get_job_schedule: Get the complete phase/task schedule tree for a job.\n' +
      '- get_job_tasks: Get all tasks for a specific job.\n' +
      '- get_job_documents: Get all documents associated with a job.\n' +
      '- get_all_open_tasks: Get ALL open/incomplete tasks across all jobs in the organization.\n' +
      '- search_ghl_contacts: Search GHL CRM for contacts by name or email.\n' +
      '- get_team_members: Get list of all BKB team members with their IDs.\n' +
      '- get_job_daily_logs: Get daily logs for a job (site activity, notes, crew info).\n' +
      '- get_job_comments: Get comments on a job, task, or document.\n' +
      '- get_job_time_entries: Get time entries (labor hours) for a job.\n' +
      '- get_job_specifications: Get the full specifications for a job — ALL cost items grouped by cost group (scope of work, materials, labor, etc.), project documents, and specifications description/footer. Use the search parameter to filter by keyword.\n' +
      '- get_job_budget: Get cost items (budget line items) for a job.\n' +
      '- get_job_events: Get calendar events for a job.\n' +
      '- get_job_files: Get uploaded files for a job.\n' +
      '- get_document_content: Read the actual content (line items, cost groups, quantities) inside a specific document like a contract, bid, or invoice. Use this when someone asks about what is IN a document.\n\n' +
      'INSTRUCTIONS:\n' +
      '- When someone asks about a project/job, use search_jobs first to find it, then get_job_details or get_job_schedule for specifics.\n' +
      '- When listing jobs or tasks, format them clearly with job numbers and names.\n' +
      '- If you have context data injected below, use it. If not, use tools to search.\n' +
      '- Be specific, reference real data, and be concise but thorough. If data is missing, say so honestly.\n' +
      '- When summarizing, include ALL available information. Do not skip or truncate.\n' +
      '- IMPORTANT: When someone asks about content INSIDE a document (contract, invoice, bid), first use get_job_documents to find the document ID, then use get_document_content to read the actual line items and quantities. Do NOT say you cannot access document content — use the tool.\n' +
      '- For specification questions, use get_job_specifications. For document content questions (e.g. "what was in the original contract"), use get_document_content.\n\n' +
      (ctx.communicationChannel !== 'unknown'
        ? 'Current communication channel for this opportunity: ' + ctx.communicationChannel.toUpperCase() + ' (based on pipeline stage: ' + (ctx.pipelineStage || 'unknown') + ')\n'
        : '') +
      (ctx.jtJobId ? 'JobTread Job ID: ' + ctx.jtJobId + '\n' : '');
  },

  tools: [
    {
      name: 'search_jobs',
      description: 'Search JobTread for active jobs. Returns jobs matching the query by name, number, or client name. Use this when someone asks about a project or wants to find a job.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term — matches against job name, job number, or client name. Leave empty to get all active jobs.' },
        },
        required: [],
      },
    },
    {
      name: 'get_job_details',
      description: 'Get full details for a specific JobTread job including name, status, client, location, dates, and custom fields.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_schedule',
      description: 'Get the complete schedule for a job — all phases (task groups) and their tasks, with progress, dates, and assignments.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_tasks',
      description: 'Get all tasks for a specific JobTread job with their status, dates, assignments, and progress.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_documents',
      description: 'Get all documents (contracts, change orders, etc.) associated with a job.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_all_open_tasks',
      description: 'Get ALL open/incomplete tasks across all jobs in the organization. Useful for "what tasks are overdue" or "show me all open tasks" queries.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'search_ghl_contacts',
      description: 'Search GHL CRM for contacts by name or email address.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name or email to search for' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_team_members',
      description: 'Get list of all BKB team members with their membership IDs. Useful for looking up who can be assigned to tasks.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_job_daily_logs',
      description: 'Get daily logs for a specific job. Daily logs track daily site activity, notes, and crew information.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_comments',
      description: 'Get all comments on a JobTread entity (job, task, document). Shows discussion threads and pinned comments.',
      input_schema: {
        type: 'object',
        properties: {
          targetId: { type: 'string', description: 'ID of the entity (job ID, task ID, etc.)' },
          targetType: { type: 'string', description: 'Type: "job", "task", "document", "costItem"' },
        },
        required: ['targetId', 'targetType'],
      },
    },
    {
      name: 'get_job_time_entries',
      description: 'Get time entries (labor hours) logged for a job. Shows who worked, when, and on what.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_specifications',
      description: 'Get the full specifications for a job — ALL cost items grouped by cost group (scope of work, materials, labor, etc.), project documents, and description/footer. This returns the same data as the JobTread Specifications page. Use the search parameter to filter by keyword (e.g. "door", "window", "plumbing", "kitchen") for large jobs.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          search: { type: 'string', description: 'Optional keyword to filter specification items (e.g. "door", "soffit", "window"). Recommended for large jobs to reduce data size.' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_budget',
      description: 'Get cost items (budget/estimate line items) for a job. Use the search parameter to filter by keyword for large jobs.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          search: { type: 'string', description: 'Optional keyword to filter cost items (e.g. "electric", "plumbing", "door"). Recommended for large jobs.' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_events',
      description: 'Get calendar events for a job. Shows meetings, inspections, site visits, and other scheduled events.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_files',
      description: 'Get all uploaded files for a job (photos, plans, permits, etc.).',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_document_content',
      description: 'Read the actual content inside a specific document (contract, bid, invoice, change order). Returns line items with quantities, costs, descriptions, and cost groups. Use this when someone asks about what is IN a document, specific line items, quantities, or pricing from a document.',
      input_schema: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The document ID (get from get_job_documents first)' },
          search: { type: 'string', description: 'Optional keyword to filter line items (e.g. "slab", "reinforcement", "soffit")' },
        },
        required: ['documentId'],
      },
    },
  ],

  canHandle: (message: string) => {
    const lower = message.toLowerCase();
    // If the message contains write-operation verbs targeting tasks, yield to jt-entry
    if (/(update|change|edit|modify|rename|reschedule|push|move|set|adjust).*(task|date|due|deadline|schedule|phase)/i.test(lower)) return 0.2;
    if (/(create|add|delete|remove|assign|apply).*(task|phase|template)/i.test(lower)) return 0.2;
    if (/mark.*(complete|done|finished|progress)/i.test(lower)) return 0.2;
    // High score for questions, lookups, summaries (removed "update" from keywords)
    if (/\?|what|who|when|where|how|tell me|show me|summary|overview|status|history|latest|details|information|look up|find out|check on|list|all jobs|all tasks|open tasks|overdue/i.test(lower)) return 0.8;
    // High for read-only data requests
    if (/daily.*(log|report|entry)|site.*(log|report)/i.test(lower) && !/(create|add|write|update|edit|delete)/i.test(lower)) return 0.85;
    if (/(time.*entry|time.*log|labor.*hour|hours.*logged)/i.test(lower)) return 0.85;
    if (/(specification|spec|budget|cost.*item|estimate|bid)/i.test(lower) && !/(update|change|edit|modify)/i.test(lower)) return 0.85;
    if (/(comment|discussion|thread)/i.test(lower) && !/(add|create|post|write)/i.test(lower)) return 0.85;
    if (/(event|meeting|inspection|calendar|appointment)/i.test(lower)) return 0.8;
    if (/(file|photo|plan|permit|upload|attachment)/i.test(lower)) return 0.8;
    // High for document content queries (contract, invoice, what's in the document)
    if (/(contract|invoice|bill|order|change.*order)/i.test(lower) && /(what|how.*many|how.*much|LF|linear|quantity|material|planned|original)/i.test(lower)) return 0.85;
    if (/(in the|on the|from the).*(document|contract|invoice|proposal)/i.test(lower)) return 0.85;
    // Medium score for general client/project references
    if (/client|project|job|contact|note|message|communication|schedule|document|team/i.test(lower)) return 0.5;
    // Low base score - acts as fallback
    return 0.3;
  },

  fetchContext: async (ctx: AgentContext) => {
    const parts: string[] = [];

    // Always fetch GHL data if we have a contact
    if (ctx.contactId) {
      const ghl = await fetchGHLContext(ctx);
      if (ghl) parts.push(ghl);
    }

    // Fetch opportunity details if selected
    if (ctx.opportunityId) {
      const opp = await fetchOpportunityContext(ctx);
      if (opp) parts.push(opp);
    }

    // Always fetch JT jobs overview (even without contactId)
    const jt = await fetchJTContext(ctx);
    if (jt) parts.push(jt);

    return parts.join('\n\n');
  },

  executeTool: async (name: string, input: any, ctx: AgentContext) => {
    try {
      if (name === 'search_jobs') {
        const jobs = await getActiveJobs(50);
        const query = (input.query || '').toLowerCase().trim();

        if (!query) {
          // Return all active jobs
          const lines = jobs.map((j: any) =>
            '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' (ID: ' + j.id + ') | Status: ' + (j.status || 'N/A') + (j.clientName ? ' | Client: ' + j.clientName : '') + (j.locationName ? ' | Location: ' + j.locationName : '')
          );
          return JSON.stringify({ success: true, count: jobs.length, jobs: lines.join('\n') });
        }

        // Filter by query
        const matches = jobs.filter((j: any) => {
          const searchable = [j.name, j.number, j.clientName, j.locationName, j.id].filter(Boolean).join(' ').toLowerCase();
          return searchable.includes(query);
        });

        if (matches.length === 0) {
          return JSON.stringify({ success: true, count: 0, message: 'No jobs found matching "' + input.query + '". Try a different search term.' });
        }

        const lines = matches.map((j: any) =>
          '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' (ID: ' + j.id + ') | Status: ' + (j.status || 'N/A') + (j.clientName ? ' | Client: ' + j.clientName : '') + (j.locationName ? ' | Location: ' + j.locationName : '')
        );
        return JSON.stringify({ success: true, count: matches.length, jobs: lines.join('\n') });
      }

      if (name === 'get_job_details') {
        const job = await getJob(input.jobId);
        if (!job) return JSON.stringify({ success: false, error: 'Job not found with ID: ' + input.jobId });
        return JSON.stringify({ success: true, job });
      }

      if (name === 'get_job_schedule') {
        const schedule = await getJobSchedule(input.jobId);
        if (!schedule) return JSON.stringify({ success: false, error: 'No schedule found for job ID: ' + input.jobId });

        // Format the schedule tree
        const lines: string[] = [];
        lines.push('Job: #' + (schedule.number || '?') + ' ' + schedule.name);
        lines.push('Overall Progress: ' + Math.round((schedule.totalProgress || 0) * 100) + '%');
        lines.push('');

        for (const phase of schedule.phases || []) {
          const phaseProgress = Math.round((phase.progress || 0) * 100);
          lines.push('📁 ' + phase.name + ' (' + phaseProgress + '% complete)');
          const phaseTasks = phase.childTasks?.nodes || phase.childTasks || [];
          const taskList = Array.isArray(phaseTasks) ? phaseTasks : [];
          for (const task of taskList) {
            const status = task.progress >= 1 ? '✅' : task.progress > 0 ? '🔄' : '⬜';
            const dates = [task.startDate, task.endDate].filter(Boolean).join(' → ');
            const assignees = task.assignedMemberships?.map((a: any) => a.user?.name || a.name || '').filter(Boolean).join(', ');
            lines.push('  ' + status + ' ' + task.name + (dates ? ' (' + dates + ')' : '') + (assignees ? ' [' + assignees + ']' : ''));
          }
        }

        if (schedule.orphanTasks && schedule.orphanTasks.length > 0) {
          lines.push('');
          lines.push('📋 Unassigned Tasks:');
          for (const task of schedule.orphanTasks) {
            const status = task.progress >= 1 ? '✅' : task.progress > 0 ? '🔄' : '⬜';
            lines.push('  ' + status + ' ' + task.name);
          }
        }

        return JSON.stringify({ success: true, schedule: lines.join('\n') });
      }

      if (name === 'get_job_tasks') {
        const tasks = await getTasksForJob(input.jobId);
        if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No tasks found for this job.' });

        // Separate phases (groups) from individual tasks
        const phases = tasks.filter((t: any) => t.isGroup && !t.parentTask?.id);
        const childTasks = tasks.filter((t: any) => !t.isGroup);

        const lines: string[] = [];
        for (const phase of phases) {
          const phaseProgress = Math.round((phase.progress || 0) * 100);
          lines.push('📁 ' + phase.name + ' (' + phaseProgress + '%)');
          const children = childTasks.filter((t: any) => t.parentTask?.id === phase.id);
          for (const t of children) {
            const status = t.progress >= 1 ? '✅' : t.progress > 0 ? '🔄' : '⬜';
            const dates = [t.startDate, t.endDate].filter(Boolean).join(' → ');
            lines.push('  ' + status + ' ' + t.name + (dates ? ' (' + dates + ')' : ''));
          }
        }
        // Orphan tasks (no parent)
        const orphans = childTasks.filter((t: any) => !t.parentTask?.id);
        if (orphans.length > 0) {
          lines.push('📋 Other Tasks:');
          for (const t of orphans) {
            const status = t.progress >= 1 ? '✅' : t.progress > 0 ? '🔄' : '⬜';
            const dates = [t.startDate, t.endDate].filter(Boolean).join(' → ');
            lines.push('  ' + status + ' ' + t.name + (dates ? ' (' + dates + ')' : ''));
          }
        }

        return JSON.stringify({ success: true, count: tasks.length, tasks: lines.join('\n') });
      }

      if (name === 'get_job_documents') {
        const docs = await getDocumentsForJob(input.jobId);
        if (!docs || docs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No documents found for this job.' });

        const lines = docs.map((d: any) =>
          '- ' + (d.name || 'Unnamed') + ' | Type: ' + (d.type || 'N/A') + ' | Status: ' + (d.status || 'N/A') + (d.number ? ' | #' + d.number : '') + (d.description ? ' — ' + d.description.slice(0, 200) : '')
        );

        return JSON.stringify({ success: true, count: docs.length, documents: lines.join('\n') });
      }

      if (name === 'get_all_open_tasks') {
        const tasks = await getAllOpenTasks();
        if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No open tasks found.' });

        const now = new Date();
        const lines = tasks.map((t: any) => {
          const jobName = t.job?.name || 'Unknown Job';
          const jobNum = t.job?.number || '?';
          const dates = [t.startDate, t.endDate].filter(Boolean).join(' → ');
          const assignees = t.assignedMemberships?.map((a: any) => a.user?.name || '').filter(Boolean).join(', ');
          const isOverdue = t.endDate && new Date(t.endDate) < now;
          return (isOverdue ? '⚠️ OVERDUE ' : '- ') + '[#' + jobNum + ' ' + jobName + '] ' + t.name + (dates ? ' (' + dates + ')' : '') + (assignees ? ' [' + assignees + ']' : '');
        });

        const overdueCount = tasks.filter((t: any) => t.endDate && new Date(t.endDate) < now).length;

        return JSON.stringify({
          success: true,
          count: tasks.length,
          overdueCount,
          tasks: lines.join('\n'),
        });
      }

      if (name === 'search_ghl_contacts') {
        const results = await searchGHLContacts(input.query);
        const contacts = results?.contacts || results || [];

        if (!Array.isArray(contacts) || contacts.length === 0) {
          return JSON.stringify({ success: true, count: 0, message: 'No contacts found matching "' + input.query + '".' });
        }

        const lines = contacts.map((c: any) =>
          '- ' + (c.firstName || '') + ' ' + (c.lastName || '') + (c.email ? ' | ' + c.email : '') + (c.phone ? ' | ' + c.phone : '') + (c.companyName ? ' | ' + c.companyName : '') + ' (ID: ' + c.id + ')'
        );

        return JSON.stringify({ success: true, count: contacts.length, contacts: lines.join('\n') });
      }

      if (name === 'get_team_members') {
        const members = await getMembers();
        const lines = members.map((m: any) => '- ' + (m.user?.name || m.name || 'Unknown') + ' (ID: ' + m.id + ')');
        return JSON.stringify({ success: true, count: members.length, members: lines.join('\n') });
      }

      if (name === 'get_job_daily_logs') {
        const logs = await getDailyLogsForJob(input.jobId);
        if (!logs || logs.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No daily logs found for this job.' });
        const lines = logs.map((l: any) => {
          const assignees = l.assignedMemberships?.nodes?.map((a: any) => a.user?.name || '').filter(Boolean).join(', ');
          return '- [' + (l.date || 'No date') + '] (ID: ' + l.id + ')' + (assignees ? ' [' + assignees + ']' : '') + '\n  ' + (l.notes || '(no notes)').slice(0, 500);
        });
        return JSON.stringify({ success: true, count: logs.length, dailyLogs: lines.join('\n') });
      }

      if (name === 'get_job_comments') {
        const comments = await getCommentsForTarget(input.targetId, input.targetType);
        if (!comments || comments.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No comments found.' });
        const lines = comments.map((c: any) => {
          const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '';
          const pin = c.isPinned ? '📌 ' : '';
          const reply = c.parentComment?.id ? '  ↳ Reply: ' : '- ';
          return reply + pin + '[' + date + '] ' + (c.name || 'Unknown') + ': ' + (c.message || '').slice(0, 500);
        });
        return JSON.stringify({ success: true, count: comments.length, comments: lines.join('\n') });
      }

      if (name === 'get_job_time_entries') {
        const entries = await getTimeEntriesForJob(input.jobId);
        if (!entries || entries.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No time entries found for this job.' });
        let totalHours = 0;
        const lines = entries.map((e: any) => {
          const start = e.startedAt ? new Date(e.startedAt) : null;
          const end = e.endedAt ? new Date(e.endedAt) : null;
          let hours = 0;
          if (start && end) hours = (end.getTime() - start.getTime()) / 3600000;
          totalHours += hours;
          const dateStr = start ? start.toLocaleDateString() : 'No date';
          const userName = e.user?.name || 'Unknown';
          const costItemName = e.costItem?.name || '';
          return '- [' + dateStr + '] ' + userName + ' — ' + hours.toFixed(1) + ' hrs' + (costItemName ? ' (' + costItemName + ')' : '') + (e.notes ? ' — ' + e.notes.slice(0, 200) : '');
        });
        lines.push('');
        lines.push('TOTAL: ' + totalHours.toFixed(1) + ' hours across ' + entries.length + ' entries');
        return JSON.stringify({ success: true, count: entries.length, totalHours: totalHours.toFixed(1), timeEntries: lines.join('\n') });
      }

      if (name === 'get_job_specifications') {
        const specs = await getSpecificationsForJob(input.jobId);
        const searchTerm = (input.search || '').toLowerCase().trim();
        const lines: string[] = [];

        // Include description/footer only if no search filter or if they match
        if (specs.description && (!searchTerm || specs.description.toLowerCase().includes(searchTerm))) {
          lines.push('SPECIFICATIONS DESCRIPTION:\n' + specs.description.slice(0, 2000));
        }
        if (specs.footer && (!searchTerm || specs.footer.toLowerCase().includes(searchTerm))) {
          lines.push('\nSPECIFICATIONS FOOTER:\n' + specs.footer.slice(0, 1000));
        }

        // Show documents (Project Details section)
        if (specs.documents && specs.documents.length > 0) {
          const matchingDocs = searchTerm
            ? specs.documents.filter((d: any) => [d.name, d.type, d.status].filter(Boolean).join(' ').toLowerCase().includes(searchTerm))
            : specs.documents;
          if (matchingDocs.length > 0) {
            lines.push('\nPROJECT DOCUMENTS (' + matchingDocs.length + '):');
            for (const doc of matchingDocs) {
              lines.push('- ' + doc.name + ' [' + doc.type + '] — Status: ' + doc.status);
            }
          }
        }

        // Show cost items grouped by cost group (matching the Specifications page layout)
        const groupedItems = specs.groupedItems || {};
        const groupNames = Object.keys(groupedItems);
        let totalShown = 0;
        const maxItems = 80;

        if (groupNames.length > 0) {
          for (const groupName of groupNames) {
            let items = groupedItems[groupName];
            // Filter by search term if provided
            if (searchTerm) {
              items = items.filter((item: any) => {
                const searchable = [item.name, item.description, item.costCode?.name, groupName].filter(Boolean).join(' ').toLowerCase();
                return searchable.includes(searchTerm);
              });
            }
            if (items.length === 0) continue;

            lines.push('\n--- ' + groupName + ' (' + items.length + ' items) ---');
            for (const item of items) {
              if (totalShown >= maxItems) break;
              const code = item.costCode ? ' (' + item.costCode.number + ')' : '';
              const desc = item.description ? '\n    ' + item.description.slice(0, 300) : '';
              lines.push('• ' + item.name + code + desc);
              totalShown++;
            }
            if (totalShown >= maxItems) {
              lines.push('\n... showing ' + maxItems + ' of ' + specs.items.length + ' total items. Use a more specific search to narrow results.');
              break;
            }
          }
        }

        if (lines.length === 0) return JSON.stringify({ success: true, message: searchTerm ? 'No specifications found matching "' + input.search + '".' : 'No specifications found for this job. The job may not have any cost items or documents yet.' });
        return JSON.stringify({ success: true, totalItems: specs.items.length, totalGroups: groupNames.length, specifications: lines.join('\n') });
      }

      if (name === 'get_job_budget') {
        const items = await getCostItemsForJob(input.jobId);
        if (!items || items.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No cost items found.' });

        const searchTerm = (input.search || '').toLowerCase().trim();
        let filtered = items;
        if (searchTerm) {
          filtered = items.filter((i: any) => {
            const searchable = [i.name, i.description, i.costCode?.name, i.costGroup?.name].filter(Boolean).join(' ').toLowerCase();
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
          return '- ' + i.name + spec + code + group + ' | Qty: ' + (i.quantity || 0) + ' | Cost: $' + cost.toFixed(2) + ' | Price: $' + price.toFixed(2);
        });
        if (filtered.length > 75) lines.push('... and ' + (filtered.length - 75) + ' more items. Use search parameter to filter.');
        lines.push('');
        lines.push('SHOWING: ' + Math.min(filtered.length, 75) + ' of ' + items.length + ' total items' + (searchTerm ? ' (filtered by "' + input.search + '")' : ''));
        lines.push('TOTALS' + (searchTerm ? ' (filtered)' : '') + ': Cost $' + totalCost.toFixed(2) + ' | Price $' + totalPrice.toFixed(2) + ' | Margin $' + (totalPrice - totalCost).toFixed(2));
        return JSON.stringify({ success: true, count: filtered.length, totalItems: items.length, costItems: lines.join('\n') });
      }

      if (name === 'get_job_events') {
        const events = await getEventsForJob(input.jobId);
        if (!events || events.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No events found for this job.' });
        const lines = events.map((e: any) => {
          const dates = [e.startDate, e.endDate].filter(Boolean).join(' → ');
          const times = [e.startTime, e.endTime].filter(Boolean).join(' - ');
          return '- ' + (e.name || 'Unnamed') + ' | ' + (e.type || 'N/A') + (dates ? ' | ' + dates : '') + (times ? ' ' + times : '') + (e.notes ? ' — ' + e.notes.slice(0, 200) : '');
        });
        return JSON.stringify({ success: true, count: events.length, events: lines.join('\n') });
      }

      if (name === 'get_job_files') {
        const files = await getFilesForJob(input.jobId);
        if (!files || files.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No files found.' });
        const lines = files.map((f: any) =>
          '- ' + (f.name || 'Unnamed') + ' | Type: ' + (f.type || 'N/A') + (f.url ? ' | URL: ' + f.url : '')
        );
        return JSON.stringify({ success: true, count: files.length, files: lines.join('\n') });
      }

      if (name === 'get_document_content') {
        const docContent = await getDocumentContent(input.documentId);
        if (!docContent) return JSON.stringify({ success: false, error: 'Could not read document content. The document may not exist or may not have accessible line items.' });

        const searchTerm = (input.search || '').toLowerCase().trim();
        const lines: string[] = [];

        lines.push('DOCUMENT: ' + docContent.name + ' | Type: ' + docContent.type + ' | Status: ' + docContent.status);
        if (docContent.description) lines.push('DESCRIPTION: ' + docContent.description.slice(0, 2000));

        // Collect all cost items (both top-level and inside cost groups)
        const allItems: any[] = [];

        // Items from cost groups
        if (docContent.costGroups && docContent.costGroups.length > 0) {
          for (const group of docContent.costGroups) {
            if (group.costItems && group.costItems.length > 0) {
              for (const ci of group.costItems) {
                allItems.push({ ...ci, groupName: group.name });
              }
            }
          }
        }

        // Top-level cost items
        if (docContent.costItems && docContent.costItems.length > 0) {
          for (const ci of docContent.costItems) {
            allItems.push(ci);
          }
        }

        // Filter by search term if provided
        let filtered = allItems;
        if (searchTerm) {
          filtered = allItems.filter((item: any) => {
            const searchable = [item.name, item.description, item.costCode?.name, item.groupName].filter(Boolean).join(' ').toLowerCase();
            return searchable.includes(searchTerm);
          });
        }

        if (filtered.length > 0) {
          lines.push('\nLINE ITEMS (' + filtered.length + (searchTerm ? ' matching "' + input.search + '"' : '') + ' of ' + allItems.length + ' total):');
          for (const item of filtered.slice(0, 75)) {
            const qty = item.quantity ? 'Qty: ' + item.quantity : '';
            const cost = item.unitCost ? 'Cost: $' + item.unitCost : '';
            const price = item.unitPrice ? 'Price: $' + item.unitPrice : '';
            const code = item.costCode ? ' (' + (item.costCode.number || '') + ' ' + (item.costCode.name || '') + ')' : '';
            const group = item.groupName ? ' [' + item.groupName + ']' : '';
            const desc = item.description ? ' — ' + item.description.slice(0, 300) : '';
            lines.push('- ' + item.name + code + group + ' | ' + [qty, cost, price].filter(Boolean).join(', ') + desc);
          }
          if (filtered.length > 75) lines.push('... and ' + (filtered.length - 75) + ' more items. Use search to narrow results.');
        } else if (allItems.length === 0) {
          lines.push('\nNo line items found in this document. The document may have its content stored differently.');
        } else {
          lines.push('\nNo items matching "' + input.search + '". Total items: ' + allItems.length);
        }

        if (docContent.footer) lines.push('\nFOOTER: ' + docContent.footer.slice(0, 1000));

        return JSON.stringify({ success: true, documentName: docContent.name, totalItems: allItems.length, filteredItems: filtered.length, content: lines.join('\n') });
      }

      return JSON.stringify({ error: 'Unknown tool: ' + name });
    } catch (err) {
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Tool execution failed' });
    }
  },
};

export default knowItAll;
