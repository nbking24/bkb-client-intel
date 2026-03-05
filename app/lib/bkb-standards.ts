/**
 * BKB Builder Standard Specifications
 *
 * These are Brett King Builder's standard construction practices and contract verbiage.
 * The spec writer uses these to:
 *   1. Pre-fill known standards into generated specifications
 *   2. Skip Q&A questions that are already answered by company standards
 *   3. Only ask project-specific questions for items marked as such
 *
 * Items marked projectSpecific: true will still generate questions in the spec writer.
 * Items with standardSpec text will be included directly in the specification output.
 */

export interface BKBStandard {
  category: string;
  categoryKeywords: string[];  // keywords to match against cost group names
  standardSpec: string;        // standard verbiage/details to include
  projectSpecific: boolean;    // if true, still ask questions for this area
}

export const BKB_STANDARDS: BKBStandard[] = [
  // ============================================================
  // DESIGN, ENGINEERING & PERMITTING
  // ============================================================
  {
    category: 'Design, Engineering & Permitting',
    categoryKeywords: ['design', 'engineering', 'permit', 'architectural', 'plans', 'drawings'],
    standardSpec: `Design and engineering services have been completed under a separate design agreement prior to this construction contract. Construction documents and permitted plans serve as the basis for this scope of work. BKB shall handle all building permit applications and coordinate required inspections. Permit fees are excluded from this contract and will be billed as a pass-through cost.`,
    projectSpecific: false,
  },

  // ============================================================
  // DEMOLITION
  // ============================================================
  {
    category: 'Demolition',
    categoryKeywords: ['demo', 'demolition', 'selective demo', 'tear out', 'removal'],
    standardSpec: `Demolition shall be performed per construction documents. All existing finishes, structures, and utilities designated to remain shall be protected during demolition. Debris to be removed to on-site dumpster daily.`,
    projectSpecific: true, // scope of demo is always project-specific
  },

  // ============================================================
  // FRAMING
  // ============================================================
  {
    category: 'Framing',
    categoryKeywords: ['framing', 'rough framing', 'structural framing', 'wall framing', 'floor framing', 'roof framing'],
    standardSpec: `*Standard Framing Specifications:*
- Wall framing: 2x6 studs at 16" on center
- Sheathing: CDX fir sheathing
- Weather barrier: BlueSkin VP100 or Benjamin Obdyke HydroGap (per project selection)
- Headers and beams: Per engineering specifications on approved plans
- Sill plates at concrete contact: Pressure-treated lumber with foam sill seal gasket
- All framing to comply with approved engineering plans and local building code`,
    projectSpecific: true, // specific framing scope varies per project
  },

  // ============================================================
  // INSULATION
  // ============================================================
  {
    category: 'Insulation',
    categoryKeywords: ['insulation', 'insulate', 'spray foam', 'batt insulation'],
    standardSpec: `*Standard Insulation Specifications:*
- Exterior walls: Closed cell spray foam insulation
- Roof/ceiling: Spray foam insulation applied at roofline (conditioned attic space)
- All insulation to meet or exceed current energy code requirements`,
    projectSpecific: true, // R-values and specific areas vary
  },

  // ============================================================
  // WINDOWS & DOORS
  // ============================================================
  {
    category: 'Windows',
    categoryKeywords: ['window', 'windows'],
    standardSpec: `*Standard Window Specifications:*
- Glass package: Dual pane Low-E with argon fill
- Window manufacturer, series, frame material, and style are project-specific selections`,
    projectSpecific: true, // manufacturer, style, sizes are project-specific
  },
  {
    category: 'Doors',
    categoryKeywords: ['door', 'doors', 'interior door', 'exterior door'],
    standardSpec: `*Standard Door Specifications:*
- Interior doors: Solid core construction
- Interior door style: Project-specific selection
- Door hardware: Project-specific selection (manufacturer, style, finish, function)`,
    projectSpecific: true, // style, hardware are project-specific
  },

  // ============================================================
  // PLUMBING
  // ============================================================
  {
    category: 'Plumbing',
    categoryKeywords: ['plumbing', 'plumb', 'fixtures', 'faucet', 'toilet', 'shower valve'],
    standardSpec: `*Standard Plumbing Specifications:*
- Plumbing fixtures: Lump sum fixture allowance as noted in budget
- All plumbing to be installed per approved plans and local plumbing code`,
    projectSpecific: true, // fixture selections, rough-in locations are project-specific
  },

  // ============================================================
  // ELECTRICAL
  // ============================================================
  {
    category: 'Electrical',
    categoryKeywords: ['electrical', 'electric', 'wiring', 'panel', 'service', 'lighting'],
    standardSpec: `*Standard Electrical Specifications:*
- Electrical service: 200 amp main panel (standard)
- Recessed lighting throughout all renovated spaces
- Dimmer switches included on all recessed lighting
- Surface-mounted light fixtures are NOT provided or budgeted unless specifically noted in the scope of work
- All electrical to be installed per approved plans and local electrical code`,
    projectSpecific: true, // layout, fixture counts, specialty circuits vary
  },

  // ============================================================
  // DRYWALL
  // ============================================================
  {
    category: 'Drywall',
    categoryKeywords: ['drywall', 'sheetrock', 'gypsum', 'wallboard', 'drywall finish'],
    standardSpec: `*Standard Drywall Specifications:*
- Drywall finish: Level 4 finish throughout (tape, bed, and two coats of joint compound, sanded smooth)
- Drywall type and thickness per approved plans and code requirements (moisture-resistant in wet areas)`,
    projectSpecific: false, // Level 4 is always the standard
  },

  // ============================================================
  // PAINTING
  // ============================================================
  {
    category: 'Painting',
    categoryKeywords: ['paint', 'painting', 'interior paint', 'exterior paint', 'stain'],
    standardSpec: `*Standard Painting Specifications:*
- Application: 1 coat primer + 2 finish coats on all painted surfaces
- Wall finish: Satin
- Trim/millwork finish: Semi-gloss
- Ceiling finish: Flat
- Standard color allowance: 2 colors (1 wall color + 1 trim color)
- Additional colors or accent walls may be added via change order
- Paint manufacturer is project-specific selection`,
    projectSpecific: true, // manufacturer, colors are project-specific
  },

  // ============================================================
  // INTERIOR TRIM
  // ============================================================
  {
    category: 'Interior Trim',
    categoryKeywords: ['trim', 'millwork', 'casing', 'baseboard', 'crown', 'interior trim', 'finish carpentry'],
    standardSpec: `*Standard Interior Trim Notes:*
- Interior trim style (casing, baseboard, crown): Project-specific selection
- All trim to be primed and painted per painting specifications`,
    projectSpecific: true, // styles are always project-specific
  },

  // ============================================================
  // TILE
  // ============================================================
  {
    category: 'Tile',
    categoryKeywords: ['tile', 'tiling', 'backsplash', 'floor tile', 'wall tile', 'shower tile'],
    standardSpec: `*Standard Tile Specifications:*
- Tile material: Per material allowance as noted in budget ($/SF)
- Tile substrate and waterproofing system: Project-specific
- Grout color: Project-specific selection`,
    projectSpecific: true, // substrate, waterproofing, selections vary
  },

  // ============================================================
  // FLOORING
  // ============================================================
  {
    category: 'Flooring',
    categoryKeywords: ['flooring', 'floor', 'hardwood', 'lvp', 'vinyl plank', 'carpet', 'laminate'],
    standardSpec: `*Standard Flooring Specifications:*
- Flooring material: Per material allowance as noted in budget ($/SF)
- Flooring type and selection are project-specific`,
    projectSpecific: true, // type and selection always vary
  },

  // ============================================================
  // COUNTERTOPS
  // ============================================================
  {
    category: 'Countertops',
    categoryKeywords: ['countertop', 'counter top', 'counter', 'granite', 'quartz', 'marble', 'stone top'],
    standardSpec: `*Standard Countertop Specifications:*
- Countertop material: Per allowance as noted in budget ($/SF or lump sum)
- Material type, color, and edge profile are project-specific selections`,
    projectSpecific: true, // selections are project-specific
  },

  // ============================================================
  // CABINETS
  // ============================================================
  {
    category: 'Cabinets',
    categoryKeywords: ['cabinet', 'cabinetry', 'vanity', 'kitchen cabinet', 'bath cabinet'],
    standardSpec: '', // fully project-specific
    projectSpecific: true,
  },

  // ============================================================
  // APPLIANCES
  // ============================================================
  {
    category: 'Appliances',
    categoryKeywords: ['appliance', 'appliances', 'range', 'dishwasher', 'refrigerator', 'microwave', 'oven'],
    standardSpec: `*Standard Appliance Specifications:*
- Appliances are owner-supplied
- Installation by others (not included in BKB scope unless specifically noted)`,
    projectSpecific: false,
  },

  // ============================================================
  // DUMPSTER & SITE CLEANS
  // ============================================================
  {
    category: 'Dumpster & Site Cleans',
    categoryKeywords: ['dumpster', 'site clean', 'cleanup', 'debris', 'waste', 'disposal', 'trash', 'portable'],
    standardSpec: `*Standard Dumpster & Site Clean Specifications:*
- Roll-off dumpster maintained on-site for duration of project
- Daily broom-clean of active work areas
- Construction debris removed to dumpster daily
- Final construction clean included prior to owner move-in/occupancy`,
    projectSpecific: false,
  },

  // ============================================================
  // PROJECT MANAGEMENT
  // ============================================================
  {
    category: 'Project Management',
    categoryKeywords: ['project management', 'pm', 'supervision', 'general conditions', 'overhead'],
    standardSpec: `*Standard Project Management:*
- Dedicated project manager assigned for duration of project
- Weekly progress updates provided to client
- Client access to online project portal with schedule and project updates
- BKB to coordinate all subcontractors, material deliveries, and inspections`,
    projectSpecific: false,
  },

  // ============================================================
  // STANDARD EXCLUSIONS & CLARIFICATIONS
  // ============================================================
  {
    category: 'Standard Exclusions',
    categoryKeywords: ['exclusion', 'clarification', 'general'],
    standardSpec: `*Standard Exclusions & Clarifications:*
- Asbestos abatement: Not included. If asbestos-containing materials are discovered, abatement by licensed specialist will be quoted separately
- Mold remediation: Not included. If mold is discovered, remediation by licensed specialist will be quoted separately
- Concealed conditions: Unforeseen conditions discovered behind walls, above ceilings, or below floors are not included and will be addressed via change order
- Subfloor: If existing subfloor is discovered to not be 3/4" thick, replacement or supplementation will be addressed via change order
- Surface-mounted light fixtures: Not provided or budgeted unless specifically specified in the scope of work`,
    projectSpecific: false,
  },

  // ============================================================
  // WARRANTY
  // ============================================================
  {
    category: 'Warranty',
    categoryKeywords: ['warranty', 'guarantee'],
    standardSpec: `*Warranty:*
- BKB provides a 2-year workmanship warranty from date of substantial completion
- Manufacturer warranties on materials and products are passed through to the owner`,
    projectSpecific: false,
  },

  // ============================================================
  // CHANGE ORDERS
  // ============================================================
  {
    category: 'Change Orders',
    categoryKeywords: ['change order', 'changes', 'modifications', 'additions'],
    standardSpec: `*Change Order Process:*
- All changes to the scope of work require a written change order signed by both parties before work proceeds
- Change orders will include a description of the change, associated cost impact, and any schedule impact`,
    projectSpecific: false,
  },
];

/**
 * Find matching BKB standards for a given cost group name.
 * Returns all standards whose keywords match the group name.
 */
export function findMatchingStandards(groupName: string): BKBStandard[] {
  const nameLower = groupName.toLowerCase();
  return BKB_STANDARDS.filter((std) =>
    std.categoryKeywords.some((kw) => nameLower.includes(kw))
  );
}

/**
 * Get the combined standard spec text for a cost group.
 * Used by the spec generator to include pre-defined standards.
 */
export function getStandardSpecText(groupName: string): string {
  const matches = findMatchingStandards(groupName);
  const specTexts = matches
    .filter((m) => m.standardSpec.trim().length > 0)
    .map((m) => m.standardSpec);
  return specTexts.join('\n\n');
}

/**
 * Check if a cost group is fully covered by standards (no project-specific questions needed).
 */
export function isFullyCoveredByStandards(groupName: string): boolean {
  const matches = findMatchingStandards(groupName);
  if (matches.length === 0) return false;
  return matches.every((m) => !m.projectSpecific);
}

/**
 * Get standard spec text formatted for inclusion in AI prompts.
 */
export function getStandardsForPrompt(groupName: string): string {
  const standardText = getStandardSpecText(groupName);
  const fullyCovered = isFullyCoveredByStandards(groupName);

  if (!standardText) return '';

  let prompt = `\nBKB COMPANY STANDARD SPECIFICATIONS FOR THIS CATEGORY:\n${standardText}\n`;

  if (fullyCovered) {
    prompt += `\nNOTE: This category is FULLY covered by BKB company standards. No additional project-specific questions are needed.\n`;
  } else {
    prompt += `\nNOTE: The above are BKB company standards. DO NOT ask questions about details already covered above. Only ask about project-specific details not covered by these standards.\n`;
  }

  return prompt;
}
