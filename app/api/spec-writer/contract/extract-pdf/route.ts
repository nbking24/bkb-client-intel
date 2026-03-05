import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileName, base64 } = body;

    if (!base64) {
      return NextResponse.json({ error: 'No file data provided' }, { status: 400 });
    }

    // Convert base64 to buffer for text extraction
    const buffer = Buffer.from(base64, 'base64');

    // Step 1: Extract text using pdf-parse
    let textContent = '';
    let pageCount = 0;
    try {
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = (pdfParseModule as any).default || pdfParseModule;
      const data = await pdfParse(buffer);
      textContent = (data.text || '').slice(0, 100000);
      pageCount = data.numpages || 0;
    } catch (textErr) {
      console.error('PDF text extraction failed, continuing with vision analysis:', textErr);
    }

    // Step 2: Use Claude's vision to analyze the PDF for images, drawings, diagrams
    // Claude's API accepts PDFs directly as document content blocks
    let visionAnalysis = '';
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64,
                },
              },
              {
                type: 'text',
                text: `You are analyzing a construction project document for a residential builder (Brett King Builder).

Carefully examine ALL pages of this PDF, paying special attention to:
- Architectural drawings, floor plans, and elevations (describe room layouts, dimensions, structural elements)
- Material specifications called out in drawings or images
- Fixture and finish schedules shown in tables or images
- Engineering details, structural notes, or code references
- Photos of existing conditions or inspiration images
- Any dimensions, measurements, or quantities shown graphically

For each visual element you find, provide a detailed description that would help a spec writer create accurate construction specifications. Include specific measurements, materials, product names, and technical details whenever visible.

If the document is purely text with no meaningful visual content, just respond with: "NO_VISUAL_CONTENT"

Format your response as a clear summary organized by what you see on each page.`,
              },
            ],
          },
        ],
      });

      const analysisText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      if (analysisText && !analysisText.includes('NO_VISUAL_CONTENT')) {
        visionAnalysis = analysisText;
      }
    } catch (visionErr: any) {
      console.error('PDF vision analysis failed:', visionErr.message);
      // Continue without vision - text extraction alone is still valuable
    }

    // Combine text extraction + vision analysis
    let combinedContent = '';
    if (textContent.trim()) {
      combinedContent += textContent.trim();
    }
    if (visionAnalysis.trim()) {
      combinedContent += '\n\n--- VISUAL CONTENT ANALYSIS ---\n';
      combinedContent += visionAnalysis.trim();
    }

    return NextResponse.json({
      text: combinedContent,
      pages: pageCount,
      fileName,
      hasVisualAnalysis: !!visionAnalysis,
      truncated: textContent.length >= 100000,
    });
  } catch (err: any) {
    console.error('PDF extraction error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to extract text from PDF' },
      { status: 500 }
    );
  }
}
