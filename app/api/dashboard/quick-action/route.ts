import { NextRequest, NextResponse } from 'next/server';
import { createGmailDraft } from '@/app/lib/google-api';

/**
 * POST /api/dashboard/quick-action
 *
 * Handles "Do Now" quick actions that need server-side processing.
 * Currently supports:
 * - draft-email: Creates a Gmail draft and returns the URL to open it
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { actionType, to, subject, body: emailBody } = body;

    if (actionType === 'draft-email') {
      if (!to || !subject || !emailBody) {
        return NextResponse.json({ error: 'to, subject, and body are required' }, { status: 400 });
      }

      const result = await createGmailDraft({ to, subject, body: emailBody });
      if (!result) {
        return NextResponse.json({ error: 'Failed to create draft' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        draftId: result.draftId,
        gmailUrl: result.gmailUrl,
        message: `Draft created — open Gmail to review and send`,
      });
    }

    return NextResponse.json({ error: `Unknown actionType: ${actionType}` }, { status: 400 });
  } catch (err: any) {
    console.error('[QuickAction] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
