// ============================================================
// BKB Schedule Setup Survey — Scope Definitions & Task Filtering
// ============================================================

export type ProjectScope =
  | 'kitchen'
  | 'bathroom'
  | 'renovation'
  | 'addition'
  | 'new_structure'
  | 'exterior'
  | 'commercial'
  | 'other';

export const PROJECT_SCOPES: { key: ProjectScope; label: string; description: string }[] = [
  { key: 'kitchen', label: 'Kitchen Remodel', description: 'Full or partial kitchen renovation' },
  { key: 'bathroom', label: 'Bathroom Remodel', description: 'Full or partial bathroom renovation' },
  { key: 'renovation', label: 'Whole-House / Multi-Room', description: 'Large-scale renovation across multiple rooms' },
  { key: 'addition', label: 'Addition', description: 'Room addition, floor addition, or bump-out' },
  { key: 'new_structure', label: 'New Structure', description: 'Garage, pool house, barn, in-law suite, sunroom, dormer' },
  { key: 'exterior', label: 'Exterior / Roof / Windows', description: 'Roofing, siding, windows, doors, exterior work' },
  { key: 'commercial', label: 'Commercial', description: 'Commercial build-out or renovation' },
  { key: 'other', label: 'Other', description: 'Custom scope — all default tasks included' },
];

// ============================================================
// 2. Survey Questions — Dynamic per scope
// ============================================================

export interface SurveyQuestion {
  id: string;
  label: string;
  type: 'boolean' | 'select' | 'text';
  options?: string[];
  defaultValue: boolean | string;
  appliesTo: ProjectScope[];
}

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: 'structural_changes',
    label: 'Includes structural changes?',
    type: 'boolean',
    defaultValue: false,
    appliesTo: ['kitchen', 'bathroom', 'renovation', 'addition', 'new_structure', 'commercial'],
  },
  {
    id: 'requires_engineering',
    label: 'Requires structural engineering?',
    type: 'boolean',
    defaultValue: false,
    appliesTo: ['kitchen', 'bathroom', 'renovation', 'addition', 'new_structure', 'commercial'],
  },
  {
    id: 'requires_permits',
    label: 'Requires building permits?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['kitchen', 'bathroom', 'renovation', 'addition', 'new_structure', 'exterior', 'commercial'],
  },
  {
    id: 'plumbing_work',
    label: 'Includes plumbing work?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['kitchen', 'bathroom', 'renovation', 'addition', 'new_structure', 'commercial'],
  },
  {
    id: 'electrical_work',
    label: 'Includes electrical work?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['kitchen', 'bathroom', 'renovation', 'addition', 'new_structure', 'exterior', 'commercial'],
  },
  {
    id: 'hvac_work',
    label: 'Includes HVAC work?',
    type: 'boolean',
    defaultValue: false,
    appliesTo: ['kitchen', 'renovation', 'addition', 'new_structure', 'commercial'],
  },
  {
    id: 'new_cabinets',
    label: 'Includes new cabinets?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['kitchen', 'bathroom', 'renovation'],
  },
  {
    id: 'new_countertops',
    label: 'Includes new countertops?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['kitchen', 'bathroom', 'renovation'],
  },
  {
    id: 'new_appliances',
    label: 'Includes new appliances?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['kitchen', 'renovation'],
  },
  {
    id: 'tile_work',
    label: 'Includes tile / backsplash?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['kitchen', 'bathroom', 'renovation'],
  },
  {
    id: 'new_flooring',
    label: 'Includes new flooring?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['kitchen', 'bathroom', 'renovation', 'addition', 'new_structure', 'commercial'],
  },
  {
    id: 'roofing',
    label: 'Includes roofing work?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['exterior', 'addition', 'new_structure'],
  },
  {
    id: 'windows_doors',
    label: 'Includes windows or exterior doors?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['exterior', 'renovation', 'addition', 'new_structure'],
  },
  {
    id: 'foundation_work',
    label: 'Requires foundation / footings?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['addition', 'new_structure'],
  },
  {
    id: 'framing',
    label: 'Includes framing?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['addition', 'new_structure', 'renovation'],
  },
  {
    id: 'demo_required',
    label: 'Requires demolition?',
    type: 'boolean',
    defaultValue: true,
    appliesTo: ['kitchen', 'bathroom', 'renovation', 'addition', 'commercial'],
  },
];

// ============================================================
// 3. Helper Functions
// ============================================================

export type SurveyAnswers = Record<string, boolean | string>;

export function getQuestionsForScope(scope: ProjectScope): SurveyQuestion[] {
  return SURVEY_QUESTIONS.filter((q) => q.appliesTo.includes(scope));
}

export function getDefaultAnswers(scope: ProjectScope): SurveyAnswers {
  const questions = getQuestionsForScope(scope);
  const answers: SurveyAnswers = {};
  for (const q of questions) {
    answers[q.id] = q.defaultValue;
  }
  return answers;
}

// ============================================================
// 4. Task Conditions — Maps task names to survey answer keys
// If a required key is false, the task is excluded
// ============================================================

const TASK_CONDITIONS: Record<string, string[]> = {
  'material selections (flooring, tile, counters)': ['new_flooring', 'tile_work', 'new_countertops'],
  'fixture selections (plumbing, lighting)': ['plumbing_work', 'electrical_work'],
  'appliance selections': ['new_appliances'],
  'cabinet selections & layout': ['new_cabinets'],
  'hardware & finish selections': ['new_cabinets'],
  'structural engineering': ['requires_engineering'],
  'mep coordination': ['plumbing_work', 'electrical_work'],
  'prepare permit application': ['requires_permits'],
  'submit for permits': ['requires_permits'],
  'address permit comments (if any)': ['requires_permits'],
  'permits approved': ['requires_permits'],
  'demo (if applicable)': ['demo_required'],
  'foundation / structural work': ['foundation_work'],
  'framing': ['framing'],
  'roofing': ['roofing'],
  'windows & exterior doors': ['windows_doors'],
  'plumbing rough-in': ['plumbing_work'],
  'electrical rough-in': ['electrical_work'],
  'hvac rough-in': ['hvac_work'],
  'cabinet installation': ['new_cabinets'],
  'countertop installation': ['new_countertops'],
  'tile / backsplash': ['tile_work'],
  'flooring installation': ['new_flooring'],
  'plumbing trim (fixtures)': ['plumbing_work'],
  'electrical trim (fixtures, devices)': ['electrical_work'],
  'appliance installation': ['new_appliances'],
  'foundation inspection': ['foundation_work'],
  'framing inspection': ['framing'],
  'rough-in inspection (plumbing/electrical/hvac)': ['plumbing_work'],
  'insulation inspection': ['framing'],
};

const SCOPE_EXCLUDED_PHASES: Partial<Record<ProjectScope, number[]>> = {
  exterior: [2, 3, 8],
};

// ============================================================
// 5. Filter Functions — Main exports
// ============================================================

import { BKB_STANDARD_TEMPLATE, type TaskTemplate } from './schedule-templates';

export interface FilteredPhase {
  phaseNumber: number;
  name: string;
  description: string;
  startsEmpty: boolean;
  tasks: (TaskTemplate & { included: boolean; excludeReason?: string })[];
}

export function filterTemplateForProject(
  scope: ProjectScope,
  answers: SurveyAnswers
): FilteredPhase[] {
  const excludedPhases = SCOPE_EXCLUDED_PHASES[scope] || [];

  return BKB_STANDARD_TEMPLATE.map((phase) => {
    if (excludedPhases.includes(phase.phaseNumber)) {
      return {
        phaseNumber: phase.phaseNumber,
        name: phase.name,
        description: phase.description,
        startsEmpty: phase.startsEmpty || false,
        tasks: phase.tasks.map((t) => ({
          ...t,
          included: false,
          excludeReason: 'Not applicable for ' + (PROJECT_SCOPES.find((s) => s.key === scope)?.label || scope),
        })),
      };
    }

    const tasks = phase.tasks.map((task) => {
      const conditions = TASK_CONDITIONS[task.name.toLowerCase()];
      if (!conditions) return { ...task, included: true };

      for (const condKey of conditions) {
        if (condKey in answers && answers[condKey] === false) {
          return {
            ...task,
            included: false,
            excludeReason: 'Excluded: ' + (SURVEY_QUESTIONS.find((q) => q.id === condKey)?.label || condKey) + ' = No',
          };
        }
      }
      return { ...task, included: true };
    });

    return {
      phaseNumber: phase.phaseNumber,
      name: phase.name,
      description: phase.description,
      startsEmpty: phase.startsEmpty || false,
      tasks,
    };
  });
}

export function getIncludedTasksByPhase(
  scope: ProjectScope,
  answers: SurveyAnswers
): { phaseNumber: number; name: string; description: string; tasks: TaskTemplate[] }[] {
  const filtered = filterTemplateForProject(scope, answers);
  return filtered
    .filter((phase) => {
      const hasIncludedTasks = phase.tasks.some((t) => t.included);
      return hasIncludedTasks || phase.startsEmpty;
    })
    .map((phase) => ({
      phaseNumber: phase.phaseNumber,
      name: phase.name,
      description: phase.description,
      tasks: phase.tasks.filter((t) => t.included).map(({ included, excludeReason, ...task }) => task),
    }));
}

// ============================================================
// 6. Multi-Scope Helpers — union questions/tasks across scopes
// ============================================================

export function getQuestionsForScopes(scopes: ProjectScope[]): SurveyQuestion[] {
  const seen = new Set<string>();
  const result: SurveyQuestion[] = [];
  for (const scope of scopes) {
    for (const q of getQuestionsForScope(scope)) {
      if (!seen.has(q.id)) {
        seen.add(q.id);
        result.push(q);
      }
    }
  }
  return result;
}

export function getDefaultAnswersForScopes(scopes: ProjectScope[]): SurveyAnswers {
  const merged: SurveyAnswers = {};
  for (const scope of scopes) {
    const defaults = getDefaultAnswers(scope);
    for (const [key, val] of Object.entries(defaults)) {
      // true wins: if any scope defaults to true, keep it true
      if (merged[key] === undefined || val === true) {
        merged[key] = val;
      }
    }
  }
  return merged;
}

export function getIncludedTasksByPhaseMulti(
  scopes: ProjectScope[],
  answers: SurveyAnswers
): { phaseNumber: number; name: string; description: string; tasks: TaskTemplate[] }[] {
  // Collect included tasks from all scopes, deduplicate by task name within each phase
  const phaseMap = new Map<number, { name: string; description: string; taskNames: Set<string>; tasks: TaskTemplate[] }>();

  for (const scope of scopes) {
    const phases = getIncludedTasksByPhase(scope, answers);
    for (const phase of phases) {
      if (!phaseMap.has(phase.phaseNumber)) {
        phaseMap.set(phase.phaseNumber, {
          name: phase.name,
          description: phase.description,
          taskNames: new Set(),
          tasks: [],
        });
      }
      const entry = phaseMap.get(phase.phaseNumber)!;
      for (const task of phase.tasks) {
        const key = task.name.toLowerCase().trim();
        if (!entry.taskNames.has(key)) {
          entry.taskNames.add(key);
          entry.tasks.push(task);
        }
      }
    }
  }

  return Array.from(phaseMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([phaseNumber, data]) => ({
      phaseNumber,
      name: data.name,
      description: data.description,
      tasks: data.tasks,
    }));
}
