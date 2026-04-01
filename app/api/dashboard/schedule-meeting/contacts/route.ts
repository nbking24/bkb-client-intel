// ============================================================
// Fetch JT contacts for a job and check GHL matching
//
// GET ?jobId=xxx
// Returns: JT contacts for the job's account + GHL match status for each
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getJob, pave } from '@/app/lib/jobtread';
import { searchContacts } from '@/app/lib/ghl';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId query parameter is required' },
        { status: 400 }
      );
    }

    // 1. Get the job to find the account ID
    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    const accountId = job.location?.account?.id;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Job has no associated account' },
        { status: 400 }
      );
    }

    // 2. Query JT for contacts on that account
    const data = await pave({
      contacts: {
        $: { filter: { accountId: { eq: accountId } }, first: 100 },
        nodes: {
          id: {},
          name: {},
          contactMethods: { nodes: { type: {}, value: {} } },
        },
      },
    });

    const jtContacts = (data as any)?.contacts?.nodes || [];

    // 3. For each JT contact, search GHL for a match
    const contacts = await Promise.all(
      jtContacts.map(async (jtContact: any) => {
        let ghlContactId: string | null = null;
        let email = '';
        let phone = '';

        // Extract email and phone from contact methods
        if (jtContact.contactMethods?.nodes) {
          for (const method of jtContact.contactMethods.nodes) {
            if (method.type === 'EMAIL') email = method.value;
            if (method.type === 'PHONE') phone = method.value;
          }
        }

        // Try to find matching GHL contact by name or email
        try {
          let ghlResults = [];
          if (email) {
            ghlResults = await searchContacts(email, 5);
          }
          if (ghlResults.length === 0 && jtContact.name) {
            ghlResults = await searchContacts(jtContact.name, 5);
          }
          if (ghlResults.length > 0) {
            ghlContactId = ghlResults[0].id;
          }
        } catch (err: any) {
          console.warn(
            `Failed to search GHL for JT contact ${jtContact.name}:`,
            err.message
          );
        }

        return {
          jtContactId: jtContact.id,
          name: jtContact.name || '',
          email,
          phone,
          ghlContactId,
          source: 'homeowner',
        };
      })
    );

    return NextResponse.json({
      success: true,
      contacts,
    });
  } catch (err: any) {
    console.error('Failed to fetch contacts:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch contacts' },
      { status: 500 }
    );
  }
}
