import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

const SYSTEM_PROMPT = `You are a construction specification writer for Brett King Builder (BKB), a high-end residential remodeling and custom home builder in Ohio. You write professional, client-facing specifications that will be pasted directly into construction contracts and change orders.

BKB uses a standardized category system:
${Object.entries(BKB_CATEGORIES).map(([num, name]) => `${num} - ${name}`).join('\n')}

FORMATTING RULES — follow these exactly:
1. Only include categories that are RELEVANT to this specific project. Do not include categories that have nothing to do with the scope.
2. Each category section MUST start with:
   [Category Number] [Category Name]
   **Scope of Work**
3. Under each "Scope of Work" header, list specification items as bullet points using "-" (dash followed by space).
4. Each bullet point should be a complete, descriptive sentence written for a homeowner client. Be thorough and specific.
5. Include 3-8 bullet points per category depending on complexity.
6. Use professional construction language but keep it understandable to a homeowner.
7. Where the user provided specific answers (brands, materials, finishes), use those exact specifications.
8. Where answers are "tbd" or not provided, write "tbd per owner selection" or provide standard language.
9. Sort sections by category number.
10. After all category sections, include a final "Clarifications" section with standard contract language.

WRITING STYLE:
- Be thorough and detailed. Each bullet should convey real specification information, not vague placeholders.
- Include installation methods, materials, standards, and what is included/excluded where appropriate.
- Reference "per plans and specifications" or "per architectural drawings" where applicable.
- Mention code compliance, manufacturer specifications, and industry standards where relevant.
- Include items like cleanup, protection of existing finishes, coordination with other trades.
- Write as if a subcontractor needs to understand the full scope AND a homeowner needs to understand what they're paying for.

Example of good detail level for a single bullet:
- Provide and install 5" white oak solid hardwood flooring, site-finished with two coats of Bona Mega ONE waterborne polyurethane in a satin sheen. All underlayment, transitions, reducer strips at doorways, and shoe mold included. Floor protection during remaining construction included.

Example of BAD (too thin) detail:
- Install hardwood flooring per plans.

VENDOR ESTIMATE / MATERIAL SPECIFICATION MODE (CRITICAL):
When the user provides a vendor estimate, invoice, or quote AND asks for a "material specification" or "material spec" or "material sign-off":
- DO NOT write a generic scope of work with "tbd per owner selection" — the selections are IN the document.
- EXTRACT the ACTUAL product names, colors, sizes, finishes, quantities, and setting materials from the uploaded document.
- Organize by area/location as listed in the estimate (e.g., Main Floor, Shower Walls, Shower Floor, Threshold).
- For each area, list: tile/material product name, color, size/format, quantity, and all setting materials (grout color, caulk, trim, waterproofing, etc.).
- NEVER mention the vendor or subcontractor name in the specification text.
- If the user says "material only," focus on material selections and quantities. Do NOT include labor/installation pricing.
- Include threshold and transition pieces if listed in the estimate.
- The output should be a clean material specification that a client can sign off on, organized by area.

Example of GOOD material spec from a vendor estimate:
17 Tile
**Material Specification — Bathroom**

*Main Floor*
- Tile: California-Slate, Caramel Beige, 12x24 porcelain
- Quantity: 82.74 sqft (13.79 sqft per carton)
- Grout: 25# UltraColor Powder Grout, Biscuit

*Shower Walls*
- Tile: Piazzo-Commune, Satin finish, 3x12
- Quantity: 184.11 sqft (9.69 sqft per carton)

Example of BAD material spec (ignoring the document):
- Provide and install tile on shower walls, material tbd per owner selection.

IMPORTANT: Return ONLY the specification text. No JSON, no markdown code fences, no explanations. Just the formatted specification ready to paste into a contract.`;

interface QuestionAnswer {
  id: string;
  category: string;
  categoryNum: string;
  question: string;
  answer: string;
}

interface RequestBody {
  projectDescription: string;
  mode: 'quick' | 'detailed';
  questionsAndAnswers?: QuestionAnswer[];
  files?: { name: string; content: string; type: string }[];
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { projectDescription, mode, questionsAndAnswers, files } = body;

    if (!projectDescription || projectDescription.trim().length === 0) {
      return NextResponse.json(
        { error: 'Project description is required' },
        { status: 400 }
      );
    }

    // Build user message
    let userMessage = `PROJECT DESCRIPTION:\n${projectDescription.trim()}\n`;

    // Add file contents if available
    if (files && files.length > 0) {
      userMessage += '\nUPLOADED PROJECT FILES:';
      for (const file of files) {
        if (file.content && file.content.trim()) {
          userMessage += `\n\n--- ${file.name} ---\n${file.content.slice(0, 30000)}`;
        } else {
          userMessage += `\n\n--- ${file.name} (${file.type}) --- [content not available]`;
        }
      }
      userMessage += '\n';
    }

    if (mode === 'detailed' && questionsAndAnswers && questionsAndAnswers.length > 0) {
      userMessage += '\nDETAILED SPECIFICATION ANSWERS:';
      // Group by category
      const byCategory: Record<string, QuestionAnswer[]> = {};
      for (const qa of questionsAndAnswers) {
        const key = `${qa.categoryNum} ${qa.category}`;
        if (!byCategory[key]) byCategory[key] = [];
        byCategory[key].push(qa);
      }
      for (const [cat, qas] of Object.entries(byCategory).sort()) {
        userMessage += `\n\n${cat}:`;
        for (const qa of qas) {
          userMessage += `\n  Q: ${qa.question}`;
          userMessage += `\n  A: ${qa.answer || 'tbd'}`;
        }
      }
      userMessage += '\n';
    }

    userMessage += `\nMODE: ${mode === 'detailed' ? 'Detailed specification — use all provided answers to write thorough specs. Where answers were given, incorporate them precisely.' : 'Quick specification — generate a thorough specification based on the project description alone. Use "tbd per owner selection" for items that require owner decisions on brands/materials/finishes.'}`;

    userMessage += '\n\nWrite the complete specification now, following the formatting rules exactly.';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from AI' },
        { status: 500 }
      );
    }

    return NextResponse.json({ specification: textBlock.text.trim() });
  } catch (err: any) {
    console.error('Spec writer generate API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
