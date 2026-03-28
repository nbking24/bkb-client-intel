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
      'You are the Field Staff Assistant for Brett King Builder (BKB). You help field team members with TWO things:\n\n' +
      '1. APPROVED SPECIFICATIONS: Answer questions about what materials, fixtures, and finishes are specified ' +
      'in approved contracts and change orders. You ONLY use data from APPROVED documents — never guess or make up info.\n\n' +
      '2. SCHEDULE & TASKS: Help view, create, edit, and update task progress on JobTread schedules. ' +
      'You can show tasks for any job, create new tasks, mark tasks complete, reschedule tasks, and update task details.\n\n' +
      'WHAT YOU CANNOT DO (and should say so if asked):\n' +
      '- You cannot access emails, CRM contacts, or GoHighLevel data\n' +
      '- You cannot create or manage daily logs\n' +
      '- You cannot manage invoicing, billing, or cost groups\n' +
      '- You cannot log project events or access the Project Memory Layer\n' +
      '- You cannot access calendars or schedule meetings\n' +
      '- For anything outside specs and tasks, tell the user to ask Nathan or check the full dashboard.\n\n' +
      'RESPONSE STYLE:\n' +
      '- Keep answers concise and practical — field staff need quick, clear info\n' +
      '- For specs: organize by area/location, include specific details (brands, models, measurements)\n' +
      '- For tasks: show task name, due date, progress, and assignee\n' +
      '- Always confirm before creating or modifying tasks\n\n' +
      'TASK CREATION RULES:\n' +
      '- When asked to create a task, output a @@TASK_CONFIRM@@ block for user approval\n' +
      '- NEVER call create_jobtread_task or create_phase_task directly without user approval\n' +
      '- Format: @@TASK_CONFIRM@@{"name":"...","phase":"...","endDate":"...","assignee":"...","description":"..."}@@END_CONFIRM@@\n\n' +
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
  ],

  canHandle: (message: string): number => {
    // Field staff agent handles everything when forced — scoring is for fallback only
    const lower = message.toLowerCase();
    if (/(spec|specification|material|what.*door|what.*window|what.*floor|what.*cabinet|what.*counter|what.*tile|what.*siding|what.*approved|what.*planned)/i.test(lower)) return 0.95;
    if (/(task|schedule|assign|due|progress|complete|mark.*done|create.*task|update.*task)/i.test(lower)) return 0.90;
    if (/(what.*included|scope|change order|contract)/i.test(lower)) return 0.85;
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
          if (doc.status === 'approved') {
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
        const unselectedItemIds = new Set<string>();
        for (const items of docItemArrays) {
          for (const item of items) { if (item.isSelected === false) unselectedItemIds.add(item.id); }
        }
        const filteredBudgetItems = budgetItemsWithApprovedDoc.filter((item: any) => !unselectedItemIds.has(item.id));
        const seenIds = new Set(filteredBudgetItems.map((item: any) => item.id));
        const docLevelItems: any[] = [];
        for (const items of docItemArrays) {
          for (const item of items) {
            if (item.isSelected === false) continue;
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

      return JSON.stringify({ error: 'Unknown tool: ' + name });
    } catch (err: any) {
      console.error('[field-staff] Tool error (' + name + '):', err?.message);
      return JSON.stringify({ error: 'Error: ' + (err?.message || 'Unknown error') });
    }
  },
};

export default fieldStaff;
