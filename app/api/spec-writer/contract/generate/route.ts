import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { BKB_CONTRACT_SPEC_SYSTEM_PROMPT } from '../../../../lib/bkb-spec-guide';

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

interface RequestBody {
  categoryName: string;
  sectionName: string;
  costGroupName: string;
  projectScope: string;
  questionsAndAnswers: QuestionAnswer[];
  costItems: CostItemInfo[];
  files?: FileInfo[];
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const {
      categoryName,
      sectionName,
      costGroupName,
      projectScope,
      questionsAndAnswers,
      costItems,
      files,
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
    userMessage += `CATEGORY: ${categoryName}\n\n`;

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
