// @ts-nocheck
import { AgentModule, AgentContext } from './types';
import { getContact, getContactNotes, searchConversations, getConversationMessages, getContactTasks, getOpportunity } from '../ghl';
import { getActiveJobs } from '../jobtread';

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
    }

    // CONVERSATIONS & MESSAGES
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
        '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' | Status: ' + (j.status || 'N/A')
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
    return 'You are "Know it All," the AI research assistant for Brett King Builder (BKB), a high-end residential renovation and historic home restoration company in Bucks County, PA.\n\n' +
      'Your specialty is knowing EVERYTHING about every client and project. You pull data from GHL (CRM) and JobTread (project management) and give comprehensive, detailed answers.\n\n' +
      'When summarizing a client or project, include ALL available information: full profile, every note in its entirety, all communication history, tasks, custom fields, tags, opportunities, and any other data provided. Do not skip or truncate any information.\n\n' +
      'Be specific, reference real data, and be concise but thorough. If data is missing, say so honestly.\n\n' +
      (ctx.communicationChannel !== 'unknown'
        ? 'Current communication channel for this opportunity: ' + ctx.communicationChannel.toUpperCase() + ' (based on pipeline stage: ' + (ctx.pipelineStage || 'unknown') + ')\n'
        : '') +
      (ctx.jtJobId ? 'JobTread Job ID: ' + ctx.jtJobId + '\n' : '');
  },

  tools: [],  // read-only agent, no tools

  canHandle: (message: string) => {
    const lower = message.toLowerCase();
    // High score for questions, lookups, summaries
    if (/\?|what|who|when|where|how|tell me|show me|summary|overview|status|history|latest|update|details|information|look up|find out|check on/i.test(lower)) return 0.8;
    // Medium score for general client/project references
    if (/client|project|job|contact|note|message|communication/i.test(lower)) return 0.5;
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

    // Always fetch JT jobs overview
    const jt = await fetchJTContext(ctx);
    if (jt) parts.push(jt);

    return parts.join('\n\n');
  },

  executeTool: async () => {
    return JSON.stringify({ error: 'Know it All does not execute tools' });
  },
};

export default knowItAll;

