// @ts-nocheck
/**
 * Field Staff Agent
 * 
 * A restricted agent for field staff (Evan, Terri) that ONLY provides:
 * 1. Approved document/specification answers (from project-details)
 * 2. Schedule task CRUD (create, edit, update progress)
 * 3. Schedule/task queries
 * 
 * NO access to: emails, PML logging, invoicing, CRM/GHL, daily logs,
 * cost groups, billing, calendar, or any other admin functions.
 */
import { AgentModule, AgentContext } from './types';
import {
  getJob,
  getActiveJobs,
  getCostItemsLightForJob,
  getDocumentCostItemsLightById,
  getDocumentStatusesForJob,
  getFilesForJob,
  getTasksForJob,
  getJobSchedule,
  getMembers,
  createTask,
  createPhaseTask,
  updateTask,
  updateTaskProgress,
  updateTaskFull,
  getOpenTasksForMember,
  JTCostItem,
  pave,
} from '@/app/lib/jobtread';

// ── Reuse the hierarchy formatter from project-details ──

function getSpecificationsUrl(job: any): string | null {
  const cfvNodes = job?.customFieldValues?.nodes || [];
  const specField = cfvNodes.find(
    (cfv: any) =>
      cfv.customField?.name?.toLowerCase().includes('specifications') &&
      cfv.customField?.name?.toLowerCase().includes('url')
  );
  return specField?.value || null;
}

function formatCostItemsWithHierarchy(
  items: JTCostItem[],
  searchTerm?: string
): { content: string; attachments: Array<{ fileName: string; downloadUrl: string; context: string }> } {
  let filtered = items;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = items.filter((item) => {
      const searchable = [
        item.name, item.description, item.costGroup?.name,
        item.costGroup?.description, item.costGroup?.parentCostGroup?.name,
        item.costGroup?.parentCostGroup?.description,
        item.costCode?.name, item.costCode?.number, item.status,
        item.internalNotes, item.vendor,
      ].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(term);
    });
    if (filtered.length === 0) {
      filtered = items.filter((item) => {
        const areaName = (item.costGroup?.parentCostGroup?.name || '').toLowerCase();
        return areaName.includes(term);
      });
    }
  }

  const allAttachments: Array<{ fileName: string; downloadUrl: string; context: string }> = [];
  const seenFileIds = new Set<string>();
  function collectFile(file: any, context: string) {
    if (!file?.url && !file?.id) return;
    const fileKey = file.id || file.url;
    if (seenFileIds.has(fileKey)) return;
    seenFileIds.add(fileKey);
    allAttachments.push({ fileName: file.name || 'attachment', downloadUrl: file?.url || '', context });
  }

  const areaMap = new Map<string, Map<string, JTCostItem[]>>();
  const groupFiles = new Map<string, Array<{ id?: string; name: string; url: string }>>();
  const areaFiles = new Map<string, Array<{ id?: string; name: string; url: string }>>();

  for (const item of filtered) {
    const areaName = item.costGroup?.parentCostGroup?.name || 'General';
    const groupName = item.costGroup?.name || 'Ungrouped';
    if (!areaMap.has(areaName)) areaMap.set(areaName, new Map());
    const groupMap = areaMap.get(areaName)!;
    if (!groupMap.has(groupName)) groupMap.set(groupName, []);
    groupMap.get(groupName)!.push(item);
    if (item.files && item.files.length > 0) {
      for (const file of item.files) collectFile(file, groupName + ' > ' + item.name);
    }
    if (item.costGroup?.files && item.costGroup.files.length > 0) {
      if (!groupFiles.has(groupName)) groupFiles.set(groupName, []);
      for (const file of item.costGroup.files) {
        if (file.url) {
          const existing = groupFiles.get(groupName)!;
          if (!existing.some(f => f.url === file.url)) { existing.push(file); collectFile(file, groupName); }
        }
      }
    }
    if (item.costGroup?.parentCostGroup?.files && item.costGroup.parentCostGroup.files.length > 0) {
      if (!areaFiles.has(areaName)) areaFiles.set(areaName, []);
      for (const file of item.costGroup.parentCostGroup.files) {
        if (file.url) {
          const existing = areaFiles.get(areaName)!;
          if (!existing.some(f => f.url === file.url)) { existing.push(file); collectFile(file, areaName); }
        }
      }
    }
  }

  const lines: string[] = [];
  lines.push('APPROVED SPECIFICATIONS (' + filtered.length + ' items from signed contracts/COs' + (searchTerm ? ', matching "' + searchTerm + '"' : '') + ')');
  lines.push('');
  for (const [areaName, groupMap] of areaMap) {
    lines.push('');
    lines.push('='.repeat(45));
    lines.push('AREA: ' + areaName);
    lines.push('='.repeat(45));
    const firstGroupInArea = Array.from(groupMap.values())[0];
    const areaDesc = firstGroupInArea?.[0]?.costGroup?.parentCostGroup?.description;
    if (areaDesc) { lines.push('  [Area Note: ' + (areaDesc.length > 400 ? areaDesc.slice(0, 400) + '...' : areaDesc) + ']'); }
    const areaFileList = areaFiles.get(areaName);
    if (areaFileList && areaFileList.length > 0) {
      for (const file of areaFileList) lines.push('  FILE: ' + file.name);
    }
    lines.push('');
    for (const [groupName, groupItems] of groupMap) {
      lines.push('--- ' + groupName + ' (' + groupItems.length + ' items) ---');
      const groupDesc = groupItems[0]?.costGroup?.description;
      if (groupDesc) lines.push('  [Group Specification: ' + (groupDesc.length > 400 ? groupDesc.slice(0, 400) + '...' : groupDesc) + ']');
      const gFiles = groupFiles.get(groupName);
      if (gFiles && gFiles.length > 0) { for (const file of gFiles) lines.push('  FILE: ' + file.name); }
      for (const item of groupItems) {
        const code = item.costCode ? ' (' + item.costCode.number + ')' : '';
        lines.push('  * ' + item.name + code);
        if (item.description) lines.push('    ' + (item.description.length > 300 ? item.description.slice(0, 300) + '...' : item.description));
        if ((item as any).documentName) lines.push('    [Doc: ' + (item as any).documentName + ']');
        const customParts: string[] = [];
        if (item.status) customParts.push('Status: ' + item.status);
        if (item.vendor) customParts.push('Vendor: ' + item.vendor);
        if (customParts.length > 0) lines.push('    [' + customParts.join(' | ') + ']');
        if (item.internalNotes) lines.push('    Internal Notes: ' + item.internalNotes);
        if (item.files && item.files.length > 0) { for (const file of item.files) { if (file.url || file.id) lines.push('    FILE: ' + file.name); } }
      }
      lines.push('');
    }
  }
  if (filtered.length === 0) {
    lines.push(searchTerm ? 'No specifications found matching "' + searchTerm + '". Try a broader term.' : 'No specification items found for this job.');
  }
  if (allAttachments.length > 0) {
    lines.push('');
    lines.push('(' + allAttachments.length + ' file attachments found)');
  }
  return { content: lines.join('\n'), attachments: allAttachments };
}

const fieldStaff: AgentModule = {
  name: 'field-staff',
  description: 'Restricted agent for field staff — approved specs + schedule task management only.',
  icon: '👷',

  systemPrompt: (ctx: AgentContext, _userMessage?: string) => {
    return (
      'You are the Field Staff Assistant for Brett King Builder (BKB). You help field team members with THREE things:\n\n' +
      '1. APPROVED SPECIFICATIONS: Answer questions about what materials, fixtures, and finishes are specified ' +
      'in approved contracts and change orders. You ONLY use data from APPROVED documents — never guess or make up info.\n\n' +
      '2. SCHEDULE & TASKS: Help view, create, edit, and update task progress on JobTread schedules. ' +
      'You can show tasks for any job, create new tasks, mark tasks complete, reschedule tasks, and update task details.\n\n' +
      '3. CHANGE ORDER SUBMISSION: Help field staff propose and submit change orders when scope changes occur.\n\n' +
      'WHAT YOU CANNOT DO (and should say so if asked):\n' +
      '- You cannot access emails, CRM contacts, or GoHighLevel data\n' +
      '- You cannot create or manage daily logs\n' +
      '- You cannot manage invoicing, billing, or cost groups directly\n' +
      '- You cannot log project events or access the Project Memory Layer\n' +
      '- You cannot access calendars or schedule meetings\n' +
      '- For anything outside specs, tasks, and COs, tell the user to ask Nathan or check the full dashboard.\n\n' +
      'RESPONSE STYLE:\n' +
      '- Keep answers concise and practical — field staff need quick, clear info\n' +
      '- For specs: organize by area/location, include specific details (brands, models, measurements)\n' +
      '- For tasks: show task name, due date, progress, and assignee\n' +
      '- Always confirm before creating or modifying tasks\n\n' +
      'TASK CREATION RULES:\n' +
      '- When asked to create a task, output a @@TASK_CONFIRM@@ block for user approval\n' +
      '- NEVER call create_jobtread_task or create_phase_task directly without user approval\n' +
      '- Format: @@TASK_CONFIRM@@{"name":"...","phase":"...","endDate":"...","assignee":"...","description":"..."}@@END_CONFIRM@@\n\n' +
      'CHANGE ORDER SUBMISSION:\n' +
      'When a user wants to submit a change order, follow this flow:\n' +
      '1. Ask which job the change order is for (or confirm if already in context)\n' +
      '2. Ask for a description of what changed\n' +
      '3. Ask targeted questions — ask as many as needed:\n' +
      '   - How many BKB labor hours should we plan for? What trade?\n' +
      '   - Are any subcontractors needed? Which ones and do you have pricing?\n' +
      '   - What materials are needed (if any)?\n' +
      '   - Do you have all the details or does this need follow-up from Nathan/Terri?\n' +
      '   - If follow-up needed: what should the follow-up task say and when is it due?\n' +
      '   - Should we create a draft Change Order document for Nathan to review?\n' +
      '4. Ask if they have any photos to include (e.g., rot damage, existing conditions, scope reference)\n' +
      '   - If they uploaded images, their public URLs will be in the conversation context as imageUrls\n' +
      '   - Include these URLs in your CO proposal so they get attached to the budget group in JobTread\n' +
      '5. When you have enough info, output a @@CO_PROPOSAL@@ block for approval:\n' +
      '   @@CO_PROPOSAL@@{"coName":"Short descriptive name","jobId":"...","groupDescription":"Client-facing markdown description...","lineItems":[{"name":"Item name","description":"Installer-facing description","costCodeNumber":"04","costTypeName":"Subcontractor","unitName":"Lump Sum","quantity":1,"unitCost":500,"unitPrice":714.29}],"imageUrls":["https://..."],"createDocument":true/false,"followUp":{"needed":true,"assignTo":"nathan","description":"Review and send CO for upgraded flooring","dueDate":"2026-04-02"}}@@END_CO@@\n' +
      '6. NEVER create budget items directly — always output the proposal for user approval first\n\n' +
      'GROUP DESCRIPTION (REQUIRED — this is client-facing and appears on the CO document):\n' +
      'The `groupDescription` field is CRITICAL — it goes on the cost group in JobTread and flows through to the Change Order document the client sees.\n' +
      'Write it as a professional, client-facing scope description using markdown formatting. Example format:\n' +
      '```\n' +
      '### Change Order – Kitchen Window Rot Repair\n\n' +
      'During renovation, rot damage was discovered at the kitchen window header. The following repairs are required:\n\n' +
      '- Sister rotted framing members with pressure-treated lumber\n' +
      '- Install Grace Ice & Water Shield moisture barrier\n' +
      '- Apply Sashco sealant for long-term weather protection\n\n' +
      'NOTE:\n' +
      '- If additional rot is found behind the existing framing, further repairs may be necessary and will be priced separately.\n' +
      '```\n' +
      'The description should:\n' +
      '- Start with a markdown heading (### Change Order – [Name])\n' +
      '- Briefly explain WHY the change is needed (what was discovered/requested)\n' +
      '- List the specific work items in bullet points\n' +
      '- Include any relevant notes or caveats at the bottom\n' +
      '- Be written for the CLIENT, not internal use — professional and clear\n' +
      '- Reference specific materials, brands, or methods when known\n\n' +
      'CHANGE ORDER PRICING RULES:\n' +
      '- BKB Labor: $85/hr cost, $125/hr price (32% margin)\n' +
      '- Subcontractor: cost / 0.70 = price (30% margin)\n' +
      '- Materials: cost / 0.70 = price (30% margin)\n' +
      '- If Evan gives hours, calculate: hours × $85 = cost, hours × $125 = price\n' +
      '- If Evan gives a sub quote, that\'s the cost — price = cost / 0.70\n' +
      '- Use Lump Sum (qty=1) when exact quantities are unknown\n' +
      '- Cost code should match the trade (04=framing, 10=plumbing, 12=electrical, etc.)\n\n' +
      'GROUP HIERARCHY FOR CHANGE ORDERS:\n' +
      'Always structure as: ➕/➖ Post Pricing Changes > [Change Order Name]\n' +
      'The "➕/➖ Post Pricing Changes" group is the root for all COs in BKB budgets.\n' +
      'New COs go directly under the Post Pricing Changes root group.\n' +
      'The Change Order Name should clearly describe what changed.\n\n' +
      (ctx.jtJobId ? 'JobTread Job ID: ' + ctx.jtJobId + '\n' : '') +
      (ctx.contactName ? 'Client: ' + ctx.contactName + '\n' : '') +
      (ctx.opportunityName ? 'Project: ' + ctx.opportunityName + '\n' : '')
    );
  },

  tools: [
    // ── SPEC TOOLS ──
    {
      name: 'search_jobs',
      description: 'Search for JobTread jobs by name, number, or client.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search term' } }, required: ['query'] },
    },
    {
      name: 'get_project_details',
      description: 'Get approved specifications for a job. ONLY returns items from approved contracts and change orders. Use search to filter by keyword.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          search: { type: 'string', description: 'Optional keyword filter (e.g. "siding", "plumbing", "flooring")' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_files',
      description: 'Get files/attachments uploaded to a job.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    // ── SCHEDULE/TASK TOOLS ──
    {
      name: 'get_job_tasks',
      description: 'Get all tasks for a specific job with progress, dates, and assignees.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_job_schedule',
      description: 'Get the full phase/task hierarchy (schedule) for a job.',
      input_schema: { type: 'object', properties: { jobId: { type: 'string', description: 'The JobTread Job ID' } }, required: ['jobId'] },
    },
    {
      name: 'get_member_tasks',
      description: 'Get all open tasks assigned to a specific team member.',
      input_schema: { type: 'object', properties: { membershipId: { type: 'string', description: 'The membership ID' } }, required: ['membershipId'] },
    },
    {
      name: 'get_members',
      description: 'Get all team members with their membership IDs.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'create_jobtread_task',
      description: 'Create a new task on a job.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          name: { type: 'string', description: 'Task name' },
          description: { type: 'string', description: 'Task description (optional)' },
          startDate: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
          endDate: { type: 'string', description: 'Due date YYYY-MM-DD (optional)' },
          assignTo: { type: 'string', description: 'Team member name (optional)' },
        },
        required: ['jobId', 'name'],
      },
    },
    {
      name: 'create_phase_task',
      description: 'Create a task within a specific phase.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          parentGroupId: { type: 'string', description: 'The phase ID' },
          name: { type: 'string', description: 'Task name' },
          description: { type: 'string', description: 'Task description (optional)' },
          startDate: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
          endDate: { type: 'string', description: 'Due date YYYY-MM-DD (optional)' },
          assignTo: { type: 'string', description: 'Team member name (optional)' },
        },
        required: ['jobId', 'parentGroupId', 'name'],
      },
    },
    {
      name: 'update_task_progress',
      description: 'Update task progress. 0 = not started, 0.5 = in progress, 1 = complete.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID' },
          progress: { type: 'number', description: '0, 0.5, or 1' },
        },
        required: ['taskId', 'progress'],
      },
    },
    {
      name: 'update_task',
      description: 'Update task details — name, dates, description, or progress.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID' },
          name: { type: 'string', description: 'New name (optional)' },
          startDate: { type: 'string', description: 'New start date YYYY-MM-DD (optional)' },
          endDate: { type: 'string', description: 'New due date YYYY-MM-DD (optional)' },
          description: { type: 'string', description: 'New description (optional)' },
          progress: { type: 'number', description: '0, 0.5, or 1 (optional)' },
        },
        required: ['taskId'],
      },
    },
    {
      name: 'update_task_full',
      description: 'Advanced task update — change assignees, times, and all fields.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID' },
          name: { type: 'string' }, description: { type: 'string' },
          startDate: { type: 'string' }, endDate: { type: 'string' },
          startTime: { type: 'string' }, endTime: { type: 'string' },
          progress: { type: 'number' },
          assignTo: { type: 'string', description: 'Comma-separated team member names' },
        },
        required: ['taskId'],
      },
    },
    {
      name: 'get_job_budget_context',
      description: 'Get existing budget groups and change orders for a job to understand context before creating a new CO.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'create_change_order',
      description: 'Create a change order in the job budget with line items, optional draft document, and optional follow-up task. Only call after user approves the @@CO_PROPOSAL@@.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          coName: { type: 'string', description: 'Change order name (e.g., "Additional Electrical Outlets")' },
          lineItems: {
            type: 'array',
            description: 'Array of budget line items',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                costCodeNumber: { type: 'string' },
                costTypeName: { type: 'string' },
                unitName: { type: 'string' },
                quantity: { type: 'number' },
                unitCost: { type: 'number' },
                unitPrice: { type: 'number' },
              },
            },
          },
          createDocument: { type: 'boolean', description: 'Whether to create a draft CO document' },
          groupDescription: { type: 'string', description: 'REQUIRED. Professional, client-facing markdown description for the CO group. This appears on the CO document the client sees. Use markdown heading, bullet points for work items, and any relevant notes/caveats.' },
          imageUrls: {
            type: 'array',
            description: 'Public URLs of photos to attach to the CO group (from /api/upload)',
            items: { type: 'string' },
          },
          followUp: {
            type: 'object',
            description: 'Optional follow-up task',
            properties: {
              needed: { type: 'boolean' },
              assignTo: { type: 'string' },
              description: { type: 'string' },
              dueDate: { type: 'string' },
            },
          },
        },
        required: ['jobId', 'coName', 'lineItems', 'groupDescription'],
      },
    },
  ],

  canHandle: (message: string): number => {
    // Field staff agent handles everything when forced — scoring is for fallback only
    const lower = message.toLowerCase();
    if (/(spec|specification|material|what.*door|what.*window|what.*floor|what.*cabinet|what.*counter|what.*tile|what.*siding|what.*approved|what.*planned)/i.test(lower)) return 0.95;
    if (/(change\s*order|co\s*submit|submit.*co|new.*co)/i.test(lower)) return 0.95;
    if (/(task|schedule|assign|due|progress|complete|mark.*done|create.*task|update.*task)/i.test(lower)) return 0.90;
    if (/(what.*included|scope|contract)/i.test(lower)) return 0.85;
    return 0.5; // Default moderate score — this agent is always forced for field staff
  },

  fetchContext: async (ctx: AgentContext): Promise<string> => {
    if (!ctx.jtJobId) return '';
    try {
      const job = await getJob(ctx.jtJobId);
      if (!job) return '';
      const specUrl = getSpecificationsUrl(job);
      const lines: string[] = [];
      lines.push('Job: ' + job.name + ' (#' + job.number + ')');
      lines.push('Client: ' + job.clientName);
      if (specUrl) lines.push('Specifications URL: ' + specUrl);
      return lines.join('\n');
    } catch { return ''; }
  },

  executeTool: async (name: string, input: any, ctx: AgentContext): Promise<string> => {
    try {
      // ── SPEC TOOLS ──
      if (name === 'search_jobs') {
        const allJobs = await getActiveJobs(50);
        const query = (input.query || '').toLowerCase().trim();
        let filtered = allJobs;
        if (query) {
          filtered = allJobs.filter((j: any) => {
            const searchable = [j.name, j.number, j.clientName, j.locationName].filter(Boolean).join(' ').toLowerCase();
            return searchable.includes(query);
          });
        }
        if (!filtered || filtered.length === 0) return JSON.stringify({ success: true, message: 'No jobs found matching "' + input.query + '".' });
        return JSON.stringify({
          success: true, count: filtered.length,
          jobs: filtered.slice(0, 10).map((j: any) => ({ id: j.id, name: j.name, number: j.number, client: j.clientName || '' })),
        });
      }

      if (name === 'get_project_details') {
        const jobId = input.jobId;
        const searchTerm = (input.search || '').trim();
        const job = await getJob(jobId);
        const specUrl = job ? getSpecificationsUrl(job) : null;
        const [docStatuses, budgetCostItems] = await Promise.all([
          getDocumentStatusesForJob(jobId),
          getCostItemsLightForJob(jobId, 500),
        ]);
        const approvedDocIds = new Set<string>();
        const approvedCustomerOrderIds: string[] = [];
        const docNameMap = new Map<string, string>();
        for (const doc of docStatuses) {
          const docNum = (doc as any).number;
          const baseName = doc.name || doc.type || 'Document';
          const docLabel = docNum ? baseName + ' #' + docNum : baseName;
          docNameMap.set(doc.id, docLabel);
          // Skip docs flagged "Exclude from Budget" in JT — their items don't
          // belong to the committed/approved project scope surfaced to staff.
          if (doc.status === 'approved' && (doc as any).includeInBudget !== false) {
            approvedDocIds.add(doc.id);
            if (doc.type === 'customerOrder') approvedCustomerOrderIds.push(doc.id);
          }
        }
        const budgetItemsWithApprovedDoc = budgetCostItems.filter((item: any) => {
          const docId = item.document?.id;
          return docId && approvedDocIds.has(docId);
        });
        const docItemPromises = approvedCustomerOrderIds.map(docId => getDocumentCostItemsLightById(docId));
        const docItemArrays = await Promise.all(docItemPromises);
        // Unselected options can live at the item level OR at the (parent) cost group level —
        // e.g. sibling cost groups "Base Cabinets" vs "Base + Upper Cabinets" where only one
        // group is checked. Filter all three levels so the field crew never sees unapproved
        // options mixed in with approved scope.
        const isUnselectedOption = (item: any): boolean => {
          if (item.isSelected === false) return true;
          if (item.costGroup?.isSelected === false) return true;
          if (item.costGroup?.parentCostGroup?.isSelected === false) return true;
          return false;
        };
        const unselectedItemIds = new Set<string>();
        for (const items of docItemArrays) {
          for (const item of items) { if (isUnselectedOption(item)) unselectedItemIds.add(item.id); }
        }
        const filteredBudgetItems = budgetItemsWithApprovedDoc.filter((item: any) => !unselectedItemIds.has(item.id));
        const seenIds = new Set(filteredBudgetItems.map((item: any) => item.id));
        const docLevelItems: any[] = [];
        for (const items of docItemArrays) {
          for (const item of items) {
            if (isUnselectedOption(item)) continue;
            if (!seenIds.has(item.id)) { seenIds.add(item.id); docLevelItems.push(item); }
          }
        }
        const costItems = [...filteredBudgetItems, ...docLevelItems];
        // Enrich missing custom fields
        const budgetByKey = new Map<string, any>();
        for (const bi of budgetCostItems) {
          const key = (bi.name || '').toLowerCase() + '::' + (bi.costGroup?.name || '').toLowerCase();
          if (bi.status || bi.vendor || bi.internalNotes) budgetByKey.set(key, bi);
        }
        for (const item of costItems) {
          if (!item.status && !item.vendor && !item.internalNotes) {
            const key = (item.name || '').toLowerCase() + '::' + (item.costGroup?.name || '').toLowerCase();
            const match = budgetByKey.get(key);
            if (match) { item.status = match.status; item.vendor = match.vendor; item.internalNotes = match.internalNotes; }
          }
        }
        if (!costItems || costItems.length === 0) {
          return JSON.stringify({ success: false, specificationsUrl: specUrl, message: 'No approved specification items found.' });
        }
        for (const item of costItems) {
          const docId = item.document?.id;
          if (docId) { (item as any).documentName = docNameMap.get(docId) || 'Approved Document'; }
        }
        const { content, attachments } = formatCostItemsWithHierarchy(costItems, searchTerm || undefined);
        let finalContent = content;
        if (finalContent.length > 8000) finalContent = finalContent.slice(0, 8000) + '\n\n... [Truncated. Use a search term to narrow results.]';
        return JSON.stringify({
          success: true, source: 'approved_documents_only', specificationsUrl: specUrl,
          totalApprovedItems: costItems.length, content: finalContent, fileCount: attachments.length,
          _fileLinks: attachments.map(a => ({ name: a.fileName, url: a.downloadUrl, context: a.context })),
        });
      }

      if (name === 'get_job_files') {
        const files = await getFilesForJob(input.jobId);
        if (!files || files.length === 0) return JSON.stringify({ success: true, message: 'No files found.' });
        return JSON.stringify({
          success: true, count: files.length,
          files: files.slice(0, 30).map((f: any) => ({ id: f.id, name: f.name, type: f.contentType || 'unknown' })),
        });
      }

      // ── SCHEDULE/TASK TOOLS ──
      if (name === 'get_job_tasks') {
        const tasks = await getTasksForJob(input.jobId);
        if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, message: 'No tasks found.' });
        const formatted = tasks.filter((t: any) => !t.isGroup).map((t: any) => ({
          id: t.id, name: t.name,
          progress: t.progress !== null ? Math.round((t.progress || 0) * 100) + '%' : 'Not started',
          startDate: t.startDate || null, endDate: t.endDate || null,
          assignees: t.assignees?.map((a: any) => a.user?.name || a.name).filter(Boolean) || [],
        }));
        return JSON.stringify({ success: true, count: formatted.length, tasks: formatted });
      }

      if (name === 'get_job_schedule') {
        const schedule = await getJobSchedule(input.jobId);
        if (!schedule) return JSON.stringify({ success: true, message: 'No schedule found.' });
        return JSON.stringify({ success: true, schedule });
      }

      if (name === 'get_member_tasks') {
        const tasks = await getOpenTasksForMember(input.membershipId);
        if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, message: 'No open tasks found.' });
        return JSON.stringify({ success: true, count: tasks.length, tasks: tasks.slice(0, 50) });
      }

      if (name === 'get_members') {
        const members = await getMembers();
        return JSON.stringify({
          success: true,
          members: members.map((m: any) => ({ id: m.id, name: m.user?.name || 'Unknown', email: m.user?.email })),
        });
      }

      if (name === 'create_jobtread_task') {
        let assignedMembershipIds: string[] | undefined;
        if (input.assignTo) {
          const members = await getMembers();
          const search = input.assignTo.toLowerCase();
          const match = members.find((m: any) => (m.user?.name || '').toLowerCase().includes(search));
          if (match) assignedMembershipIds = [match.id];
        }
        const result = await createTask({
          jobId: input.jobId, name: input.name, description: input.description,
          startDate: input.startDate || input.endDate, endDate: input.endDate || input.startDate,
          assignedMembershipIds,
        });
        return JSON.stringify({ success: true, task: { id: result.id, name: result.name } });
      }

      if (name === 'create_phase_task') {
        let assignedMembershipIds: string[] | undefined;
        if (input.assignTo) {
          const members = await getMembers();
          const search = input.assignTo.toLowerCase();
          const match = members.find((m: any) => (m.user?.name || '').toLowerCase().includes(search));
          if (match) assignedMembershipIds = [match.id];
        }
        const result = await createPhaseTask({
          jobId: input.jobId, parentGroupId: input.parentGroupId, name: input.name,
          description: input.description, startDate: input.startDate || input.endDate,
          endDate: input.endDate || input.startDate, assignedMembershipIds,
        });
        return JSON.stringify({ success: true, task: { id: result.id, name: result.name } });
      }

      if (name === 'update_task_progress') {
        await updateTaskProgress(input.taskId, input.progress);
        const label = input.progress === 1 ? 'complete' : input.progress === 0.5 ? 'in progress' : 'not started';
        return JSON.stringify({ success: true, message: 'Task marked as ' + label });
      }

      if (name === 'update_task') {
        const updates: any = {};
        if (input.name) updates.name = input.name;
        if (input.startDate) updates.startDate = input.startDate;
        if (input.endDate) updates.endDate = input.endDate;
        if (input.description) updates.description = input.description;
        if (input.progress !== undefined) updates.progress = input.progress;
        await updateTask(input.taskId, updates);
        return JSON.stringify({ success: true, message: 'Task updated' });
      }

      if (name === 'update_task_full') {
        let assignedMembershipIds: string[] | undefined;
        if (input.assignTo) {
          const members = await getMembers();
          const names = input.assignTo.split(',').map((n: string) => n.trim().toLowerCase());
          assignedMembershipIds = [];
          for (const name of names) {
            const match = members.find((m: any) => (m.user?.name || '').toLowerCase().includes(name));
            if (match) assignedMembershipIds.push(match.id);
          }
        }
        await updateTaskFull(input.taskId, {
          name: input.name, description: input.description,
          startDate: input.startDate, endDate: input.endDate,
          startTime: input.startTime, endTime: input.endTime,
          progress: input.progress, assignedMembershipIds,
        });
        return JSON.stringify({ success: true, message: 'Task updated' });
      }

      if (name === 'get_job_budget_context') {
        try {
          // Lightweight fetch of cost groups to see existing COs
          const [groupData, docs] = await Promise.all([
            pave({
              job: {
                $: { id: input.jobId },
                costGroups: {
                  $: { size: 200 },
                  nodes: {
                    id: {},
                    name: {},
                    parentCostGroup: { id: {}, name: {} },
                  },
                },
              },
            }),
            getDocumentStatusesForJob(input.jobId),
          ]);

          const groups = (groupData as any)?.job?.costGroups?.nodes || [];

          // Find the Post Pricing root
          const postPricingRoot = groups.find((g: any) =>
            /post\s*pricing/i.test(g.name || '')
          );

          // Org group detection (same as dashboard)
          const ORG_PATTERNS = [
            /^(✅|🚫|🟡|🔴|🟢|⬜)\s/,
            /^(client requested|trade walk|os out of scope|approved|declined|pending)$/i,
          ];
          const isOrgGroup = (n: string) => ORG_PATTERNS.some(p => p.test(n.trim()));

          let existingCOs: string[] = [];
          let clientRequestedGroupId: string | null = null;

          if (postPricingRoot) {
            const directChildren = groups.filter((g: any) =>
              g.parentCostGroup?.id === postPricingRoot.id
            );
            const orgGroupIds = new Set<string>();
            for (const g of directChildren) {
              if (isOrgGroup(g.name || '')) {
                orgGroupIds.add(g.id);
                if (/client\s*requested/i.test(g.name || '')) {
                  clientRequestedGroupId = g.id;
                }
              } else {
                existingCOs.push(g.name);
              }
            }
            // COs nested under org groups
            if (orgGroupIds.size > 0) {
              for (const g of groups) {
                if (g.parentCostGroup?.id && orgGroupIds.has(g.parentCostGroup.id)) {
                  existingCOs.push(g.name);
                }
              }
            }
          }

          const coDocs = docs.filter((d: any) =>
            d.type === 'customerOrder' && /change\s*order|\bbillable\s+co\b|^co\b/i.test(d.name || '')
          );

          return JSON.stringify({
            success: true,
            postPricingGroupId: postPricingRoot?.id || null,
            clientRequestedGroupId,
            existingCOs,
            coDocuments: coDocs.map((d: any) => ({ name: d.name, number: d.number, status: d.status })),
            nextCONumber: existingCOs.length + 1,
          });
        } catch (err: any) {
          return JSON.stringify({ success: false, error: 'Failed to fetch job context: ' + (err?.message || 'Unknown error') });
        }
      }

      if (name === 'create_change_order') {
        try {
          const { jobId, coName, lineItems, createDocument, followUp, imageUrls, groupDescription } = input;

          if (!lineItems || lineItems.length === 0) {
            return JSON.stringify({ success: false, error: 'No line items provided' });
          }

          const totalCost = lineItems.reduce((sum: number, item: any) => sum + ((item.unitCost || 0) * (item.quantity || 1)), 0);
          const totalPrice = lineItems.reduce((sum: number, item: any) => sum + ((item.unitPrice || 0) * (item.quantity || 1)), 0);

          // ── Step 1: Fetch cost codes, cost types, and units for ID resolution ──
          const [ccData, ctData, uData] = await Promise.all([
            pave({ organization: { $: { id: process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe' }, costCodes: { $: { size: 50 }, nodes: { id: {}, name: {}, number: {} } } } }),
            pave({ organization: { $: { id: process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe' }, costTypes: { $: { size: 20 }, nodes: { id: {}, name: {} } } } }),
            pave({ organization: { $: { id: process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe' }, units: { $: { size: 20 }, nodes: { id: {}, name: {} } } } }),
          ]);

          const costCodes = (ccData as any)?.organization?.costCodes?.nodes || [];
          const costTypes = (ctData as any)?.organization?.costTypes?.nodes || [];
          const units = (uData as any)?.organization?.units?.nodes || [];

          const codeMap = new Map(costCodes.map((c: any) => [c.number, c.id]));
          const typeMap = new Map(costTypes.map((t: any) => [t.name.toLowerCase(), t.id]));
          const unitMap = new Map(units.map((u: any) => [u.name.toLowerCase(), u.id]));
          // Common abbreviations
          const abbrevMap: Record<string, string> = {
            'ea': 'each', 'ls': 'lump sum', 'sf': 'square feet', 'lf': 'linear feet',
            'hr': 'hours', 'hrs': 'hours', 'sq': 'squares', 'mo': 'months', 'day': 'days',
          };
          for (const [abbr, full] of Object.entries(abbrevMap)) {
            const id = unitMap.get(full);
            if (id) unitMap.set(abbr, id);
          }

          // ── Step 2: Find or create Post Pricing > Client Requested hierarchy ──
          const groupData = await pave({
            job: {
              $: { id: jobId },
              costGroups: {
                $: { size: 200 },
                nodes: { id: {}, name: {}, parentCostGroup: { id: {}, name: {} } },
              },
            },
          });
          const allGroups = (groupData as any)?.job?.costGroups?.nodes || [];

          // Find the Post Pricing root group
          let postPricingRoot = allGroups.find((g: any) =>
            /post\s*pricing/i.test(g.name || '')
          );

          if (!postPricingRoot) {
            // Create "➕/➖ Post Pricing Changes" at job level
            const createRootResult = await pave({
              createCostGroup: {
                $: { jobId, name: '➕/➖ Post Pricing Changes' },
                createdCostGroup: { id: {}, name: {} },
              },
            });
            postPricingRoot = (createRootResult as any)?.createCostGroup?.createdCostGroup;
            if (!postPricingRoot?.id) throw new Error('Failed to create Post Pricing Changes group');
          }

          // ── Step 3: Create the CO subgroup directly under Post Pricing root ──
          const coGroupDesc = groupDescription || `Change order: ${coName}\n\nTotal: $${totalPrice.toFixed(2)}\nLine items: ${lineItems.length}`;
          const createGroupResult = await pave({
            createCostGroup: {
              $: {
                parentCostGroupId: postPricingRoot.id,
                name: coName,
                description: coGroupDesc,
              },
              createdCostGroup: { id: {}, name: {} },
            },
          });
          const coGroup = (createGroupResult as any)?.createCostGroup?.createdCostGroup;
          if (!coGroup?.id) throw new Error('Failed to create CO group: ' + coName);

          // ── Step 4: Create cost items under the CO group ──
          const createdItems: string[] = [];
          const itemIds: string[] = [];

          for (const item of lineItems) {
            const costCodeId = codeMap.get(item.costCodeNumber) || '';
            const costTypeId = typeMap.get((item.costTypeName || 'materials').toLowerCase()) || '';
            const unitId = unitMap.get((item.unitName || 'lump sum').toLowerCase()) || '';

            const createItemResult = await pave({
              createCostItem: {
                $: {
                  costGroupId: coGroup.id,
                  name: item.name,
                  ...(item.description ? { description: item.description } : {}),
                  ...(costCodeId ? { costCodeId } : {}),
                  ...(costTypeId ? { costTypeId } : {}),
                  ...(unitId ? { unitId } : {}),
                  quantity: item.quantity || 1,
                  unitCost: item.unitCost || 0,
                  unitPrice: item.unitPrice || 0,
                },
                createdCostItem: { id: {}, name: {} },
              },
            });
            const created = (createItemResult as any)?.createCostItem?.createdCostItem;
            if (created?.id) {
              itemIds.push(created.id);
              createdItems.push(`✓ ${item.name} (${item.quantity || 1} × $${(item.unitPrice || 0).toFixed(2)})`);
            } else {
              createdItems.push(`✗ Failed: ${item.name}`);
            }
          }

          // ── Step 5: Upload images and attach to CO group ──
          const imageResults: string[] = [];
          if (imageUrls && imageUrls.length > 0) {
            for (const imgUrl of imageUrls) {
              try {
                // Upload file to the job
                const fileName = imgUrl.split('/').pop() || 'co-photo.jpg';
                const uploadResult = await pave({
                  createFile: {
                    $: {
                      targetType: 'job',
                      targetId: jobId,
                      url: imgUrl,
                      name: fileName,
                    },
                    createdFile: { id: {}, name: {}, url: {} },
                  },
                });
                const uploadedFile = (uploadResult as any)?.createFile?.createdFile;

                if (uploadedFile?.id) {
                  // Attach to the CO cost group
                  await pave({
                    createFile: {
                      $: {
                        targetType: 'costGroup',
                        targetId: coGroup.id,
                        url: imgUrl,
                        name: fileName,
                      },
                      createdFile: { id: {} },
                    },
                  });
                  imageResults.push(`✓ ${fileName} attached to CO group`);
                }
              } catch (imgErr: any) {
                imageResults.push(`✗ Image upload failed: ${imgErr?.message || 'unknown error'}`);
              }
            }
          }

          // ── Step 6: Create draft CO document if requested ──
          let documentResult = null;
          if (createDocument) {
            try {
              // Create a customerOrder document from the CO group's cost items
              // IMPORTANT: JobTread requires `name` to match an existing template name exactly.
              // Use "Change Order" as the name and put the specific CO title in `subject`.
              // documentTemplateId 22PKqytScJpC = "Change Order" template (from: Terri, due: 5 days)
              const docResult = await pave({
                createDocument: {
                  $: {
                    jobId,
                    type: 'customerOrder',
                    name: 'Change Order',
                    subject: coName,
                    description: groupDescription || `Change order: ${coName}`,
                    documentTemplateId: '22PKqytScJpC',
                    ...(itemIds.length > 0 ? { costItemIds: itemIds } : {}),
                  },
                  createdDocument: { id: {}, name: {}, number: {}, subject: {} },
                },
              });
              const doc = (docResult as any)?.createDocument?.createdDocument;
              if (doc?.id) {
                documentResult = { id: doc.id, name: doc.name, subject: doc.subject || coName, number: doc.number, status: 'draft' };
              }
            } catch (docErr: any) {
              documentResult = { error: 'Draft document creation failed: ' + (docErr?.message || '') };
            }
          }

          // ── Step 7: Always create a follow-up task for Nathan ──
          let taskResult = null;
          try {
            const members = await getMembers();
            const nathan = members.find((m: any) => (m.user?.name || '').toLowerCase().includes('nathan'));
            const assignedMembershipIds = nathan ? [nathan.id] : [];

            const taskName = followUp?.needed
              ? `CO Follow-up: ${coName}`
              : `Review CO: ${coName}`;
            const taskDesc = followUp?.needed
              ? (followUp.description || `Follow up and finalize change order: ${coName}`)
              : `Change order submitted by field staff. Review budget items and ${createDocument ? 'review draft document' : 'create CO document'}.\n\nChange Order: ${coName}\nLine Items: ${lineItems.length}\nTotal: $${totalPrice.toFixed(2)}`;
            const dueDate = followUp?.dueDate || new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

            // If followUp specifies a different assignee, find them
            let taskAssignees = assignedMembershipIds;
            if (followUp?.assignTo && followUp.assignTo.toLowerCase() !== 'nathan') {
              const search = followUp.assignTo.toLowerCase();
              const match = members.find((m: any) => (m.user?.name || '').toLowerCase().includes(search));
              if (match) taskAssignees = [match.id];
            }

            const task = await createTask({
              jobId,
              name: taskName,
              description: taskDesc,
              startDate: new Date().toISOString().split('T')[0],
              endDate: dueDate,
              assignedMembershipIds: taskAssignees,
            });
            taskResult = { id: task.id, name: task.name, assignedTo: followUp?.assignTo || 'nathan' };
          } catch (err: any) {
            taskResult = { error: 'Follow-up task creation failed: ' + (err?.message || '') };
          }

          return JSON.stringify({
            success: true,
            message: `Change order "${coName}" created in JobTread with ${createdItems.filter(i => i.startsWith('✓')).length} budget items.`,
            coGroupId: coGroup.id,
            coGroupName: coGroup.name,
            total: `$${totalPrice.toFixed(2)} (cost: $${totalCost.toFixed(2)})`,
            budgetItems: createdItems,
            images: imageResults.length > 0 ? imageResults : undefined,
            document: documentResult,
            followUpTask: taskResult,
          });
        } catch (err: any) {
          console.error('[field-staff] CO creation error:', err?.message);
          return JSON.stringify({ success: false, error: 'Failed to create change order: ' + (err?.message || 'Unknown error') });
        }
      }

      return JSON.stringify({ error: 'Unknown tool: ' + name });
    } catch (err: any) {
      console.error('[field-staff] Tool error (' + name + '):', err?.message);
      return JSON.stringify({ error: 'Error: ' + (err?.message || 'Unknown error') });
    }
  },
};

export default fieldStaff;
