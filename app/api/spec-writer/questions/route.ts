import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// BKB 23-category trade system
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

const SYSTEM_PROMPT = `You are a construction specification assistant for Brett King Builder (BKB), a residential remodeling and custom home builder in Ohio.

BKB uses a standardized category system for organizing project specifications. Here are the categories:
${Object.entries(BKB_CATEGORIES).map(([num, name]) => `${num} - ${name}`).join('\n')}

Your job: Given a project description (and optionally uploaded file contents), generate targeted follow-up questions that will help write a detailed construction specification.

RULES:
1. Generate 5-15 questions, focused on the trades/categories that are RELEVANT to this specific project.
2. Do NOT generate questions for trades that clearly aren't part of the project scope.
3. Each question should help clarify materials, methods, brands, or scope for that trade.
4. Provide 3-5 practical answer options per question, plus the questions should always allow custom input.
5. Options should reflect common residential construction choices (brands, materials, methods typical in Ohio residential work).
6. Question IDs should be descriptive snake_case (e.g., "flooring_type", "cabinet_style").
7. Sort questions by category number.

You MUST respond with ONLY a valid JSON array. No markdown, no explanation, no code fences. Just the raw JSON array.

Each object in the array must have exactly these fields:
{
  "id": "string - unique snake_case identifier",
  "category": "string - category name from the list above",
  "categoryNum": "string - two-digit category number like '05'",
  "question": "string - the follow-up question to ask",
  "options": ["string array of 3-5 answer choices"],
  "allowCustom": true
}`;

interface FileInfo {
  name: string;
  content: string;
  type: string;
}

interface RequestBody {
  projectDescription: string;
  files?: FileInfo[];
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { projectDescription, files } = body;

    if (!projectDescription || projectDescription.trim().length === 0) {
      return NextResponse.json(
        { error: 'Project description is required', fallback: true },
        { status: 400 }
      );
    }

    // Build user message with project description + file contents
    let userMessage = `PROJECT DESCRIPTION:\n${projectDescription.trim()}`;

    if (files && files.length > 0) {
      userMessage += '\n\nUPLOADED FILES:';
      for (const file of files) {
        if (file.content && file.content.trim()) {
          userMessage += `\n\n--- ${file.name} ---\n${file.content.slice(0, 10000)}`; // Cap file content at 10k chars
        } else {
          userMessage += `\n\n--- ${file.name} (${file.type}) --- [file content not available]`;
        }
      }
    }

    userMessage += '\n\nGenerate follow-up questions for writing a detailed construction specification for this project. Return ONLY the JSON array.';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from AI', fallback: true },
        { status: 500 }
      );
    }

    // Parse the JSON response — strip any accidental markdown fences
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const questions = JSON.parse(jsonText);

    // Validate structure
    if (!Array.isArray(questions)) {
      return NextResponse.json(
        { error: 'AI returned invalid format', fallback: true },
        { status: 500 }
      );
    }

    // Ensure all questions have required fields
    const validated = questions
      .filter(
        (q: any) =>
          q.id && q.category && q.categoryNum && q.question && Array.isArray(q.options)
      )
      .map((q: any) => ({
        id: String(q.id),
        category: String(q.category),
        categoryNum: String(q.categoryNum),
        question: String(q.question),
        options: q.options.map(String),
        allowCustom: q.allowCustom !== false, // default to true
      }));

    if (validated.length === 0) {
      return NextResponse.json(
        { error: 'AI generated no valid questions', fallback: true },
        { status: 500 }
      );
    }

    return NextResponse.json({ questions: validated });
  } catch (err: any) {
    console.error('Spec writer questions API error:', err);

    // Check for JSON parse errors specifically
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
