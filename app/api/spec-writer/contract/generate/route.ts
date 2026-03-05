import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { BKB_CONTRACT_SPEC_SYSTEM_PROMPT } from '../../../../lib/bkb-spec-guide';
import { getStandardSpecText } from '../../../../lib/bkb-standards';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface QuestionAnswer {
  id: string;
  question: string;
  answer: string;
}

interface CostItemInfo {
  name: string;
  description?: string;
  quantity?: number;
}

interface FileInfo {
  name: string;
  content: string;
  type: string;
}

interface PreviousSpec {
  categoryName: string;
  specification: string;
}

interface RequestBody {
  categoryName: string;
  categoryDescription?: string;
  sectionName: string;
  costGroupName: string;
  projectScope: string;
  questionsAndAnswers: QuestionAnswer[];
  costItems: CostItemInfo[];
  files?: FileInfo[];
  previousSpecs?: PreviousSpec[];
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const {
      categoryName,
      categoryDescription,
      sectionName,
      costGroupName,
      projectScope,
      questionsAndAnswers,
      costItems,
      files,
      previousSpecs,
    } = body;

    if (!categoryName || !projectScope) {
      return NextResponse.json(
        { error: 'categoryName and projectScope are required' },
        { status: 400 }
      );
    }

    // Build comprehensive user message
    let userMessage = `TASK: Write a construction contract specification for the following budget category.\n`;
    userMessage += `This specification will be placed in the "${costGroupName}" cost group description field.\n\n`;

    userMessage += `PROJECT SCOPE DESCRIPTION:\n${projectScope.trim()}\n\n`;

    userMessage += `BUDGET SECTION: ${sectionName}\n`;
    userMessage += `COST GROUP: ${costGroupName}\n`;
    userMessage += `CATEGORY: ${categoryName}\n`;
    if (categoryDescription && categoryDescription.trim()) {
      userMessage += `\nEXISTING SPECIFICATION NOTES FOR THIS CATEGORY:\n${categoryDescription.trim()}\n`;
      userMessage += `\nIMPORTANT: The above specification notes contain existing details already defined for this category. Incorporate and preserve ALL of these details in the generated specification. Do not contradict or omit any existing selections or notes.\n`;
    }
    userMessage += '\n';

    // Include BKB company standards for this category
    const standardsText = getStandardSpecText(costGroupName);
    if (standardsText) {
      userMessage += `BKB COMPANY STANDARD SPECIFICATIONS:\n${standardsText}\n`;
      userMessage += `IMPORTANT: Incorporate the above BKB company standards into the specification. These are the builder's established practices and must be reflected in the output.\n\n`;
    }

    userMessage += `COST ITEMS IN THIS CATEGORY:`;
    if (costItems && costItems.length > 0) {
      for (const item of costItems) {
        userMessage += `\n  - ${item.name}`;
        if (item.description) userMessage += ` : ${item.description}`;
        if (item.quantity) userMessage += ` (qty: ${item.quantity})`;
      }
    }
    userMessage += '\n';

    // Add Q&A answers
    if (questionsAndAnswers && questionsAndAnswers.length > 0) {
      userMessage += '\nSPECIFICATION DETAILS (from user answers):';
      for (const qa of questionsAndAnswers) {
        userMessage += `\n  Q: ${qa.question}`;
        userMessage += `\n  A: ${qa.answer || 'tbd'}`;
      }
      userMessage += '\n';
    }

    // Add uploaded file contents
    if (files && files.length > 0) {
      userMessage += '\nUPLOADED PROJECT FILES (vendor estimates, plans, etc.):';
      for (const file of files) {
        if (file.content && file.content.trim()) {
          userMessage += `\n\n--- ${file.name} ---\n${file.content.slice(0, 15000)}`;
        } else {
          userMessage += `\n\n--- ${file.name} (${file.type}) --- [content not available]`;
        }
      }
      userMessage += '\n';
    }

    // Include previously written specs for cross-spec awareness
    if (previousSpecs && previousSpecs.length > 0) {
      userMessage += `\n========================================\n`;
      userMessage += `PREVIOUSLY WRITTEN SPECIFICATIONS (already finalized for this contract):\n`;
      userMessage += `The following specifications have already been written for other categories in this same contract document. You MUST:\n`;
      userMessage += `1. NOT repeat information that is already stated in a previous specification (e.g., if permits are addressed in Planning/Admin, do NOT mention permits again in other specs)\n`;
      userMessage += `2. NOT contradict anything stated in a previous specification (e.g., if a previous spec says "Permit fees included", do NOT say "Permits not included" in this spec)\n`;
      userMessage += `3. Reference previous specs where relevant instead of restating (e.g., "See 01 Planning, Admin for permit details")\n`;
      userMessage += `4. Maintain consistency in material selections, finishes, and project assumptions across all specifications\n\n`;
      for (const prev of previousSpecs) {
        userMessage += `--- ${prev.categoryName} ---\n${prev.specification}\n\n`;
      }
      userMessage += `========================================\n`;
    }

    userMessage += `\nINSTRUCTIONS:
Write the specification for ONLY the "${costGroupName}" category. Follow BKB formatting exactly:
- Use single asterisks for bold: *Scope of Work* (never double **)
- Begin with a standard opener ("Provide and install...", "Remove and replace...", etc.)
- Include material specifications where known (Manufacturer, Product, Color, Finish)
- Mark unknown selections as "tbd"
- Include *Included:* section if there are multiple components
- Include *Clarifications:* section with applicable standard phrases
- Never mention subcontractor or vendor names
- Never use em dash characters
- Preserve vendor estimate technical language exactly (strip vendor names and pricing only)
- Be thorough and specific. This is a contractual document.

CROSS-SPECIFICATION RULES (CRITICAL):
- All specifications in this contract are part of ONE cohesive document. They must read as a unified whole.
- NEVER repeat information already covered in a previous specification. If permits, cleanup, protection, or general conditions are addressed elsewhere, do NOT restate them.
- NEVER contradict information in a previous specification. If a previous spec states permits are included or excluded, all other specs must be consistent with that statement.
- When something is already addressed in another specification, use a brief reference like "See [Category Name] specification" rather than restating.
- Focus THIS specification ONLY on what is unique to the "${costGroupName}" trade/scope.

Return ONLY the specification text. No JSON, no code fences, no explanations.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: BKB_CONTRACT_SPEC_SYSTEM_PROMPT,
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
    console.error('Contract generate API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
