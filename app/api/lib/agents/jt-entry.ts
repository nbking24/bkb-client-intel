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
  updateTask,
  updateTaskFull,
  deleteJTTask,
  createPhaseGroup,
  createPhaseTask,
  applyStandardTemplate,
  applyPhaseDefaults,
  getDocumentsForJob,
  getApprovedDocuments,
  getDocumentContent,
  getFilesForJob,
  moveTaskToPhase,
  getDailyLogsForJob,
  createDailyLog,
  updateDailyLog,
  deleteDailyLog,
  createComment,
  getCommentsForTarget,
  updateJob,
  getCostItemsForJob,
  getCostGroupsForJob,
  updateCostGroup,
  getCostCodes,
  getBillableDocuments,
  getSpecificationsForJob,
  getEventsForJob,
  getTimeEntriesForJob,
  getOpenTasksForMember,
  getScheduleAudit,
  getGridScheduleData,
  getAllOpenTasks,
  // DB-only reads for messages & daily logs (prevents duplication)
  getCommentsFromDB,
  getDailyLogsFromDB,
  // Write-through helpers for messages & daily logs
  createCommentWithCache,
  createDailyLogWithCache,
} from '../../../lib/jobtread';

const jtEntry: AgentModule = {
  name: 'JT Entry Specialist',
  description: 'Creates, updates, and manages data in JobTread — tasks, phases, schedules, templates, and job details.',
  icon: '🏗️',

  systemPrompt: (ctx: AgentContext) => {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return 'TODAY\'S DATE: ' + dateStr + '. ALWAYS use this date as the reference for "today", "next Monday", "this week", etc. Never use dates from 2024.\n\n' +
      'You are the "JobTread Entry Specialist" for Brett King Builder (BKB). You are precise, methodical, and thorough.\n\n' +
      'CURRENT USER: The person chatting with you is NATHAN KING (not Brett King). When the user says "me", "myself", "I", or "my" — they mean Nathan King. Brett King is the company owner but is NOT the one using this tool. Always use "Nathan" (not "Brett") when referencing the current user in task names, descriptions, or any records.\n\n' +
      'Your job is to create, update, and manage data in JobTread when the team asks you to. You handle tasks, phases, schedules, templates, documents, and job details.\n\n' +
      'AVAILABLE TOOLS:\n' +
      '1. search_jobs — Find jobs by name/number/client. Use this first if you need a Job ID.\n' +
      '2. get_job_schedule — View the full phase/task tree for a job.\n' +
      '3. get_job_tasks — List all tasks for a job.\n' +
      '4. create_jobtread_task — Create a new task on a job. Optionally assign to a team member.\n' +
      '5. update_task_progress — Mark a task as not started (0), in progress (0.5), or complete (1).\n' +
      '6. update_task — Update a task\'s details: name, start date, end date (due date), description, or progress. Use this to reschedule tasks, change due dates, rename tasks, etc.\n' +
      '7. delete_task — Delete a task from a job. Always confirm with the user before deleting.\n' +
      '8. create_phase — Create a new phase (task group) on a job schedule.\n' +
      '9. create_phase_task — Create a task within a specific phase.\n' +
      '10. apply_standard_template — Apply the BKB 9-phase standard template to a job. This creates: Admin, Concept, Design Development, Contract, Pre-Construction, Production, Inspections, Punch/Closeout, Project Closeout.\n' +
      '11. get_job_documents — View documents/contracts for a job.\n' +
      '12. get_job_files — View uploaded files for a job.\n' +
      '13. move_task_to_phase — Move a task from one phase to another.\n' +
      '14. get_job_daily_logs — View all daily logs for a job.\n' +
      '15. create_daily_log — Create a new daily log entry for a job.\n' +
      '16. update_daily_log — Update an existing daily log.\n' +
      '17. delete_daily_log — Delete a daily log entry.\n' +
      '18. create_comment — Add a comment to any JobTread entity (job, task, document).\n' +
      '19. get_comments — View all comments on a JobTread entity.\n' +
      '20. update_job — Update job details (name, description, specifications, close/reopen).\n' +
      '21. get_job_budget — View cost items (budget line items) for a job.\n' +
      '22. update_task_full — Advanced task update with assignee changes, time of day, etc.\n' +
      '23. get_all_open_tasks — Get ALL incomplete tasks across ALL active jobs with assignees and dates.\n' +
      '24. get_job_details — Full details for a single job (client, location, financials, custom fields).\n' +
      '25. get_members — List all team members with membership IDs.\n' +
      '26. get_member_tasks — Get open tasks for a specific team member (by membership ID).\n' +
      '27. get_approved_documents — Cross-job approved documents (estimates, COs, invoices).\n' +
      '28. get_document_content — Full line items and content of a specific document.\n' +
      '29. get_cost_codes — All cost codes in the organization.\n' +
      '30. get_billable_documents — Documents ready for billing.\n' +
      '31. get_time_entries — Time/labor entries for a job.\n' +
      '32. get_cost_groups — Budget category groups for a job.\n' +
      '33. update_cost_group — Update a cost group (name, markup, tax). Confirm first.\n' +
      '34. get_specifications — Scope of work / specifications for a job.\n' +
      '35. get_job_events — Calendar events for a job.\n' +
      '36. get_schedule_audit — Audit all schedules for issues (orphan tasks, missing dates).\n' +
      '37. get_grid_schedule — Grid/Gantt view of all active job schedules.\n' +
      '38. apply_phase_defaults — Apply standard phases to a job with existing tasks. Confirm first.\n\n' +
      'CRITICAL — CONFIRMATION BEFORE EXECUTION:\n' +
      '- For ANY write operation (create, update, delete, move, apply template), you MUST first:\n' +
      '  1. Use read-only tools (search_jobs, get_job_schedule, get_job_tasks) to gather the needed info\n' +
      '  2. Present a clear summary of EXACTLY what you plan to do, including: action, job name/number, task name, dates, assignee, etc.\n' +
      '  3. Ask the user to confirm: "Shall I proceed?"\n' +
      '  4. ONLY execute the write tool AFTER the user confirms in their NEXT message.\n' +
      '- NEVER call create, update, delete, move, or apply tools on the first response. Always summarize first and wait for approval.\n' +
      '- If the user says "yes", "go ahead", "do it", "confirmed", etc. — THEN execute.\n\n' +
      'TASK NAMING RULES (IMPORTANT):\n' +
      '- Task names MUST be SHORT and descriptive (max 5-8 words). Think of it as a subject line.\n' +
      '- Put all details, context, and instructions in the DESCRIPTION field instead.\n' +
      '- Examples of GOOD task names: "Schedule fireplace review meeting", "Contact Scott re: plumbing permit", "Order kitchen cabinets", "Submit permit application"\n' +
      '- Examples of BAD task names: "Setup appointment with Nathan to meet with clients and Estate Chimney to review fireplace installation" (way too long!)\n' +
      '- The description field is where you put: who needs to attend, what to discuss, specific instructions, deadlines, preferences, etc.\n\n' +
      'PHASE ASSIGNMENT (CRITICAL — EVERY TASK MUST GO UNDER A PHASE):\n' +
      '- Every new task MUST be created under one of the 9 standard phases. NEVER create orphan/unorganized tasks.\n' +
      '- Before creating a task, ALWAYS call get_job_schedule first to see the existing phases and their IDs.\n' +
      '- IMPORTANT: Choose the phase based on the SUBJECT MATTER of the task, NOT the action type.\n' +
      '  A "meeting" or "appointment" is NOT automatically Admin — categorize by WHAT the meeting is about.\n' +
      '- Phase selection guide:\n' +
      '  1. Admin Tasks — ONLY internal business admin: billing setup, insurance certs, filing, project setup in systems\n' +
      '  2. Conceptual Design — initial design ideas, concept sketches, early designer meetings, budget range estimates\n' +
      '  3. Design Development — DD drawings, plan revisions, material selections, detailed plan reviews\n' +
      '  4. Contract — final plans, structural engineering, contract drafting, contract signing\n' +
      '  5. Preconstruction — permits, material ordering, sub scheduling, pre-con meetings, site prep before build starts\n' +
      '  6. In Production — ANY task related to active construction work: installations, reviews of installations, trade coordination during build, site meetings about build work, framing, plumbing, electrical, HVAC, fireplace, roofing, drywall, painting, flooring, cabinets, countertops, tile, trim, etc.\n' +
      '  7. Inspections — code inspections, municipal inspections, scheduled inspections\n' +
      '  8. Punch List — final fixes, touch-ups, punch items near project end\n' +
      '  9. Project Completion — final walkthrough, final billing, warranty handoff, closeout paperwork\n' +
      '- EXAMPLES of correct phase assignment:\n' +
      '  "Review fireplace installation with trade" → In Production (construction work)\n' +
      '  "Schedule meeting with client about kitchen layout" → Design Development (design topic)\n' +
      '  "Order cabinets from supplier" → Preconstruction (material ordering)\n' +
      '  "Setup billing for new project" → Admin Tasks (internal business admin)\n' +
      '  "Submit permit application" → Preconstruction (permits)\n' +
      '  "Final walkthrough with client" → Project Completion (closeout)\n' +
      '  "Schedule plumbing rough-in inspection" → Inspections\n' +
      '  "Coordinate drywall crew for next week" → In Production (active build)\n' +
      '  "Meet with engineer about structural plans" → Contract (engineering)\n' +
      '- Use create_phase_task (with the phase ID as parentGroupId) instead of create_jobtread_task.\n' +
      '- If the job does not have phases yet, tell the user and offer to apply the standard template first.\n\n' +
      'CONFIRMATION FORMAT (CRITICAL — ALWAYS USE THIS FORMAT):\n' +
      '- When presenting a task for approval, write ONE short sentence (e.g. "Here is the task for your review:") then IMMEDIATELY include the structured block. Do NOT duplicate the task details in bullet points — the UI renders an editable card from the block.\n' +
      '- Do NOT write "Shall I proceed?" — the card has Approve and Cancel buttons.\n' +
      '- Format:\n' +
      '@@TASK_CONFIRM@@\n' +
      '{"name":"short task name","phase":"Phase Name","phaseId":"phase-id-from-schedule","description":"detailed description here","assignee":"Team Member Name","startDate":"YYYY-MM-DD or empty","endDate":"YYYY-MM-DD or empty"}\n' +
      '@@END_CONFIRM@@\n' +
      '- The phaseId must be the actual ID from get_job_schedule results.\n' +
      '- If no assignee, use "" (empty string). If no dates, use "" (empty string).\n' +
      '- This format enables the UI to show an editable confirmation card so the user can make quick changes before approving.\n\n' +
      'EXECUTING AFTER APPROVAL (CRITICAL — MUST USE TOOLS):\n' +
      '- When the user confirms with "Yes, proceed" and includes [APPROVED TASK DATA], you MUST actually call the create_phase_task tool (or the appropriate write tool) to execute the action.\n' +
      '- The approved task data JSON fields map to create_phase_task params as follows:\n' +
      '  JSON "name" → tool "name", JSON "phaseId" → tool "parentGroupId", JSON "description" → tool "description",\n' +
      '  JSON "assignee" → tool "assignTo", JSON "endDate" → tool "endDate", JSON "startDate" → tool "startDate".\n' +
      '  You MUST pass assignee as assignTo and endDate as endDate — do NOT skip these fields!\n' +
      '- NEVER say you created/updated/deleted something without actually calling the tool first. That is a hallucination and causes serious problems.\n' +
      '- PHASE CHANGE HANDLING: If the JSON has "phaseChanged":true and NO phaseId, the user changed the phase. You MUST:\n' +
      '  1. Call get_job_schedule with the jobId to get the full phase list\n' +
      '  2. Find the phase whose name matches the "phase" field in the JSON\n' +
      '  3. Use THAT phase\'s ID as parentGroupId in create_phase_task\n' +
      '  4. Do NOT use create_jobtread_task — that creates orphan tasks with no phase!\n' +
      '- Even when phaseId IS provided, ALWAYS use create_phase_task with parentGroupId set to the phaseId. NEVER use create_jobtread_task for approved tasks.\n' +
      '- The tool call MUST happen — just saying "I created the task" without a tool call is WRONG.\n\n' +
      'TASK DURATION (CRITICAL):\n' +
      '- ALWAYS set durationDays to 1. Every task should be a 1-day task unless the user explicitly requests a different duration.\n' +
      '- Do NOT calculate multi-day durations based on start/end dates — just use durationDays: 1.\n\n' +
      'OTHER RULES:\n' +
      '- If you need a Job ID and none is provided, use search_jobs first to find the right job.\n' +
      '- Use the assignTo field with team member names. Match names fuzzy (e.g. "Nathan" matches "Nathan King").\n' +
      '- If no assignee is mentioned, leave assignTo empty — do NOT assign by default.\n' +
      '- After executing, confirm what was done with the details.\n' +
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
      name: 'get_all_open_tasks',
      description: 'Get all open (incomplete) tasks across ALL active jobs. Returns task name, dates, progress, job name, and assigned team members. Use when the user asks about their tasks, team workload, or open items across multiple projects.',
      input_schema: {
        type: 'object',
        properties: {},
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
    {
      name: 'get_job_daily_logs',
      description: 'Get all daily logs for a job. Daily logs track daily job site activity, notes, and crew info.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
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
      name: 'get_job_budget',
      description: 'Get cost items (budget line items) for a job. Use search parameter to filter by keyword for large jobs.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          search: { type: 'string', description: 'Optional keyword to filter cost items (e.g. "door", "electric"). Recommended for large jobs.' },
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
    // ===== NEW COMPREHENSIVE JT TOOLS =====
    {
      name: 'get_job_details',
      description: 'Get full details for a single job — name, number, status, client, location, description, custom fields, dates, and financial totals.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_members',
      description: 'Get all team members in the JobTread organization. Returns membership IDs and user names. Use to look up member IDs for assignment.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_member_tasks',
      description: 'Get all open tasks assigned to a specific team member (by membership ID). Use get_members first to find the membership ID.',
      input_schema: {
        type: 'object',
        properties: {
          membershipId: { type: 'string', description: 'The membership ID of the team member' },
        },
        required: ['membershipId'],
      },
    },
    {
      name: 'get_approved_documents',
      description: 'Get all approved documents (estimates, change orders, invoices) across all jobs. Useful for financial overviews.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max documents to return (default 100)' },
        },
        required: [],
      },
    },
    {
      name: 'get_document_content',
      description: 'Get the full content/line items of a specific document (estimate, change order, invoice). Returns all line items with quantities, costs, prices.',
      input_schema: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The document ID' },
        },
        required: ['documentId'],
      },
    },
    {
      name: 'get_cost_codes',
      description: 'Get all cost codes available in the organization. Cost codes categorize budget items (e.g., "Electrical", "Plumbing").',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_billable_documents',
      description: 'Get documents that are ready to be billed or have billing status. Useful for accounts receivable tracking.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max documents to return (default 100)' },
        },
        required: [],
      },
    },
    {
      name: 'get_time_entries',
      description: 'Get time entries (labor hours logged) for a specific job. Shows who worked, when, and for how long.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_cost_groups',
      description: 'Get cost groups (budget categories/sections) for a job. Shows how budget items are organized.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
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
      name: 'get_specifications',
      description: 'Get the specifications (scope of work) for a job. Returns the spec description, footer, and all spec line items grouped by cost group.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_events',
      description: 'Get calendar events associated with a job. Shows meetings, site visits, inspections, etc.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_schedule_audit',
      description: 'Audit all active job schedules for issues — tasks without phases, missing dates, jobs without schedules, etc. Returns a comprehensive health check.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_grid_schedule',
      description: 'Get a grid/Gantt view of all active job schedules. Shows all jobs with their phases and tasks in a timeline format.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
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
    // Exclude document-attached messages — those belong to Know-it-All
    if (/--- ATTACHED DOCUMENT:/i.test(message)) return 0.05;
    // Exclude email/message drafting and spec writing — those belong to Know-it-All
    if (/(write|draft|compose|send|prepare|put together).*(email|message|letter|response|reply|communication)/i.test(lower)) return 0.05;
    if (/(write|create|draft|generate).*(spec|specification|material)/i.test(lower)) return 0.05;
    if (/(email|message|letter|response|reply).*(to|for|about).*(client|customer)/i.test(lower)) return 0.05;
    // Very high for explicit task/JT operations
    if (/create.*task|add.*task|schedule.*task|new.*task|make.*task/i.test(lower)) return 0.95;
    if (/(create|add|update|edit|delete|remove|schedule|assign|change|modify).*(jobtread|job\s*tread|budget|comment|item|phase)/i.test(lower)) return 0.95;
    // High for task date changes / rescheduling
    if (/(update|change|move|reschedule|push|set|adjust).*(task|date|due|deadline|end date|start date|schedule)/i.test(lower)) return 0.95;
    if (/(task|date|due|deadline|end date|start date).*(update|change|move|to|push|set|adjust|friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow|next week)/i.test(lower)) return 0.95;
    // High for progress/completion updates
    if (/mark.*(complete|done|finished|progress)|complete.*task|finish.*task|update.*progress/i.test(lower)) return 0.9;
    // High for template/phase operations
    if (/apply.*template|standard.*template|create.*phase|add.*phase|new.*phase/i.test(lower)) return 0.9;
    // High for any "update task" or "change task" phrasing
    if (/(update|change|edit|modify|rename|reschedule).*task/i.test(lower)) return 0.9;
    // High for daily log operations
    if (/(create|add|write|log|new).*(daily.*log|daily.*report|site.*log|field.*report)/i.test(lower)) return 0.95;
    if (/daily.*(log|report|entry)/i.test(lower) && /(create|add|write|update|edit|delete)/i.test(lower)) return 0.95;
    // High for comment operations
    if (/(add|create|post|write|leave).*(comment|note)/i.test(lower)) return 0.9;
    // High for job update operations
    if (/(update|change|edit|modify|close|reopen).*(job|project)/i.test(lower)) return 0.9;
    // High for budget/cost operations
    if (/(budget|cost.*item|line.*item)/i.test(lower) && /(show|get|view|update|add)/i.test(lower)) return 0.85;
    if (/(specification)/i.test(lower) && /(update|change|edit|modify|set|write)/i.test(lower)) return 0.85;
    // High for reassignment
    if (/(reassign|assign.*to|change.*assign)/i.test(lower)) return 0.9;
    // Medium for general CRUD verbs
    if (/(create|add|schedule|assign).*(task|item|entry|comment|log)/i.test(lower)) return 0.7;
    if (/move.*task|delete.*task|remove.*task/i.test(lower)) return 0.85;
    // Lower for general action words
    if (/create|add|schedule|update|edit|delete|assign|move|apply|change|modify|rename|reschedule/i.test(lower)) return 0.5;
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
        const jobs = await getActiveJobs(50);
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
          const phaseTasks = phase.childTasks?.nodes || phase.childTasks || [];
          const taskList = Array.isArray(phaseTasks) ? phaseTasks : [];
          for (const task of taskList) {
            const status = task.progress >= 1 ? '✅' : task.progress > 0 ? '🔄' : '⬜';
            const dates = [task.startDate, task.endDate].filter(Boolean).join(' → ');
            const assignees = task.assignedMemberships?.map((a: any) => a.user?.name || '').filter(Boolean).join(', ');
            lines.push('  ' + status + ' ' + task.name + ' (ID: ' + task.id + ')' + (dates ? ' (' + dates + ')' : '') + (assignees ? ' [' + assignees + ']' : ''));
          }
        }

        // Show orphan tasks (tasks not in any phase)
        if (schedule.orphanTasks && schedule.orphanTasks.length > 0) {
          lines.push('');
          lines.push('📋 Tasks Not In Any Phase:');
          for (const task of schedule.orphanTasks) {
            const status = task.progress >= 1 ? '✅' : task.progress > 0 ? '🔄' : '⬜';
            const dates = [task.startDate, task.endDate].filter(Boolean).join(' → ');
            lines.push('  ' + status + ' ' + task.name + ' (ID: ' + task.id + ')' + (dates ? ' (' + dates + ')' : ''));
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

      // ========== ALL OPEN TASKS (cross-job) ==========
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

        const result = await createDailyLogWithCache({ jobId, date, notes: input.notes, assignees, notify: input.notify });
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
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Tool execution failed' });
    }
  },
};

export default jtEntry;
