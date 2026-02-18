// @ts-nocheck
import { AgentModule, AgentContext } from './types';
import { createTask, getMembers } from '../jobtread';

const jtEntry: AgentModule = {
  name: 'JT Entry Specialist',
  description: 'Creates, updates, and manages data in JobTread — tasks, comments, budget items, and job details.',
  icon: '🏗️',

  systemPrompt: (ctx: AgentContext) => {
    return 'You are the "JobTread Entry Specialist" for Brett King Builder (BKB). You are precise, methodical, and thorough.\n\n' +
      'Your job is to create, update, and manage data in JobTread when the team asks you to. You handle tasks, comments, budget items, and job details.\n\n' +
      'IMPORTANT RULES:\n' +
      '- Always confirm the details before executing an action (task name, description, dates, etc.)\n' +
      '- Use the create_jobtread_task tool to create tasks\n' +
      '- If a user mentions assigning to someone, use the assignTo field with their name. Match names fuzzy (e.g. "Nathan" matches "Nathan King").\n' +
      '- If no assignee is mentioned, leave assignTo empty — do NOT assign by default\n' +
      '- If you need a JobTread Job ID and one is not provided in the context, tell the user you need them to select an opportunity linked to a JobTread job\n' +
      '- After creating a task, confirm what was created with the details including who it was assigned to\n\n' +
      'TEAM MEMBERS (use these names for assignment):\n' +
      'Nathan King, Terri Dalavai, David Steich, Evan Harrington, John Molnar, Karen Molnar, Chrissy Zajick\n\n' +
      (ctx.jtJobId ? 'JobTread Job ID for this opportunity: ' + ctx.jtJobId + '\nUse this ID when creating tasks or other items.\n' : 'WARNING: No JobTread Job ID found for the selected opportunity. You will not be able to create tasks without one. Ask the user to select an opportunity that has a linked JobTread job.\n') +
      (ctx.opportunityName ? 'Selected Opportunity: ' + ctx.opportunityName + '\n' : '') +
      (ctx.pipelineStage ? 'Pipeline Stage: ' + ctx.pipelineStage + '\n' : '');
  },

  tools: [
    {
      name: 'create_jobtread_task',
      description: 'Create a new task in JobTread for the selected job/project. Optionally assign to a team member.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID. Use the one from the context if available.' },
          name: { type: 'string', description: 'The task title/name' },
          description: { type: 'string', description: 'Detailed description of the task' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format (optional)' },
          endDate: { type: 'string', description: 'Due/end date in YYYY-MM-DD format (optional)' },
          assignTo: { type: 'string', description: 'Name of the team member to assign this task to (optional). Use full or partial name.' },
        },
        required: ['jobId', 'name'],
      },
    },
  ],

  canHandle: (message: string) => {
    const lower = message.toLowerCase();
    if (/create.*task|add.*task|schedule.*task|new.*task|make.*task/i.test(lower)) return 0.95;
    if (/(create|add|update|edit|delete|remove|schedule|assign|change|modify).*(jobtread|job\s*tread|budget|comment|item)/i.test(lower)) return 0.9;
    if (/(create|add|schedule|assign).*(task|item|entry|comment)/i.test(lower)) return 0.7;
    if (/create|add|schedule|update|edit|delete|assign/i.test(lower)) return 0.4;
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
      if (name === 'create_jobtread_task') {
        const jobId = input.jobId || ctx.jtJobId;
        if (!jobId) {
          return JSON.stringify({ success: false, error: 'No JobTread Job ID available. Please select an opportunity linked to a JobTread job.' });
        }

        // Resolve assignee name to membership ID
        let assignedMembershipIds: string[] | undefined;
        let assignedName = '';
        if (input.assignTo) {
          try {
            const members = await getMembers();
            const search = input.assignTo.toLowerCase();
            const match = members.find((m: any) => m.name.toLowerCase().includes(search));
            if (match) {
              assignedMembershipIds = [match.id];
              assignedName = match.name;
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
      return JSON.stringify({ error: 'Unknown tool: ' + name });
    } catch (err) {
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Tool execution failed' });
    }
  },
};

export default jtEntry;
