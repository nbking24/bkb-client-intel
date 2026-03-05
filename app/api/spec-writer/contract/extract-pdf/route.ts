import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileName, base64 } = body;

    if (!base64) {
      return NextResponse.json({ error: 'No file data provided' }, { status: 400 });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64, 'base64');

    // Dynamic import of pdf-parse
    const pdfParseModule = await import('pdf-parse');
    const pdfParse = (pdfParseModule as any).default || pdfParseModule;
    const data = await pdfParse(buffer);

    // Return extracted text (limit to prevent massive payloads)
    const text = data.text || '';
    const truncated = text.slice(0, 100000); // ~25k words max

    return NextResponse.json({
      text: truncated,
      pages: data.numpages,
      fileName,
      truncated: text.length > 100000,
    });
  } catch (err: any) {
    console.error('PDF extraction error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to extract text from PDF' },
      { status: 500 }
    );
  }
}
