// @ts-nocheck
import { AgentModule, AgentContext } from './types';
import {
  createTask,
  getMembers,
  getActiveJobs,
  getJob,
  getTasksForJob,
  getJobSchedule,
  updateTaskProgress,
  deleteJTTask,
  createPhaseGroup,
  createPhaseTask,
  applyStandardTemplate,
  getDocumentsForJob,
  getFilesForJob,
  moveTaskToPhase,
} from '../../../lib/jobtread';

const jtEntry: AgentModule = {
  name: 'JT Entry Specialist',
  description: 'Creates, updates, and manages data in JobTread — tasks, phases, schedules, templates, and job details.',
  icon: '🏗️',

  systemPrompt: (ctx: AgentContext) => {
    return 'You are the "JobTread Entry Specialist" for Brett King Builder (BKB). You are precise, methodical, and thorough.\n\n' +
      'Your job is to create, update, and manage data in JobTread when the team asks you to. You handle tasks, phases, schedules, templates, documents, and job details.\n\n' +
      'AVAILABLE TOOLS:\n' +
      '1. search_jobs — Find jobs by name/number/client. Use this first if you need a Job ID.\n' +
      '2. get_job_schedule — View the full phase/task tree for a job.\n' +
      '3. get_job_tasks — List all tasks for a job.\n' +
      '4. create_jobtread_task — Create a new task on a job. Optionally assign to a team member.\n' +
      '5. update_task_progress — Mark a task as not started (0), in progress (0.5), or complete (1).\n' +
      '6. delete_task — Delete a task from a job. Always confirm with the user before deleting.\n' +
      '7. create_phase — Create a new phase (task group) on a job schedule.\n' +
      '8. create_phase_task — Create a task within a specific phase.\n' +
      '9. apply_standard_template — Apply the BKB 9-phase standard template to a job. This creates: Admin, Concept, Design Development, Contract, Pre-Construction, Production, Inspections, Punch/Closeout, Project Closeout.\n' +
      '10. get_job_documents — View documents/contracts for a job.\n' +
      '11. get_job_files — View uploaded files for a job.\n' +
      '12. move_task_to_phase — Move a task from one phase to another.\n\n' +
      'IMPORTANT RULES:\n' +
      '- If you need a Job ID and none is provided, use search_jobs first to find the right job.\n' +
      '- Always confirm the details before executing CREATE or DELETE operations.\n' +
      '- Use the assignTo field with team member names. Match names fuzzy (e.g. "Nathan" matches "Nathan King").\n' +
      '- If no assignee is mentioned, leave assignTo empty — do NOT assign by default.\n' +
      '- After creating/updating/deleting, confirm what was done with the details.\n' +
      '- For delete operations, ALWAYS ask the user to confirm before executing.\n' +
      '- When applying templates, warn the user this will create multiple phases and tasks.\n\n' +
      'TEAM MEMBERS (use these names for assignment):\n' +
      'Nathan King, Terri Dalavai, David Steich, Evan Harrington, John Molnar, Karen Molnar, Chrissy Zajick\n\n' +
      'BKB STANDARD 9-PHASE SCHEDULE:\n' +
      '1. Admin  2. Concept  3. Design Development  4. Contract  5. Pre-Construction\n' +
      '6. Production  7. Inspections  8. Punch/Closeout  9. Project Closeout\n\n' +
      (ctx.jtJobId ? 'JobTread Job ID for this opportunity: ' + ctx.jtJobId + '\nUse this ID when creating tasks or other items.\n' : '') +
      (ctx.opportunityName ? 'Selected Opportunity: ' + ctx.opportunityName + '\n' : '') +
      (ctx.pipelineStage ? 'Pipeline Stage: ' + ctx.pipelineStage + '\n' : '') +
      (ctx.contactName ? 'Client: ' + ctx.contactName + '\n' : '');
  },

  tools: [
    {
      name: 'search_jobs',
      description: 'Search JobTread for jobs by name, number, or client name. Use this to find Job IDs.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term (job name, number, or client name). Leave empty for all active jobs.' },
        },
        required: [],
      },
    },
    {
      name: 'get_job_schedule',
      description: 'Get the complete schedule for a job — all phases and tasks with progress.',
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
      description: 'Get all tasks for a specific job.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
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
      name: 'get_job_files',
      description: 'Get all uploaded files for a job.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
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
  ],

  canHandle: (message: string) => {
    const lower = message.toLowerCase();
    // Very high for explicit task/JT operations
    if (/create.*task|add.*task|schedule.*task|new.*task|make.*task/i.test(lower)) return 0.95;
    if (/(create|add|update|edit|delete|remove|schedule|assign|change|modify).*(jobtread|job\s*tread|budget|comment|item|phase)/i.test(lower)) return 0.9;
    // High for progress/completion updates
    if (/mark.*(complete|done|finished|progress)|complete.*task|finish.*task|update.*progress/i.test(lower)) return 0.9;
    // High for template/phase operations
    if (/apply.*template|standard.*template|create.*phase|add.*phase|new.*phase/i.test(lower)) return 0.9;
    // Medium for general CRUD verbs
    if (/(create|add|schedule|assign).*(task|item|entry|comment)/i.test(lower)) return 0.7;
    if (/move.*task|delete.*task|remove.*task/i.test(lower)) return 0.85;
    // Lower for general action words
    if (/create|add|schedule|update|edit|delete|assign|move|apply/i.test(lower)) return 0.4;
    return 0.1;
  },

  fetchContext: async (ctx: AgentContext) => {
    const parts: string[] = [];
    if (ctx.jtJobId) parts.push('JobTread Job ID: ' + ctx.jtJobId);
    if (ctx.opportunityName) parts.push('Opportunity: ' + ctx.opportunityName);
    if (ctx.pipelineStage) parts.push('Pipeline Stage: ' + ctx.pipelineStage);
    if (ctx.contactName) parts.push('Client: ' + ctx.contactName);
    return parts.length > 0 ? '=== CONTEXT ===\n' + parts.join('\n') : '';
  },

  executeTool: async (name: string, input: any, ctx: AgentContext) => {
    try {
      // ========== SEARCH ==========
      if (name === 'search_jobs') {
        const jobs = await getActiveJobs(100);
        const query = (input.query || '').toLowerCase().trim();

        if (!query) {
          const lines = jobs.map((j: any) =>
            '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' (ID: ' + j.id + ') | Status: ' + (j.status || 'N/A') + (j.clientName ? ' | Client: ' + j.clientName : '')
          );
          return JSON.stringify({ success: true, count: jobs.length, jobs: lines.join('\n') });
        }

        const matches = jobs.filter((j: any) => {
          const searchable = [j.name, j.number, j.clientName, j.locationName, j.id].filter(Boolean).join(' ').toLowerCase();
          return searchable.includes(query);
        });

        if (matches.length === 0) {
          return JSON.stringify({ success: true, count: 0, message: 'No jobs found matching "' + input.query + '".' });
        }

        const lines = matches.map((j: any) =>
          '- #' + (j.number || '?') + ' ' + (j.name || 'Unnamed') + ' (ID: ' + j.id + ') | Status: ' + (j.status || 'N/A') + (j.clientName ? ' | Client: ' + j.clientName : '')
        );
        return JSON.stringify({ success: true, count: matches.length, jobs: lines.join('\n') });
      }

      // ========== SCHEDULE ==========
      if (name === 'get_job_schedule') {
        const schedule = await getJobSchedule(input.jobId);
        if (!schedule) return JSON.stringify({ success: false, error: 'No schedule found for job ID: ' + input.jobId });

        const lines: string[] = [];
        lines.push('Job: #' + (schedule.number || '?') + ' ' + schedule.name);
        lines.push('Overall Progress: ' + Math.round((schedule.totalProgress || 0) * 100) + '%');

        for (const phase of schedule.phases || []) {
          lines.push('');
          lines.push('📁 ' + phase.name + ' (ID: ' + phase.id + ') — ' + Math.round((phase.progress || 0) * 100) + '% complete');
          for (const task of phase.childTasks || []) {
            const status = task.progress >= 1 ? '✅' : task.progress > 0 ? '🔄' : '⬜';
            const dates = [task.startDate, task.endDate].filter(Boolean).join(' → ');
            const assignees = task.assignedMemberships?.map((a: any) => a.user?.name || '').filter(Boolean).join(', ');
            lines.push('  ' + status + ' ' + task.name + ' (ID: ' + task.id + ')' + (dates ? ' (' + dates + ')' : '') + (assignees ? ' [' + assignees + ']' : ''));
          }
        }

        return JSON.stringify({ success: true, schedule: lines.join('\n') });
      }

      // ========== TASKS ==========
      if (name === 'get_job_tasks') {
        const tasks = await getTasksForJob(input.jobId);
        if (!tasks || tasks.length === 0) return JSON.stringify({ success: true, count: 0, message: 'No tasks found.' });

        const lines = tasks.map((t: any) => {
          const status = t.progress >= 1 ? 'DONE' : t.progress > 0 ? 'IN PROGRESS' : 'NOT STARTED';
          const dates = [t.startDate, t.endDate].filter(Boolean).join(' → ');
          const assignees = t.assignedMemberships?.map((a: any) => a.user?.name || '').filter(Boolean).join(', ');
          return '- [' + status + '] ' + t.name + ' (ID: ' + t.id + ')' + (dates ? ' (' + dates + ')' : '') + (assignees ? ' [' + assignees + ']' : '');
        });
        return JSON.stringify({ success: true, count: tasks.length, tasks: lines.join('\n') });
      }

      // ========== CREATE TASK ==========
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
          durationDays: input.durationDays || 1,
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

      return JSON.stringify({ error: 'Unknown tool: ' + name });
    } catch (err) {
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Tool execution failed' });
    }
  },
};

export default jtEntry;
