// @ts-nocheck
import { AgentModule, AgentContext } from './types';
import { getContact, getContactNotes, searchConversations, getConversationMessages, getContactTasks, getOpportunity, searchContacts as searchGHLContacts } from '../ghl';
import { getActiveJobs, getJob, getJobSchedule, getTasksForJob, getDocumentsForJob, getMembers, getAllOpenTasks } from '../../../lib/jobtread';

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
      '- get_team_members: Get list of all BKB team members with their IDs.\n\n' +
      'INSTRUCTIONS:\n' +
      '- When someone asks about a project/job, use search_jobs first to find it, then get_job_details or get_job_schedule for specifics.\n' +
      '- When listing jobs or tasks, format them clearly with job numbers and names.\n' +
      '- If you have context data injected below, use it. If not, use tools to search.\n' +
      '- Be specific, reference real data, and be concise but thorough. If data is missing, say so honestly.\n' +
      '- When summarizing, include ALL available information. Do not skip or truncate.\n\n' +
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
  ],

  canHandle: (message: string) => {
    const lower = message.toLowerCase();
    // High score for questions, lookups, summaries
    if (/\?|what|who|when|where|how|tell me|show me|summary|overview|status|history|latest|update|details|information|look up|find out|check on|list|all jobs|all tasks|open tasks|overdue/i.test(lower)) return 0.8;
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
        const jobs = await getActiveJobs(100);
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
          for (const task of phase.childTasks || []) {
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

      return JSON.stringify({ error: 'Unknown tool: ' + name });
    } catch (err) {
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Tool execution failed' });
    }
  },
};

export default knowItAll;
