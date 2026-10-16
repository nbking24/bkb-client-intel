// @ts-nocheck
/**
 * The Job Plan.
 *
 * Since 16 Oct 2026 the Job Plan is the description of the job's `📋 Project Details`
 * budget group: the top-level cost group that sits at the top of the budget and, because
 * its lines are specifications, at the top of the Specifications sheet. It used to be a
 * `📄 JOB PLAN (keep current, never complete)` to-do; that to-do is retired.
 *
 * The Project Details group is internal. The Construction Contract is built from the
 * `🔨 Scope of Work` subtree only, so nothing here prints on a client document.
 *
 * JobTread caps a cost group description at 4,096 characters.
 */
import { pave } from '@/app/lib/jobtread';

export const PLAN_GROUP_NAME = '📋 Project Details';
export const PLAN_MAX = 4096;

/** Blank Job Plan, used when the master job (A-TEST PROJECT) has no Project Details text. */
export const PLAN_TEMPLATE = [
  'DESIGN LEAD:',
  'PM:',
  'TARGET START:',
  'CLIENT TARGET WINDOW:',
  'ROUGH BUILD LENGTH (weeks):',
  '',
  'SCOPE (3 lines):',
  '',
  'BUILD APPROACH (decided at Gate 2):',
  'Structure and engineer:',
  'Cabinet source:',
  'HVAC and plumbing approach:',
  'What we do vs sub out:',
  'Special orders or prefab:',
  '',
  'CLIENT PRIORITIES (3 to 5 things they care about more than the drawings show):',
  '1.',
  '2.',
  '3.',
  '',
  'PERMITS (township | what is needed | typical review time):',
  '',
  'TOP RISKS, things that might happen (risk | plan | owner | green, amber or red). If it is happening now, make it a Roadblock task instead:',
  '1.',
  '2.',
  '3.',
].join('\n');

// The placeholder line every Project Details group carries, so the group shows on the
// Specifications sheet: cost code 01 Planning, Admin; $0; specification on, no approval.
const PLACEHOLDER = { name: 'Project Plans', costCodeId: '22P5SRxXqzSn', costTypeId: '22P6cCGfyeRJ' };

export type PlanGroup = { id: string; name: string; description: string };

/** The job's Project Details budget group (top-level preferred), or null. */
export async function findPlanGroup(jobId: string): Promise<PlanGroup | null> {
  const d: any = await pave({
    job: {
      $: { id: jobId },
      costGroups: {
        $: { size: 25, where: [['name'], 'like', '%Project Details%'] },
        nodes: { id: {}, name: {}, description: {}, parentCostGroup: { id: {} }, document: { id: {} } },
      },
    },
  });
  const nodes = (d?.job?.costGroups?.nodes || []).filter((g: any) => !g.document?.id);
  if (!nodes.length) return null;
  const score = (g: any) => (g.parentCostGroup?.id ? 2 : 0) + (String(g.name).includes('📋') ? 0 : 1);
  nodes.sort((a: any, b: any) => score(a) - score(b));
  const g = nodes[0];
  return { id: g.id, name: g.name, description: g.description || '' };
}

export async function readPlanText(groupId: string): Promise<string> {
  const d: any = await pave({ costGroup: { $: { id: groupId }, description: {} } });
  return d?.costGroup?.description || '';
}

export async function writePlanText(groupId: string, text: string) {
  if (text.length > PLAN_MAX) throw new Error(`The Job Plan is ${text.length.toLocaleString()} characters and JobTread allows ${PLAN_MAX.toLocaleString()}. Edit it shorter, then try again.`);
  await pave({ updateCostGroup: { $: { id: groupId, description: text } } });
}

/** Create the Project Details group at the top of the job's budget, holding the Job Plan. */
export async function createPlanGroup(jobId: string, description: string): Promise<string> {
  const d: any = await pave({
    createCostGroup: {
      $: {
        jobId, name: PLAN_GROUP_NAME, positionAfter: null, showDescription: true, showChildren: true,
        description: description.slice(0, PLAN_MAX),
        lineItems: [{
          _type: 'costItem', name: PLACEHOLDER.name, costCodeId: PLACEHOLDER.costCodeId, costTypeId: PLACEHOLDER.costTypeId,
          quantity: 1, unitCost: 0, unitPrice: 0, isSpecification: true, requireSpecificationApproval: false, isTaxable: false,
        }],
      },
      createdCostGroup: { id: {} },
    },
  });
  const id = d?.createCostGroup?.createdCostGroup?.id;
  if (!id) throw new Error('Could not create the 📋 Project Details group');
  return id;
}
