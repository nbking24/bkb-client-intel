// ============================================================
// Estimating Agent — System Prompt & Context Builder
// AI agent for developing structured budgets from scope descriptions
// ============================================================

import { BKB_CATEGORIES, BKB_CATEGORY_DETAILS } from './bkb-spec-guide';
import { getCachedCatalog, formatCatalogForAgent, type CostCatalog } from './cost-catalog';
import { getActiveJobs } from './jobtread';

// -- Types --

export interface BudgetLineItem {
  name: string;
  description: string;
  costCodeId: string;
  costCodeNumber: string;
  costTypeName: string;
  costTypeId: string;
  unitName: string;
  unitId: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  groupName: string;           // Full path with " > " separator
  groupDescription: string;    // Client-facing group description
  organizationCostItemId?: string; // Link to catalog item if applicable
}

export interface ProposedBudget {
  estimateType: 'initial' | 'change-order';
  changeOrderName?: string;
  areaName: string;
  lineItems: BudgetLineItem[];
  totalCost: number;
  totalPrice: number;
}

export interface EstimatingResponse {
  reply: string;
  proposedBudget: ProposedBudget | null;
  readyToCreate: boolean;
}

// -- Margin helpers --

const MARGINS: Record<string, number> = {
  'Materials': 0.30,
  'Labor': 0.32,
  'Allowance': 0.30,
  'Selection': 0.30,
  'Other': 0.30,
  'Subcontractor': 0.25, // Default sub margin, varies by trade
};

export function calculatePrice(cost: number, costTypeName: string): number {
  const margin = MARGINS[costTypeName] ?? 0.30;
  return Math.round((cost / (1 - margin)) * 100) / 100;
}

// -- System Prompt --

function buildCategoryList(): string {
  return Object.entries(BKB_CATEGORIES)
    .map(([num, name]) => {
      const detail = BKB_CATEGORY_DETAILS[num] || '';
      return `${num} - ${name}: ${detail}`;
    })
    .join('\n');
}

export function buildSystemPrompt(estimateType: 'initial' | 'change-order'): string {
  const hierarchySection = estimateType === 'initial'
    ? `BUDGET GROUP HIERARCHY (Initial Estimate):
When creating an initial estimate, structure groups as:
  Scope of Work > [Area Name] > [Cost Code Category] > [Specification Group]

Example paths (using " > " separator):
  "Scope of Work > Kitchen > Framing Specifications"
  "Scope of Work > Kitchen > Plumbing: Rough-in & Finish"
  "Scope of Work > Addition & Exterior > Cement Siding: Lap Siding > James Hardie"
  "Scope of Work > Kitchen > Cabinets & Countertops > Custom Cabinetry: Island with Base Cabinets"

IMPORTANT: The Area Name level is critical. Common areas include:
  - Kitchen, Primary Bathroom, Hall Bathroom, Addition & Exterior
  - Design Engineering & Permitting, Dumpster Portable & Site Cleans
  - Project Management (for PM hours)

Each area contains cost code groups, which may contain specification subgroups.`
    : `BUDGET GROUP HIERARCHY (Change Order):
When creating a change order, structure groups as:
  Post Pricing Changes > Client Requested > [Change Order Name] > [Optional Sub-groups]

Example paths:
  "Post Pricing Changes > Client Requested > Upgraded Kitchen Countertops"
  "Post Pricing Changes > Client Requested > Additional Electrical Outlets > Kitchen"

The Change Order Name should clearly describe the change (e.g., "Upgraded Kitchen Countertops", "Additional Bathroom Tile").`;

  return `You are the BKB Estimating Agent. You help develop detailed, structured construction budgets for Brett King Builder (BKB) projects in JobTread.

YOUR ROLE:
- Analyze scope descriptions (text, transcripts, vendor estimates)
- Ask targeted clarifying questions about quantities, specs, materials, and labor
- Develop hierarchical cost group and item structures matching BKB's system
- Reference the org cost catalog for standard items and pricing
- Produce a structured budget proposal when you have sufficient information

${hierarchySection}

BKB COST CODE SYSTEM (23 categories):
${buildCategoryList()}
Note: Categories 07 and 21 are not used.

COST TYPES & MARGINS:
- Materials — 30% margin (cost / 0.70 = price)
- Labor — 32% margin ($85/hr cost, ~$125/hr price for BKB crew)
- Subcontractor — ~25% margin (varies by trade, negotiate per sub)
- Allowance — 30% margin (placeholder amounts for client selections)
- Selection — 30% margin (fixture/finish selections)
- Other — 30% margin

AVAILABLE UNITS:
Days, Each, Hours, Linear Feet (LF), Lump Sum (LS), Months, Square Feet (SF), Squares (sq)

DESCRIPTION GUIDELINES:
- Group descriptions are CLIENT-FACING: professional scope language describing what the client is getting
  Example: "Provide and install new kitchen cabinetry including island, base cabinets, and upper cabinets per design plans."
- Item descriptions are for INSTALLERS/TRADE PARTNERS: technical details, specs, measurements
  Example: "James Hardie lap siding, 8.25\" exposure, smooth finish. Install per manufacturer specs with 1.25\" galvanized nails."

SPEC WRITING CONVENTIONS:
- Standard openers: "Provide and install...", "Furnish and install...", "Remove and replace...", "Remove and dispose of..."
- Material format: Manufacturer, Product/Series, Style/Model, Color, Finish, Type/Size
- Never mention subcontractor or vendor names in descriptions

BKB LABOR RATES:
- BKB Crew (internal labor): $85/hr cost, $125/hr price
- Common labor item naming: "BKB_[CodeNumber]01_[Description]" (e.g., "BKB_0401_Framing")
- Labor code always uses cost code matching the trade (e.g., framing labor = code 04)

CONVERSATION FLOW:
1. User provides scope (text description, transcript, or vendor estimate details)
2. You analyze and extract: areas, trades involved, materials, quantities, labor type
3. Ask 3-5 targeted clarifying questions about unknowns (see STRUCTURED QUESTIONS below)
4. Once you have enough info, produce the budget proposal
5. Allow iterative refinement: user can say "add demo" or "change framing to 300 SF"

STRUCTURED QUESTIONS FORMAT:
When asking clarifying questions, you MUST output them as BOTH a structured JSON block AND a readable explanation. The frontend will parse the JSON to show interactive picker UI so users can click instead of type.

Wrap questions in markers. Each question needs:
- "id": unique string
- "question": the question text
- "options": array of 3-5 suggested answers (strings). Make these specific and practical for BKB work.
- "allowCustom": true (always)

Example:
@@QUESTIONS@@
[
  {
    "id": "cabinet_style",
    "question": "What style/type of cabinets?",
    "options": ["Shaker style", "Flat panel/slab", "Raised panel", "Custom TBD"],
    "allowCustom": true
  },
  {
    "id": "demo_scope",
    "question": "Does this include demo of existing?",
    "options": ["Yes - full demo", "Yes - partial demo", "No - new construction only"],
    "allowCustom": true
  }
]
@@END_QUESTIONS@@

After the JSON block, write a brief conversational summary so the user has context (e.g., "I need a few details before I can build your estimate..."). Keep the readable part SHORT — the interactive pickers will carry the detail.

CRITICAL: Every set of clarifying questions MUST use the @@QUESTIONS@@ format. Do NOT ask questions as plain numbered text.

PRODUCING THE BUDGET PROPOSAL:
When you have gathered enough information, output a JSON block wrapped in markers:

@@BUDGET_PROPOSAL@@
{
  "estimateType": "initial" or "change-order",
  "changeOrderName": "name if change order",
  "areaName": "Kitchen",
  "lineItems": [
    {
      "name": "Item Name",
      "description": "Installer-facing description",
      "costCodeNumber": "04",
      "costTypeName": "Subcontractor",
      "unitName": "Square Feet",
      "quantity": 200,
      "unitCost": 41,
      "unitPrice": 55,
      "groupName": "Scope of Work > Kitchen > Framing Specifications",
      "groupDescription": "Provide structural framing per architectural plans.",
      "organizationCostItemId": "catalog-item-id-if-known"
    }
  ]
}
@@END_PROPOSAL@@

IMPORTANT RULES:
- Always include the groupName path with proper " > " separators
- Use IDs from the cost catalog when referencing standard items
- Cost and price should reflect BKB's margin structure
- For Lump Sum items, quantity is typically 1
- Group descriptions should NOT duplicate item descriptions
- If the user asks to modify the proposal, output a complete new proposal (not a partial update)
- If you're unsure about a price, use an allowance with a reasonable estimate and flag it
- Never create items under cost code 07 or 21

IMPORTANT: Do NOT produce a budget proposal until you have asked at least one round of clarifying questions. Always ensure you understand the scope before proposing numbers.`;
}

// -- Context Builder --

export async function buildEstimatingContext(
  jobId?: string,
  estimateType: 'initial' | 'change-order' = 'initial'
): Promise<{ systemPrompt: string; catalogContext: string; catalog: CostCatalog }> {
  const catalog = await getCachedCatalog();
  const catalogContext = formatCatalogForAgent(catalog);
  const systemPrompt = buildSystemPrompt(estimateType);

  return { systemPrompt, catalogContext, catalog };
}

// -- Parse structured questions from agent response --

export interface StructuredQuestion {
  id: string;
  question: string;
  options: string[];
  allowCustom: boolean;
}

export function parseStructuredQuestions(reply: string): StructuredQuestion[] | null {
  const match = reply.match(/@@QUESTIONS@@\s*([\s\S]*?)\s*@@END_QUESTIONS@@/);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1].trim());
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw.map((q: any) => ({
      id: q.id || `q_${Math.random().toString(36).slice(2, 8)}`,
      question: q.question || '',
      options: Array.isArray(q.options) ? q.options : [],
      allowCustom: q.allowCustom !== false,
    }));
  } catch (err) {
    console.error('Failed to parse structured questions:', err);
    return null;
  }
}

export function stripQuestionMarkers(reply: string): string {
  return reply
    .replace(/@@QUESTIONS@@[\s\S]*?@@END_QUESTIONS@@/g, '')
    .trim();
}

// -- Parse budget proposal from agent response --

export function parseProposedBudget(reply: string): ProposedBudget | null {
  const match = reply.match(/@@BUDGET_PROPOSAL@@\s*([\s\S]*?)\s*@@END_PROPOSAL@@/);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1].trim());
    const lineItems: BudgetLineItem[] = (raw.lineItems || []).map((item: any) => ({
      name: item.name || '',
      description: item.description || '',
      costCodeId: '', // Resolved later from catalog
      costCodeNumber: item.costCodeNumber || '',
      costTypeName: item.costTypeName || 'Materials',
      costTypeId: '', // Resolved later
      unitName: item.unitName || 'Lump Sum',
      unitId: '', // Resolved later
      quantity: item.quantity || 1,
      unitCost: item.unitCost || 0,
      unitPrice: item.unitPrice || item.unitCost ? calculatePrice(item.unitCost, item.costTypeName || 'Materials') : 0,
      groupName: item.groupName || '',
      groupDescription: item.groupDescription || '',
      organizationCostItemId: item.organizationCostItemId || undefined,
    }));

    const totalCost = lineItems.reduce((sum, i) => sum + (i.quantity * i.unitCost), 0);
    const totalPrice = lineItems.reduce((sum, i) => sum + (i.quantity * i.unitPrice), 0);

    return {
      estimateType: raw.estimateType || 'initial',
      changeOrderName: raw.changeOrderName,
      areaName: raw.areaName || '',
      lineItems,
      totalCost,
      totalPrice,
    };
  } catch (err) {
    console.error('Failed to parse budget proposal:', err);
    return null;
  }
}

// -- Resolve IDs from catalog --

export function resolveIds(budget: ProposedBudget, catalog: CostCatalog): ProposedBudget {
  const codeMap = new Map(catalog.costCodes.map((c) => [c.number, c.id]));
  const typeMap = new Map(catalog.costTypes.map((t) => [t.name.toLowerCase(), t.id]));
  const unitMap = new Map(catalog.units.map((u) => [u.name.toLowerCase(), u.id]));
  // Also map common abbreviations
  const abbreviationMap: Record<string, string> = {
    'ea': 'each', 'ls': 'lump sum', 'sf': 'square feet', 'lf': 'linear feet',
    'hr': 'hours', 'hrs': 'hours', 'sq': 'squares', 'mo': 'months', 'day': 'days',
  };
  for (const [abbr, full] of Object.entries(abbreviationMap)) {
    const id = unitMap.get(full);
    if (id) unitMap.set(abbr, id);
  }

  return {
    ...budget,
    lineItems: budget.lineItems.map((item) => ({
      ...item,
      costCodeId: codeMap.get(item.costCodeNumber) || item.costCodeId,
      costTypeId: typeMap.get(item.costTypeName.toLowerCase()) || item.costTypeId,
      unitId: unitMap.get(item.unitName.toLowerCase()) || item.unitId,
    })),
  };
}

// -- Strip proposal markers from reply for display --

export function stripProposalMarkers(reply: string): string {
  return reply
    .replace(/@@BUDGET_PROPOSAL@@[\s\S]*?@@END_PROPOSAL@@/g, '')
    .replace(/```json\s*@@BUDGET_PROPOSAL@@[\s\S]*?@@END_PROPOSAL@@\s*```/g, '')
    .trim();
}
