import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { BKB_CONTRACT_QUESTIONS_SYSTEM_PROMPT } from '../../../../lib/bkb-spec-guide';
import { getStandardsForPrompt, isFullyCoveredByStandards } from '../../../../lib/bkb-standards';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface FileInfo {
  name: string;
  content: string;
  type: string;
}

interface CostItemInfo {
  name: string;
  description?: string;
  quantity?: number;
}

interface RequestBody {
  categoryName: string;
  categoryDescription?: string;
  sectionName: string;
  costItems: CostItemInfo[];
  projectScope: string;
  files?: FileInfo[];
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { categoryName, categoryDescription, sectionName, costItems, projectScope, files } = body;

    if (!categoryName || !projectScope) {
      return NextResponse.json(
        { error: 'categoryName and projectScope are required' },
        { status: 400 }
      );
    }

    // Check if this category is fully covered by BKB standards (no questions needed)
    if (isFullyCoveredByStandards(categoryName)) {
      return NextResponse.json({
        questions: [],
        standardsApplied: true,
        message: `This category is covered by BKB standard specifications. No additional questions needed.`,
      });
    }

    // Get BKB standards context for this category
    const standardsContext = getStandardsForPrompt(categoryName);

    // Build user message with full context
    let userMessage = `PROJECT SCOPE DESCRIPTION:\n${projectScope.trim()}\n`;

    userMessage += `\nBUDGET SECTION: ${sectionName}`;
    userMessage += `\nCATEGORY: ${categoryName}`;
    if (categoryDescription && categoryDescription.trim()) {
      userMessage += `\nEXISTING CATEGORY SPECIFICATION NOTES:\n${categoryDescription.trim()}`;
    }

    // Include BKB standards so the AI knows what NOT to ask about
    if (standardsContext) {
      userMessage += `\n${standardsContext}`;
    }

    userMessage += `\nCOST ITEMS IN THIS CATEGORY:`;
    if (costItems && costItems.length > 0) {
      for (const item of costItems) {
        userMessage += `\n  - ${item.name}`;
        if (item.description) userMessage += ` : ${item.description}`;
        if (item.quantity) userMessage += ` (qty: ${item.quantity})`;
      }
    } else {
      userMessage += '\n  (no specific cost items listed)';
    }

    // Add uploaded file contents for context
    if (files && files.length > 0) {
      userMessage += '\n\nUPLOADED PROJECT FILES:';
      for (const file of files) {
        if (file.content && file.content.trim()) {
          userMessage += `\n\n--- ${file.name} ---\n${file.content.slice(0, 10000)}`;
        } else {
          userMessage += `\n\n--- ${file.name} (${file.type}) --- [content not available]`;
        }
      }
    }

    userMessage += `\n\nGenerate 2-5 targeted follow-up questions (NEVER more than 5) for writing a construction specification for ONLY the "${categoryName}" category. Each question must define a specific MATERIAL SELECTION, BUILDING TECHNIQUE, or SCOPE DETAIL that is not already clear from the cost items, project scope, or BKB standards above. Do NOT ask about permits, timeline, cleanup, protection, or administrative items. Return ONLY the JSON array.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: BKB_CONTRACT_QUESTIONS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from AI', fallback: true },
        { status: 500 }
      );
    }

    // Parse JSON response
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const questions = JSON.parse(jsonText);

    if (!Array.isArray(questions)) {
      return NextResponse.json(
        { error: 'AI returned invalid format', fallback: true },
        { status: 500 }
      );
    }

    const MAX_QUESTIONS_PER_CATEGORY = 5;

    const validated = questions
      .filter((q: any) => q.id && q.question && Array.isArray(q.options))
      .map((q: any) => ({
        id: String(q.id),
        question: String(q.question),
        options: q.options.map(String),
        allowCustom: q.allowCustom !== false,
      }))
      .slice(0, MAX_QUESTIONS_PER_CATEGORY); // Hard cap: never exceed 5 questions per category

    if (validated.length === 0) {
      return NextResponse.json(
        { error: 'AI generated no valid questions', fallback: true },
        { status: 500 }
      );
    }

    return NextResponse.json({ questions: validated });
  } catch (err: any) {
    console.error('Contract questions API error:', err);

    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Failed to parse AI response as JSON', fallback: true },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: err.message || 'Internal server error', fallback: true },
      { status: 500 }
    );
  }
}
