import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { createContactNote } from '../lib/ghl';

const MAX_NOTE = 64000;

function splitTranscript(text: string, meetingType: string, meetingDate: string | null): string[] {
  const dateStr = meetingDate || new Date().toLocaleDateString('en-US');
  if (text.length <= MAX_NOTE) {
    const header = '--- ' + meetingType + ' | ' + dateStr + ' ---\n\n';
    return [header + text];
  }
  const parts: string[] = [];
  let remaining = text;
  let partNum = 1;
  const totalParts = Math.ceil(text.length / MAX_NOTE);
  while (remaining.length > 0) {
    const header = '--- ' + meetingType + ' | ' + dateStr + ' | Part ' + partNum + ' of ' + totalParts + ' ---\n\n';
    const maxContent = MAX_NOTE - header.length;
    let chunk = remaining.slice(0, maxContent);
    if (remaining.length > maxContent) {
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline > maxContent * 0.5) {
        chunk = chunk.slice(0, lastNewline);
      }
    }
    parts.push(header + chunk);
    remaining = remaining.slice(chunk.length);
    partNum++;
  }
  return parts;
}

export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { contactId, transcript, meetingType, meetingDate } = await req.json();
    if (!contactId || !transcript?.trim()) {
      return NextResponse.json({ error: 'Missing contactId or transcript' }, { status: 400 });
    }
    const parts = splitTranscript(transcript.trim(), meetingType || 'Meeting', meetingDate);
    for (const part of parts) {
      await createContactNote(contactId, part);
    }
    return NextResponse.json({ success: true, partsCreated: parts.length });
  } catch (err) {
    console.error('Notes upload error:', err);
    return NextResponse.json({ error: 'Failed to save notes' }, { status: 500 });
  }
}
