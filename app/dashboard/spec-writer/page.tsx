'use client';

import { useState, useRef, Suspense } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Zap,
  Search,
  FileText,
  Upload,
  X,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  Loader2,
  Paperclip,
  ArrowRight,
  PenTool,
  AlertTriangle,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================
interface FollowUpQuestion {
  id: string;
  category: string;
  categoryNum: string;
  question: string;
  options: string[];
  allowCustom: boolean;
}

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  content?: string;
  extracting?: boolean;
}

// ============================================================
// BKB Category System
// ============================================================
const BKB_CATEGORIES: Record<string, string> = {
  '01': 'Planning, Admin',
  '02': 'Demolition, Sitework',
  '03': 'Concrete, Stone',
  '04': 'Framing',
  '05': 'Windows-Doors',
  '06': 'Exterior Finish, Decks',
  '08': 'Roofing',
  '09': 'Insulation',
  '10': 'Plumbing',
  '11': 'HVAC',
  '12': 'Electrical',
  '13': 'Drywall',
  '14': 'Interior Finish',
  '15': 'Painting',
  '16': 'Cabinets-Countertops',
  '17': 'Tile',
  '18': 'Appliances',
  '19': 'Flooring',
  '20': 'Shower Glass-Specialty',
  '22': 'Furnishings',
  '23': 'Miscellaneous/billable',
};

// ============================================================
// Keyword Detection -> Follow-up Questions
// ============================================================
interface KeywordRule {
  keywords: string[];
  categoryNum: string;
  questions: {
    id: string;
    question: string;
    options: string[];
  }[];
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    keywords: ['demolition', 'demo', 'tear down', 'gut', 'strip'],
    categoryNum: '02',
    questions: [
      { id: 'demo_scope', question: 'What is the scope of demolition?', options: ['Full gut to studs', 'Selective demolition', 'Exterior only', 'Interior only'] },
      { id: 'demo_disposal', question: 'Disposal method?', options: ['Dumpster on-site', 'Haul-off by contractor', 'Owner responsible'] },
    ],
  },
  {
    keywords: ['excavation', 'excavate', 'dig', 'grading', 'sitework', 'site work'],
    categoryNum: '02',
    questions: [
      { id: 'site_scope', question: 'What sitework is needed?', options: ['Excavation for foundation', 'Grading and fill', 'Utility trenching', 'Tree removal'] },
    ],
  },
  {
    keywords: ['foundation', 'concrete', 'slab', 'footing', 'basement', 'stone', 'masonry'],
    categoryNum: '03',
    questions: [
      { id: 'foundation_type', question: 'What type of foundation?', options: ['Full basement', 'Crawl space', 'Slab on grade', 'Piers/footings only'] },
      { id: 'concrete_finish', question: 'Concrete finish?', options: ['Standard broom finish', 'Smooth trowel', 'Stamped/decorative', 'Exposed aggregate'] },
    ],
  },
  {
    keywords: ['framing', 'frame', 'structural', 'addition', 'build out', 'walls'],
    categoryNum: '04',
    questions: [
      { id: 'framing_type', question: 'What type of framing?', options: ['Wood stud 2x4', 'Wood stud 2x6', 'Steel stud', 'Engineered lumber/LVL'] },
      { id: 'framing_scope', question: 'Framing scope?', options: ['New construction', 'Addition to existing', 'Structural modifications', 'Non-structural partitions'] },
    ],
  },
  {
    keywords: ['window', 'windows', 'door', 'doors', 'entry door', 'sliding door', 'patio door'],
    categoryNum: '05',
    questions: [
      { id: 'window_brand', question: 'What window brand/line?', options: ['Marvin Ultimate', 'Marvin Elevate', 'Andersen 400 Series', 'Pella Lifestyle'] },
      { id: 'window_material', question: 'Window frame material?', options: ['Wood clad exterior', 'Fiberglass', 'Vinyl', 'All wood'] },
      { id: 'door_type', question: 'What exterior door types?', options: ['Custom wood entry', 'Fiberglass entry', 'French doors', 'Sliding patio door'] },
    ],
  },
  {
    keywords: ['siding', 'horizontal siding', 'cedar', 'hardie', 'stucco', 'trim', 'soffit', 'fascia', 'exterior finish', 'deck', 'decking', 'railing'],
    categoryNum: '06',
    questions: [
      { id: 'siding_type', question: 'What siding material?', options: ['HardiePlank lap', 'Cedar bevel', 'Cedar shingle', 'LP SmartSide', 'Stucco', 'Board and batten'] },
      { id: 'siding_profile', question: 'Siding profile/exposure?', options: ['4" exposure', '5" exposure', '6" exposure', '8" exposure'] },
      { id: 'trim_material', question: 'Exterior trim material?', options: ['PVC/Azek', 'Cedar', 'HardieTrim', 'Painted wood'] },
    ],
  },
  {
    keywords: ['roof', 'roofing', 'shingle', 'shingles', 'asphalt', 'slate', 'metal roof', 'gutter', 'gutters', 'flashing'],
    categoryNum: '08',
    questions: [
      { id: 'roof_material', question: 'What roofing material?', options: ['Asphalt architectural shingles', 'Natural slate', 'Synthetic slate', 'Standing seam metal', 'Cedar shake'] },
      { id: 'roof_brand', question: 'Shingle brand/line (if asphalt)?', options: ['GAF Timberline HDZ', 'CertainTeed Landmark Pro', 'Owens Corning Duration', 'N/A - not asphalt'] },
      { id: 'gutter_type', question: 'Gutter material?', options: ['Copper half-round', 'Aluminum seamless', 'Copper K-style', 'Zinc'] },
    ],
  },
  {
    keywords: ['insulation', 'spray foam', 'batt', 'vapor barrier', 'air seal'],
    categoryNum: '09',
    questions: [
      { id: 'insulation_type', question: 'What insulation type?', options: ['Closed-cell spray foam', 'Open-cell spray foam', 'Fiberglass batt', 'Mineral wool', 'Rigid foam board'] },
      { id: 'insulation_location', question: 'Where is insulation going?', options: ['Exterior walls', 'Attic/roof', 'Basement/crawl', 'All of the above'] },
    ],
  },
  {
    keywords: ['plumbing', 'fixtures', 'faucet', 'toilet', 'shower valve', 'water heater', 'septic', 'drain', 'supply lines', 'rough-in'],
    categoryNum: '10',
    questions: [
      { id: 'plumbing_fixture_brand', question: 'Fixture brand preference?', options: ['Brizo', 'Kohler', 'Grohe', 'Delta', 'tbd'] },
      { id: 'plumbing_finish', question: 'Fixture finish?', options: ['Brushed Nickel', 'Polished Chrome', 'Matte Black', 'Satin Brass', 'tbd'] },
      { id: 'plumbing_scope', question: 'Plumbing scope?', options: ['Full rough-in and fixtures', 'Fixtures only (rough-in exists)', 'Rough-in only', 'Relocate existing'] },
      { id: 'water_heater', question: 'Water heater?', options: ['Tankless gas', 'Tankless electric', 'Standard tank gas', 'Heat pump/hybrid', 'Not included'] },
    ],
  },
  {
    keywords: ['hvac', 'heating', 'cooling', 'air conditioning', 'furnace', 'ductwork', 'mini split', 'thermostat'],
    categoryNum: '11',
    questions: [
      { id: 'hvac_type', question: 'What HVAC system?', options: ['Central forced air', 'Ductless mini-split', 'High-velocity (Unico/SpacePak)', 'Radiant floor heat', 'Heat pump'] },
      { id: 'hvac_brand', question: 'HVAC brand preference?', options: ['Carrier', 'Mitsubishi', 'Daikin', 'Trane', 'tbd'] },
    ],
  },
  {
    keywords: ['electrical', 'wiring', 'panel', 'outlets', 'switches', 'lighting', 'light fixtures', 'recessed', 'low voltage', 'data'],
    categoryNum: '12',
    questions: [
      { id: 'electrical_scope', question: 'Electrical scope?', options: ['Full rewire', 'New circuits/panel upgrade', 'Fixtures and devices only', 'Low voltage/data only'] },
      { id: 'electrical_panel', question: 'Panel upgrade needed?', options: ['New 200-amp main', 'New sub-panel', 'Existing panel adequate', 'tbd'] },
      { id: 'lighting_type', question: 'Primary lighting type?', options: ['LED recessed (IC rated)', 'Decorative fixtures', 'Under-cabinet LED', 'Mix of types'] },
    ],
  },
  {
    keywords: ['drywall', 'plaster', 'sheetrock', 'taping', 'skim coat'],
    categoryNum: '13',
    questions: [
      { id: 'drywall_scope', question: 'Drywall/plaster scope?', options: ['New drywall throughout', 'New plaster walls and ceilings', 'Patch and repair only', 'Drywall with Level 5 finish'] },
    ],
  },
  {
    keywords: ['trim', 'millwork', 'molding', 'crown', 'baseboard', 'casing', 'wainscot', 'staircase', 'stairs', 'railing', 'built-in', 'mantel', 'fireplace'],
    categoryNum: '14',
    questions: [
      { id: 'trim_style', question: 'Trim/millwork style?', options: ['Craftsman/shaker', 'Traditional/colonial', 'Modern/minimal', 'Custom profile'] },
      { id: 'trim_material', question: 'Interior trim material?', options: ['Paint-grade poplar', 'Stain-grade oak', 'MDF', 'Custom millwork'] },
      { id: 'trim_items', question: 'What trim elements?', options: ['Base, casing, crown', 'Base and casing only', 'Full package with wainscot', 'Custom built-ins included'] },
    ],
  },
  {
    keywords: ['paint', 'painting', 'stain', 'primer', 'wallpaper', 'finish coat'],
    categoryNum: '15',
    questions: [
      { id: 'paint_brand', question: 'Paint brand?', options: ['Benjamin Moore Advance', 'Benjamin Moore Regal', 'Sherwin-Williams Emerald', 'Farrow & Ball'] },
      { id: 'paint_scope', question: 'Painting scope?', options: ['Interior only', 'Exterior only', 'Interior and exterior', 'Trim and doors only'] },
      { id: 'paint_sheen', question: 'Wall sheen?', options: ['Matte', 'Eggshell', 'Satin', 'Semi-gloss'] },
    ],
  },
  {
    keywords: ['cabinet', 'cabinets', 'cabinetry', 'countertop', 'countertops', 'vanity', 'vanities', 'soapstone', 'granite', 'quartz', 'marble countertop', 'backsplash'],
    categoryNum: '16',
    questions: [
      { id: 'cabinet_brand', question: 'Cabinet brand/type?', options: ['Custom site-built', 'Semi-custom (Shiloh, Wellborn)', 'Stock (KraftMaid)', 'tbd'] },
      { id: 'countertop_material', question: 'Countertop material?', options: ['Soapstone', 'Quartz (Cambria, Caesarstone)', 'Granite', 'Marble', 'Butcher block', 'tbd'] },
      { id: 'cabinet_finish', question: 'Cabinet finish?', options: ['Painted', 'Stained', 'Natural/clear coat', 'Two-tone'] },
    ],
  },
  {
    keywords: ['tile', 'tiling', 'floor tile', 'wall tile', 'shower tile', 'mosaic', 'subway', 'porcelain', 'ceramic'],
    categoryNum: '17',
    questions: [
      { id: 'tile_brand', question: 'Tile brand/supplier?', options: ['DalTile', 'Ann Sacks', 'Waterworks', 'Ceramic Tileworks', 'tbd'] },
      { id: 'tile_location', question: 'Where is tile going?', options: ['Bathroom floors', 'Shower walls and floor', 'Kitchen backsplash', 'Multiple locations'] },
      { id: 'tile_size', question: 'Primary tile size?', options: ['12x24', '24x48', '3x12 subway', '2x2 mosaic', 'tbd'] },
    ],
  },
  {
    keywords: ['appliance', 'appliances', 'range', 'refrigerator', 'dishwasher', 'oven', 'vent hood', 'microwave', 'washer', 'dryer'],
    categoryNum: '18',
    questions: [
      { id: 'appliance_brand', question: 'Appliance brand?', options: ['Wolf/Sub-Zero', 'Thermador', 'Bosch', 'KitchenAid', 'tbd'] },
      { id: 'appliance_items', question: 'Which appliances?', options: ['Full kitchen package', 'Range and hood only', 'All kitchen + laundry', 'Individual items'] },
    ],
  },
  {
    keywords: ['flooring', 'hardwood', 'wood floor', 'lvp', 'luxury vinyl', 'carpet', 'tile floor', 'white oak', 'red oak'],
    categoryNum: '19',
    questions: [
      { id: 'flooring_type', question: 'What flooring type?', options: ['Solid hardwood', 'Engineered hardwood', 'Luxury vinyl plank', 'Natural stone', 'Carpet'] },
      { id: 'flooring_species', question: 'Wood species (if hardwood)?', options: ['White Oak', 'Red Oak', 'Walnut', 'Maple', 'Hickory', 'N/A'] },
      { id: 'flooring_width', question: 'Plank width?', options: ['3.25"', '5"', '7"+ wide plank', 'Mixed/random width', 'N/A'] },
      { id: 'flooring_finish', question: 'Floor finish?', options: ['Site-finished (sand and stain)', 'Pre-finished', 'Natural/clear coat', 'Custom stain color'] },
    ],
  },
  {
    keywords: ['shower glass', 'shower door', 'glass enclosure', 'mirror', 'specialty glass'],
    categoryNum: '20',
    questions: [
      { id: 'glass_type', question: 'Shower glass type?', options: ['Frameless clear', 'Semi-frameless', 'Framed', 'Custom/specialty'] },
    ],
  },
  {
    keywords: ['kitchen'],
    categoryNum: '16',
    questions: [
      { id: 'kitchen_layout', question: 'Kitchen layout change?', options: ['New layout per plans', 'Existing layout, new finishes', 'Partial reconfiguration', 'tbd'] },
    ],
  },
  {
    keywords: ['bathroom', 'bath', 'half bath', 'powder room', 'master bath'],
    categoryNum: '10',
    questions: [
      { id: 'bath_scope', question: 'Bathroom scope?', options: ['Full gut renovation', 'Fixtures and finishes only', 'New addition bathroom', 'Cosmetic update'] },
      { id: 'bath_shower', question: 'Shower/tub configuration?', options: ['Walk-in shower, no tub', 'Tub/shower combo', 'Freestanding tub + separate shower', 'Existing to remain'] },
    ],
  },
  // General construction catch-all
  {
    keywords: ['permit', 'permits', 'design', 'engineering', 'survey', 'plans', 'architecture'],
    categoryNum: '01',
    questions: [
      { id: 'permits_scope', question: 'Planning/admin items?', options: ['Building permit included', 'Design fees included', 'Engineering included', 'Permits by owner'] },
    ],
  },
];

// ============================================================
// Detect keywords and generate questions
// ============================================================
function detectQuestions(text: string): FollowUpQuestion[] {
  const lower = text.toLowerCase();
  const questions: FollowUpQuestion[] = [];
  const seenIds = new Set<string>();

  for (const rule of KEYWORD_RULES) {
    const matched = rule.keywords.some((kw) => lower.includes(kw));
    if (matched) {
      for (const q of rule.questions) {
        if (!seenIds.has(q.id)) {
          seenIds.add(q.id);
          questions.push({
            id: q.id,
            category: BKB_CATEGORIES[rule.categoryNum] || '',
            categoryNum: rule.categoryNum,
            question: q.question,
            options: q.options,
            allowCustom: true,
          });
        }
      }
    }
  }

  // Sort by category number
  questions.sort((a, b) => a.categoryNum.localeCompare(b.categoryNum));
  return questions;
}

// ============================================================
// Spec Generation Engine
// ============================================================
function generateSpec(
  inputText: string,
  answers: Record<string, string>,
  mode: 'quick' | 'detailed'
): string {
  const lower = inputText.toLowerCase();
  const sections: { num: string; name: string; lines: string[] }[] = [];

  function addSection(num: string, lines: string[]) {
    const existing = sections.find((s) => s.num === num);
    if (existing) {
      existing.lines.push(...lines);
    } else {
      sections.push({ num, name: BKB_CATEGORIES[num] || '', lines });
    }
  }

  // Helper to get answer or 'tbd'
  function ans(id: string): string {
    return answers[id] && answers[id] !== '' ? answers[id] : 'tbd';
  }

  // 01 Planning, Admin
  if (['permit', 'design', 'engineering', 'plans', 'survey', 'architecture', 'addition', 'new construction', 'new structure'].some((k) => lower.includes(k))) {
    const lines = ['Provide all required building permits and inspections.'];
    if (mode === 'detailed') {
      const scope = ans('permits_scope');
      if (scope !== 'tbd') lines[0] = scope.includes('permit') ? 'Provide all required building permits and inspections.' : scope + '.';
    }
    addSection('01', lines);
  }

  // 02 Demolition, Sitework
  if (['demo', 'demolition', 'gut', 'tear down', 'strip', 'excavation', 'excavate', 'grading', 'sitework', 'dig'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (['demo', 'demolition', 'gut', 'tear down', 'strip'].some((k) => lower.includes(k))) {
      if (mode === 'detailed' && ans('demo_scope') !== 'tbd') {
        lines.push(`Remove and dispose of all existing materials per ${ans('demo_scope').toLowerCase()}.`);
        if (ans('demo_disposal') !== 'tbd') lines.push(`Disposal: ${ans('demo_disposal')}.`);
      } else {
        lines.push('Remove and dispose of all existing materials per scope of demolition.');
        lines.push('Dumpster on-site for duration of demolition phase.');
      }
    }
    if (['excavation', 'excavate', 'grading', 'dig'].some((k) => lower.includes(k))) {
      if (mode === 'detailed' && ans('site_scope') !== 'tbd') {
        lines.push(`Provide and complete ${ans('site_scope').toLowerCase()} per plans.`);
      } else {
        lines.push('Provide excavation and grading per plans and specifications.');
      }
    }
    if (lines.length) addSection('02', lines);
  }

  // 03 Concrete, Stone
  if (['foundation', 'concrete', 'slab', 'footing', 'basement', 'stone', 'masonry'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const fType = ans('foundation_type');
      const fFinish = ans('concrete_finish');
      lines.push(`Provide and install ${fType !== 'tbd' ? fType.toLowerCase() : 'foundation'} per structural plans and specifications.`);
      if (fFinish !== 'tbd') lines.push(`Concrete finish: ${fFinish}.`);
    } else {
      lines.push('Provide and install foundation/concrete work per structural plans and specifications.');
    }
    addSection('03', lines);
  }

  // 04 Framing
  if (['framing', 'frame', 'structural', 'addition', 'build out', 'walls', 'new structure', 'new construction'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const fType = ans('framing_type');
      const fScope = ans('framing_scope');
      lines.push(`Provide and install ${fScope !== 'tbd' ? fScope.toLowerCase() : 'structural'} framing per plans and specifications.`);
      if (fType !== 'tbd') lines.push(`Framing material: ${fType}.`);
      lines.push('All blocking, headers, and structural connections per engineering.');
    } else {
      lines.push('Provide and install all structural framing per plans and specifications.');
      lines.push('Include all blocking, headers, beams, and structural connections per engineering.');
    }
    addSection('04', lines);
  }

  // 05 Windows-Doors
  if (['window', 'windows', 'door', 'doors', 'entry door', 'sliding door', 'patio door'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const brand = ans('window_brand');
      const material = ans('window_material');
      lines.push(`Provide and install all windows: ${brand !== 'tbd' ? brand : 'tbd per owner selection'}, ${material !== 'tbd' ? material : 'tbd'}.`);
      const doorType = ans('door_type');
      if (doorType !== 'tbd') lines.push(`Provide and install ${doorType.toLowerCase()}.`);
    } else {
      lines.push('Provide and install all windows per plans, brand and style tbd per owner selection.');
      lines.push('Provide and install all exterior doors per plans.');
    }
    lines.push('All hardware, weatherstripping, and flashing included.');
    addSection('05', lines);
  }

  // 06 Exterior Finish, Decks
  if (['siding', 'horizontal siding', 'cedar', 'hardie', 'stucco', 'trim', 'soffit', 'fascia', 'exterior finish', 'deck', 'decking', 'railing'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const sType = ans('siding_type');
      const sProfile = ans('siding_profile');
      const tMat = ans('trim_material');
      lines.push(`Provide and install ${sType !== 'tbd' ? sType : 'siding'} ${sProfile !== 'tbd' ? 'at ' + sProfile : ''} per plans.`);
      if (tMat !== 'tbd') lines.push(`Exterior trim: ${tMat}.`);
    } else {
      lines.push('Provide and install all exterior siding per plans and specifications.');
      lines.push('Provide and install all exterior trim, soffit, and fascia.');
    }
    addSection('06', lines);
  }

  // 08 Roofing
  if (['roof', 'roofing', 'shingle', 'shingles', 'asphalt', 'slate', 'metal roof', 'gutter', 'gutters', 'flashing'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const material = ans('roof_material');
      const brand = ans('roof_brand');
      const gutter = ans('gutter_type');
      lines.push(`Provide and install ${material !== 'tbd' ? material.toLowerCase() : 'roofing'} per plans.`);
      if (brand !== 'tbd' && brand !== 'N/A - not asphalt') lines.push(`Shingle: ${brand}.`);
      lines.push('Include underlayment, ice and water shield at eaves and valleys, all flashing.');
      if (gutter !== 'tbd') lines.push(`Gutters and downspouts: ${gutter}.`);
    } else {
      lines.push('Provide and install all roofing per plans and specifications.');
      lines.push('Include underlayment, ice and water shield, flashing, and ridge vent.');
      lines.push('Provide and install gutters and downspouts.');
    }
    addSection('08', lines);
  }

  // 09 Insulation
  if (['insulation', 'spray foam', 'batt', 'vapor barrier', 'air seal'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const iType = ans('insulation_type');
      const iLoc = ans('insulation_location');
      lines.push(`Provide and install ${iType !== 'tbd' ? iType.toLowerCase() : 'insulation'} ${iLoc !== 'tbd' ? 'at ' + iLoc.toLowerCase() : ''} per energy code requirements.`);
    } else {
      lines.push('Provide and install all insulation per energy code requirements and plans.');
    }
    addSection('09', lines);
  }

  // 10 Plumbing
  if (['plumbing', 'fixtures', 'faucet', 'toilet', 'shower valve', 'water heater', 'septic', 'drain', 'supply lines', 'rough-in', 'bathroom', 'bath', 'kitchen'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const brand = ans('plumbing_fixture_brand');
      const finish = ans('plumbing_finish');
      const scope = ans('plumbing_scope');
      const wh = ans('water_heater');
      lines.push(`Provide and install all plumbing, ${scope !== 'tbd' ? scope.toLowerCase() : 'rough-in and fixtures'}, per plans and specifications.`);
      if (brand !== 'tbd' || finish !== 'tbd') {
        lines.push(`Fixture specification: ${brand !== 'tbd' ? brand : 'tbd'}${finish !== 'tbd' ? ', ' + finish : ''}.`);
      }
      if (wh !== 'tbd' && wh !== 'Not included') lines.push(`Water heater: ${wh}.`);
    } else {
      lines.push('Provide and install all plumbing per plans and specifications.');
      lines.push('All fixtures, rough-in, supply lines, and drain lines included.');
    }
    if (lower.includes('septic')) {
      lines.push('Connect to existing septic system per code requirements.');
    }
    addSection('10', lines);
  }

  // 11 HVAC
  if (['hvac', 'heating', 'cooling', 'air conditioning', 'furnace', 'ductwork', 'mini split', 'thermostat'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const hType = ans('hvac_type');
      const hBrand = ans('hvac_brand');
      lines.push(`Provide and install ${hType !== 'tbd' ? hType.toLowerCase() : 'HVAC system'} per plans and specifications.`);
      if (hBrand !== 'tbd') lines.push(`Equipment: ${hBrand}.`);
    } else {
      lines.push('Provide and install HVAC system per plans and specifications.');
    }
    lines.push('All ductwork, registers, thermostats, and connections included.');
    addSection('11', lines);
  }

  // 12 Electrical
  if (['electrical', 'wiring', 'panel', 'outlets', 'switches', 'lighting', 'light fixtures', 'recessed', 'low voltage', 'data'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const scope = ans('electrical_scope');
      const panel = ans('electrical_panel');
      const lighting = ans('lighting_type');
      lines.push(`Provide and install all electrical, ${scope !== 'tbd' ? scope.toLowerCase() : 'per plans and specifications'}.`);
      if (panel !== 'tbd') lines.push(`Panel: ${panel}.`);
      if (lighting !== 'tbd') lines.push(`Lighting: ${lighting}.`);
    } else {
      lines.push('Provide and install all electrical per plans and specifications.');
      lines.push('All wiring, devices, fixtures, and connections included.');
    }
    addSection('12', lines);
  }

  // 13 Drywall
  if (['drywall', 'plaster', 'sheetrock', 'taping', 'skim coat'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const scope = ans('drywall_scope');
      lines.push(`Provide and install ${scope !== 'tbd' ? scope.toLowerCase() : 'drywall'} per plans.`);
    } else {
      lines.push('Provide and install all drywall, tape, and finish per plans.');
    }
    addSection('13', lines);
  }

  // 14 Interior Finish
  if (['trim', 'millwork', 'molding', 'crown', 'baseboard', 'casing', 'wainscot', 'staircase', 'stairs', 'railing', 'built-in', 'mantel', 'fireplace'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const style = ans('trim_style');
      const material = ans('trim_material');
      const items = ans('trim_items');
      lines.push(`Provide and install all interior trim and millwork, ${style !== 'tbd' ? style.toLowerCase() + ' profile' : 'per plans'}.`);
      if (material !== 'tbd') lines.push(`Trim material: ${material}.`);
      if (items !== 'tbd') lines.push(`Includes: ${items}.`);
    } else {
      lines.push('Provide and install all interior trim, millwork, and finish carpentry per plans.');
    }
    addSection('14', lines);
  }

  // 15 Painting
  if (['paint', 'painting', 'stain', 'primer', 'finish coat'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const brand = ans('paint_brand');
      const scope = ans('paint_scope');
      const sheen = ans('paint_sheen');
      lines.push(`Prep and paint all surfaces, ${scope !== 'tbd' ? scope.toLowerCase() : 'per plans'}.`);
      if (brand !== 'tbd') lines.push(`Paint: ${brand}.`);
      if (sheen !== 'tbd') lines.push(`Wall sheen: ${sheen}.`);
    } else {
      lines.push('Prep and paint all surfaces per plans and specifications.');
    }
    lines.push('All primer, caulk, and finish coats included.');
    addSection('15', lines);
  }

  // 16 Cabinets-Countertops
  if (['cabinet', 'cabinets', 'cabinetry', 'countertop', 'countertops', 'vanity', 'vanities', 'soapstone', 'granite', 'quartz', 'marble countertop', 'backsplash', 'kitchen'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const brand = ans('cabinet_brand');
      const counter = ans('countertop_material');
      const finish = ans('cabinet_finish');
      lines.push(`Provide and install ${brand !== 'tbd' ? brand.toLowerCase() : 'cabinetry'} per plans.`);
      if (finish !== 'tbd') lines.push(`Cabinet finish: ${finish}.`);
      if (counter !== 'tbd') lines.push(`Countertops: ${counter}.`);
    } else {
      lines.push('Provide and install all cabinetry per plans and specifications.');
      lines.push('Provide and install countertops, tbd per owner selection.');
    }
    addSection('16', lines);
  }

  // 17 Tile
  if (['tile', 'tiling', 'floor tile', 'wall tile', 'shower tile', 'mosaic', 'subway', 'porcelain', 'ceramic'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const brand = ans('tile_brand');
      const location = ans('tile_location');
      const size = ans('tile_size');
      lines.push(`Provide and install all tile at ${location !== 'tbd' ? location.toLowerCase() : 'locations per plans'}.`);
      if (brand !== 'tbd') lines.push(`Tile: ${brand}${size !== 'tbd' ? ', ' + size : ''}.`);
    } else {
      lines.push('Provide and install all tile per plans and specifications.');
    }
    lines.push('All setting materials, grout, and waterproofing included.');
    addSection('17', lines);
  }

  // 18 Appliances
  if (['appliance', 'appliances', 'range', 'refrigerator', 'dishwasher', 'oven', 'vent hood', 'microwave', 'washer', 'dryer'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const brand = ans('appliance_brand');
      const items = ans('appliance_items');
      lines.push(`Provide and install ${items !== 'tbd' ? items.toLowerCase() : 'appliances'}: ${brand !== 'tbd' ? brand : 'tbd per owner selection'}.`);
    } else {
      lines.push('Provide and install all appliances per plans, tbd per owner selection.');
    }
    addSection('18', lines);
  }

  // 19 Flooring
  if (['flooring', 'hardwood', 'wood floor', 'lvp', 'luxury vinyl', 'carpet', 'white oak', 'red oak'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const fType = ans('flooring_type');
      const species = ans('flooring_species');
      const width = ans('flooring_width');
      const finish = ans('flooring_finish');
      let desc = `Provide and install ${fType !== 'tbd' ? fType.toLowerCase() : 'flooring'}`;
      if (species !== 'tbd' && species !== 'N/A') desc += `, ${species}`;
      if (width !== 'tbd' && width !== 'N/A') desc += `, ${width}`;
      desc += ' per plans.';
      lines.push(desc);
      if (finish !== 'tbd') lines.push(`Finish: ${finish}.`);
    } else {
      lines.push('Provide and install all flooring per plans and specifications.');
    }
    lines.push('All transitions, underlayment, and adhesives included.');
    addSection('19', lines);
  }

  // 20 Shower Glass-Specialty
  if (['shower glass', 'shower door', 'glass enclosure', 'mirror', 'specialty glass'].some((k) => lower.includes(k))) {
    const lines: string[] = [];
    if (mode === 'detailed') {
      const gType = ans('glass_type');
      lines.push(`Provide and install ${gType !== 'tbd' ? gType.toLowerCase() : 'shower glass'} enclosure per plans.`);
    } else {
      lines.push('Provide and install shower glass enclosure per plans.');
    }
    addSection('20', lines);
  }

  // Sort sections by category number and format output
  sections.sort((a, b) => a.num.localeCompare(b.num));

  let output = '';
  output += '*Scope of Work*\n\n';

  for (const section of sections) {
    output += `${section.num} ${section.name}\n`;
    for (const line of section.lines) {
      output += `${line}\n`;
    }
    output += '\n';
  }

  output += '*Clarifications:*\n';
  output += '- Concealed conditions may require additional work at additional cost.\n';
  output += '- All work per applicable building codes and manufacturer specifications.\n';
  output += '- Owner selections required for items marked tbd.\n';

  return output.trim();
}

// ============================================================
// Format file size
// ============================================================
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ============================================================
// Main Spec Writer Content
// ============================================================
function SpecWriterContent() {
  // State
  const [step, setStep] = useState<'input' | 'questions' | 'output'>('input');
  const [inputText, setInputText] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [specMode, setSpecMode] = useState<'quick' | 'detailed'>('quick');
  const [questions, setQuestions] = useState<FollowUpQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [generatedSpec, setGeneratedSpec] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Group questions by category
  const questionsByCategory: Record<string, FollowUpQuestion[]> = {};
  for (const q of questions) {
    const key = `${q.categoryNum} ${q.category}`;
    if (!questionsByCategory[key]) questionsByCategory[key] = [];
    questionsByCategory[key].push(q);
  }

  // Handle Quick Spec — AI-powered generation
  async function handleQuickSpec() {
    if (!inputText.trim()) return;
    setLoading(true);
    setSpecMode('quick');

    try {
      const fileData = uploadedFiles
        .filter((f) => f.content)
        .map((f) => ({ name: f.name, content: f.content!, type: f.type }));

      const res = await fetch('/api/spec-writer/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDescription: inputText,
          mode: 'quick',
          files: fileData,
        }),
      });

      const data = await res.json();
      if (res.ok && data.specification) {
        setGeneratedSpec(data.specification);
        setStep('output');
        setLoading(false);
        return;
      }
      console.warn('AI spec generation failed, using fallback:', data.error);
    } catch (err) {
      console.warn('AI spec generation API failed, using fallback:', err);
    }

    // Fallback to template-based generation
    const spec = generateSpec(inputText, {}, 'quick');
    setGeneratedSpec(spec);
    setStep('output');
    setLoading(false);
  }

  // Handle Detailed Spec - call AI for dynamic questions, fallback to static
  async function handleDetailedSpec() {
    if (!inputText.trim()) return;
    setSpecMode('detailed');
    setIsGeneratingQuestions(true);

    try {
      // Prepare file data for API
      const fileData = uploadedFiles
        .filter((f) => f.content)
        .map((f) => ({ name: f.name, content: f.content!, type: f.type }));

      const res = await fetch('/api/spec-writer/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDescription: inputText, files: fileData }),
      });

      const data = await res.json();

      if (res.ok && data.questions && data.questions.length > 0) {
        // AI-generated questions
        setQuestions(data.questions);
        const expanded: Record<string, boolean> = {};
        for (const q of data.questions) {
          expanded[`${q.categoryNum} ${q.category}`] = true;
        }
        setExpandedCategories(expanded);
        setAnswers({});
        setIsGeneratingQuestions(false);
        setStep('questions');
        return;
      }

      // API returned fallback flag or no questions — use static rules
      console.warn('AI questions unavailable, falling back to keyword rules:', data.error);
    } catch (err) {
      console.warn('AI questions API failed, falling back to keyword rules:', err);
    }

    // Fallback: use static keyword detection
    setIsGeneratingQuestions(false);
    const detected = detectQuestions(inputText);
    if (detected.length === 0) {
      setLoading(true);
      setTimeout(() => {
        const spec = generateSpec(inputText, {}, 'quick');
        setGeneratedSpec(spec + '\n\nNOTE: No specific materials or systems were detected for follow-up questions. Add more detail to your description for a more detailed specification.');
        setStep('output');
        setLoading(false);
      }, 600);
      return;
    }
    setQuestions(detected);
    const expanded: Record<string, boolean> = {};
    for (const q of detected) {
      expanded[`${q.categoryNum} ${q.category}`] = true;
    }
    setExpandedCategories(expanded);
    setAnswers({});
    setStep('questions');
  }

  // Generate from questions — AI-powered with answers
  async function handleGenerateFromQuestions() {
    setLoading(true);

    try {
      // Build question+answer pairs for the AI
      const questionsAndAnswers = questions.map((q) => ({
        id: q.id,
        category: q.category,
        categoryNum: q.categoryNum,
        question: q.question,
        answer: answers[q.id] || 'tbd',
      }));

      const fileData = uploadedFiles
        .filter((f) => f.content)
        .map((f) => ({ name: f.name, content: f.content!, type: f.type }));

      const res = await fetch('/api/spec-writer/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDescription: inputText,
          mode: 'detailed',
          questionsAndAnswers,
          files: fileData,
        }),
      });

      const data = await res.json();
      if (res.ok && data.specification) {
        setGeneratedSpec(data.specification);
        setStep('output');
        setLoading(false);
        return;
      }
      console.warn('AI spec generation failed, using fallback:', data.error);
    } catch (err) {
      console.warn('AI spec generation API failed, using fallback:', err);
    }

    // Fallback to template-based generation
    const spec = generateSpec(inputText, answers, 'detailed');
    setGeneratedSpec(spec);
    setStep('output');
    setLoading(false);
  }

  // Copy to clipboard
  async function handleCopy() {
    await navigator.clipboard.writeText('```\n' + generatedSpec + '\n```');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Download as .md
  function handleDownload() {
    const blob = new Blob(['```\n' + generatedSpec + '\n```'], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'specification.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  // File upload — read text content where possible for AI analysis
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const textReadableTypes = [
      'text/plain', 'text/csv', 'text/html', 'text/markdown',
      'application/json',
    ];
    const textReadableExtensions = ['.txt', '.csv', '.html', '.md', '.json'];

    Array.from(files).forEach((f) => {
      const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
      const isTextReadable = textReadableTypes.includes(f.type) ||
        textReadableExtensions.includes(ext);
      const isPdf = f.type === 'application/pdf' || ext === '.pdf';

      if (isPdf) {
        // PDF files — extract content via /api/extract-pdf (or contract extract-pdf)
        setUploadedFiles((prev) => [...prev, {
          name: f.name,
          size: f.size,
          type: f.type,
          content: undefined,
          extracting: true,
        }]);
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(',')[1];
            const res = await fetch('/api/extract-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: f.name, base64 }),
            });
            const data = await res.json();
            setUploadedFiles((prev) => prev.map((uf) =>
              uf.name === f.name && uf.extracting
                ? { ...uf, content: data.text || '[Failed to extract PDF content]', extracting: false }
                : uf
            ));
          } catch (err) {
            console.error('PDF extraction failed:', err);
            setUploadedFiles((prev) => prev.map((uf) =>
              uf.name === f.name && uf.extracting
                ? { ...uf, content: '[Error extracting PDF]', extracting: false }
                : uf
            ));
          }
        };
        reader.readAsDataURL(f);
      } else if (isTextReadable) {
        // Read text content via FileReader
        const reader = new FileReader();
        reader.onload = () => {
          const content = reader.result as string;
          setUploadedFiles((prev) => [...prev, {
            name: f.name,
            size: f.size,
            type: f.type,
            content: content.slice(0, 50000), // Cap at 50k chars
          }]);
        };
        reader.onerror = () => {
          // Still add the file even if reading fails
          setUploadedFiles((prev) => [...prev, { name: f.name, size: f.size, type: f.type }]);
        };
        reader.readAsText(f);
      } else {
        // Non-text files — store metadata only
        setUploadedFiles((prev) => [...prev, { name: f.name, size: f.size, type: f.type }]);
      }
    });
  }

  function removeFile(index: number) {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Reset to start
  function handleStartOver() {
    setStep('input');
    setGeneratedSpec('');
    setQuestions([]);
    setAnswers({});
  }

  // Toggle category section
  function toggleCategory(key: string) {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/precon"
          className="p-2 rounded-lg hover:bg-[#222] transition-colors"
          style={{ color: '#8a8078' }}
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1
            className="text-xl font-bold"
            style={{ fontFamily: 'Georgia, serif', color: '#c88c00' }}
          >
            Spec Writer
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#8a8078' }}>
            Generate contract &amp; change order specifications
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg p-1" style={{ background: '#111' }}>
        <div
          className="flex-1 text-center py-2 px-4 rounded-md text-sm font-medium cursor-default"
          style={{ background: '#ffffff', color: '#c88c00', border: '1px solid rgba(201,168,76,0.3)' }}
        >
          Quick Specs
        </div>
        <Link
          href="/dashboard/spec-writer/contract"
          className="flex-1 text-center py-2 px-4 rounded-md text-sm font-medium transition-colors hover:bg-[#ffffff]"
          style={{ color: '#8a8078' }}
        >
          Contract
        </Link>
      </div>

      {/* ============================================ */}
      {/* INPUT STEP */}
      {/* ============================================ */}
      {step === 'input' && (
        <div className="space-y-4">
          {/* Text Input */}
          <div
            className="rounded-lg p-4"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
          >
            <label className="block text-sm font-semibold mb-2" style={{ color: '#1a1a1a' }}>
              Describe the Project Scope
            </label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={6}
              placeholder="We are building a detached kitchen addition. Plumbing will be tied into the septic system through the exterior. Horizontal siding, asphalt roofing, hardwood flooring..."
              className="w-full rounded-lg px-3 py-3 text-sm resize-none"
              style={{
                background: '#0d0d0d',
                color: '#1a1a1a',
                border: '1px solid rgba(200,140,0,0.2)',
                lineHeight: '1.6',
              }}
            />
            <p className="text-xs mt-2" style={{ color: '#8a8078' }}>
              Include materials, finishes, fixtures, and any specific details. The more you describe, the better the specification.
            </p>
          </div>

          {/* File Upload */}
          <div
            className="rounded-lg p-4"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
          >
            <label className="block text-sm font-semibold mb-2" style={{ color: '#1a1a1a' }}>
              Attachments
              <span className="font-normal ml-2" style={{ color: '#8a8078' }}>(optional)</span>
            </label>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.xls,.xlsx,.jpg,.png"
              onChange={handleFileUpload}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-lg px-4 py-6 text-sm flex flex-col items-center gap-2 transition-colors hover:bg-[#151515]"
              style={{
                background: '#0d0d0d',
                border: '1px dashed rgba(200,140,0,0.25)',
                color: '#8a8078',
              }}
            >
              <Upload size={20} style={{ color: '#c88c00' }} />
              <span>Click to upload plans, estimates, or notes</span>
              <span className="text-xs" style={{ color: '#666' }}>PDF, Word, Excel, Images</span>
            </button>

            {/* Uploaded file chips */}
            {uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {uploadedFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
                    style={{ background: '#0d0d0d', border: '1px solid rgba(200,140,0,0.15)', color: '#d4ccc4' }}
                  >
                    {f.extracting ? (
                      <Loader2 size={10} className="animate-spin" style={{ color: '#c88c00' }} />
                    ) : (
                      <Paperclip size={10} style={{ color: f.content ? '#c88c00' : '#666' }} />
                    )}
                    <span>{f.name}</span>
                    {f.extracting ? (
                      <span style={{ color: '#c88c00' }}>Extracting...</span>
                    ) : (
                      <span style={{ color: '#8a8078' }}>({formatSize(f.size)}){f.content ? ' ✓' : ''}</span>
                    )}
                    <button
                      onClick={() => removeFile(i)}
                      className="ml-1 hover:text-red-400 transition-colors"
                      style={{ color: '#8a8078' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mode Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleQuickSpec}
              disabled={!inputText.trim() || loading || uploadedFiles.some(f => f.extracting)}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
              style={{ background: '#c88c00', color: '#0d0d0d' }}
            >
              {loading && specMode === 'quick' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Zap size={16} />
              )}
              {uploadedFiles.some(f => f.extracting) ? 'Extracting PDF...' : 'Quick Spec'}
            </button>
            <button
              onClick={handleDetailedSpec}
              disabled={!inputText.trim() || loading || isGeneratingQuestions || uploadedFiles.some(f => f.extracting)}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
              style={{
                background: 'rgba(201,168,76,0.15)',
                color: '#c88c00',
                border: '1px solid rgba(201,168,76,0.3)',
              }}
            >
              {(loading && specMode === 'detailed') || isGeneratingQuestions ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Search size={16} />
              )}
              {isGeneratingQuestions ? 'Analyzing...' : 'Detailed Spec'}
            </button>
          </div>

          <div
            className="rounded-lg px-4 py-3 text-xs flex items-start gap-2"
            style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)', color: '#8a8078' }}
          >
            <FileText size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#c88c00' }} />
            <div>
              <strong style={{ color: '#c88c00' }}>Quick Spec</strong> generates immediately from your description.{' '}
              <strong style={{ color: '#c88c00' }}>Detailed Spec</strong> asks follow-up questions about materials, brands, and finishes before generating.
            </div>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* QUESTIONS STEP (Detailed mode) */}
      {/* ============================================ */}
      {step === 'questions' && (
        <div className="space-y-4">
          {/* Info bar */}
          <div
            className="rounded-lg px-4 py-3 text-xs flex items-center gap-2"
            style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)', color: '#c88c00' }}
          >
            <PenTool size={14} />
            Answer these questions to refine the specification. Select an option or type your own.
          </div>

          {/* Questions grouped by category */}
          {Object.entries(questionsByCategory).map(([catKey, catQuestions]) => (
            <div
              key={catKey}
              className="rounded-lg overflow-hidden"
              style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
            >
              <button
                onClick={() => toggleCategory(catKey)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-[#222] transition-colors"
              >
                {expandedCategories[catKey] ? (
                  <ChevronDown size={14} style={{ color: '#8a8078' }} />
                ) : (
                  <ChevronRight size={14} style={{ color: '#8a8078' }} />
                )}
                <span className="text-xs font-semibold" style={{ color: '#c88c00' }}>{catKey}</span>
                <span className="text-xs" style={{ color: '#8a8078' }}>
                  ({catQuestions.filter((q) => answers[q.id]).length}/{catQuestions.length} answered)
                </span>
              </button>

              {expandedCategories[catKey] && (
                <div className="px-4 pb-4 space-y-4" style={{ borderTop: '1px solid rgba(200,140,0,0.06)' }}>
                  {catQuestions.map((q) => (
                    <div key={q.id} className="pt-3">
                      <label className="block text-sm mb-2" style={{ color: '#1a1a1a' }}>
                        {q.question}
                      </label>
                      {/* Quick select pills */}
                      <div className="flex flex-wrap gap-2 mb-2">
                        {q.options.map((opt) => (
                          <button
                            key={opt}
                            onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                            className="px-3 py-1.5 rounded-full text-xs transition-colors"
                            style={{
                              background: answers[q.id] === opt ? 'rgba(201,168,76,0.2)' : '#0d0d0d',
                              color: answers[q.id] === opt ? '#c88c00' : '#d4ccc4',
                              border: `1px solid ${answers[q.id] === opt ? '#c88c00' : 'rgba(200,140,0,0.15)'}`,
                            }}
                          >
                            {answers[q.id] === opt && <Check size={10} className="inline mr-1" />}
                            {opt}
                          </button>
                        ))}
                      </div>
                      {/* Custom input */}
                      {q.allowCustom && (
                        <input
                          type="text"
                          placeholder="Or type your own..."
                          value={answers[q.id] && !q.options.includes(answers[q.id]) ? answers[q.id] : ''}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          className="w-full rounded-lg px-3 py-2 text-xs"
                          style={{
                            background: '#0d0d0d',
                            color: '#1a1a1a',
                            border: '1px solid rgba(200,140,0,0.15)',
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => setStep('input')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
              style={{ color: '#8a8078', border: '1px solid rgba(200,140,0,0.15)' }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              onClick={handleGenerateFromQuestions}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{ background: '#c88c00', color: '#0d0d0d' }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Generate Specification
            </button>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* OUTPUT STEP */}
      {/* ============================================ */}
      {step === 'output' && (
        <div className="space-y-4">
          {/* Mode badge */}
          <div className="flex items-center gap-2">
            <span
              className="px-2.5 py-1 rounded-full text-xs font-medium"
              style={{
                background: specMode === 'quick' ? 'rgba(201,168,76,0.15)' : 'rgba(59,130,246,0.15)',
                color: specMode === 'quick' ? '#c88c00' : '#3b82f6',
                border: `1px solid ${specMode === 'quick' ? 'rgba(201,168,76,0.3)' : 'rgba(59,130,246,0.3)'}`,
              }}
            >
              {specMode === 'quick' ? (
                <><Zap size={10} className="inline mr-1" />Quick Spec</>
              ) : (
                <><Search size={10} className="inline mr-1" />Detailed Spec</>
              )}
            </span>
          </div>

          {/* Spec output */}
          <div
            className="rounded-lg p-4"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
                Generated Specification
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
                  style={{
                    background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(201,168,76,0.1)',
                    color: copied ? '#22c55e' : '#c88c00',
                    border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : 'rgba(201,168,76,0.2)'}`,
                  }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
                  style={{
                    background: 'rgba(201,168,76,0.1)',
                    color: '#c88c00',
                    border: '1px solid rgba(201,168,76,0.2)',
                  }}
                >
                  <Download size={12} />
                  Download
                </button>
              </div>
            </div>

            {/* Formatted spec display */}
            <pre
              className="rounded-lg p-4 text-xs overflow-x-auto whitespace-pre-wrap"
              style={{
                background: '#0d0d0d',
                color: '#d4ccc4',
                border: '1px solid rgba(200,140,0,0.08)',
                lineHeight: '1.7',
                fontFamily: '"SF Mono", "Fira Code", "Fira Mono", Menlo, monospace',
              }}
            >
              {generatedSpec}
            </pre>
          </div>

          {/* Actions */}
          <div className="flex justify-between">
            <button
              onClick={handleStartOver}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
              style={{ color: '#8a8078', border: '1px solid rgba(200,140,0,0.15)' }}
            >
              <RefreshCw size={14} /> Start Over
            </button>
            {specMode === 'quick' && (
              <button
                onClick={() => handleDetailedSpec()}
                disabled={isGeneratingQuestions}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{
                  background: 'rgba(201,168,76,0.15)',
                  color: '#c88c00',
                  border: '1px solid rgba(201,168,76,0.3)',
                }}
              >
                {isGeneratingQuestions ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Refine with Details
              </button>
            )}
            {specMode === 'detailed' && (
              <button
                onClick={() => setStep('questions')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: 'rgba(201,168,76,0.15)',
                  color: '#c88c00',
                  border: '1px solid rgba(201,168,76,0.3)',
                }}
              >
                <ArrowLeft size={14} /> Edit Answers
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {(loading || isGeneratingQuestions) && (
        <div
          className="fixed bottom-4 right-4 rounded-lg px-4 py-3 flex items-center gap-3 shadow-lg"
          style={{ background: '#ffffff', border: '1px solid rgba(201,168,76,0.3)', zIndex: 50 }}
        >
          <Loader2 size={16} className="animate-spin" style={{ color: '#c88c00' }} />
          <span className="text-sm" style={{ color: '#c88c00' }}>
            {isGeneratingQuestions ? 'AI is analyzing your project...' : 'Generating specification...'}
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Default export
// ============================================================
export default function SpecWriterPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto p-8 text-center">
          <Loader2 size={24} className="animate-spin mx-auto" style={{ color: '#c88c00' }} />
          <p className="text-sm mt-2" style={{ color: '#8a8078' }}>
            Loading Spec Writer...
          </p>
        </div>
      }
    >
      <SpecWriterContent />
    </Suspense>
  );
}
