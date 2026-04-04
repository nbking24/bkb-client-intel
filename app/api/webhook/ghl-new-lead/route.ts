/**
 * GHL → JT Task Webhook for Web Form Submissions
 *
 * Called by a GHL workflow when a new contact/opportunity is created
 * from a website form submission. Creates a JT follow-up to-do task
 * assigned to Terri so she can initiate contact and schedule a
 * discovery call with Nathan.
 *
 * GHL workflow trigger: "Contact Created" or "Opportunity Created"
 * from web form source → calls this endpoint with contact data.
 *
 * Security: Protected by a shared secret in the X-Webhook-Secret header.
 */

import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';
const JT_ORG = '22P5SRwhLaYe';
const TERRI_USER_ID = '22P5SpJkzZSb';
const WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET || '';

// ── PAVE helper ──
async function pave(query: Record<string, unknown>) {
  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { $: { grantKey: JT_KEY() }, ...query } }),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PAVE ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// ── Create follow-up task in JT ──
async function createFollowupTask(
  leadName: string,
  phone: string,
  email: string,
  source: string,
  projectType: string
) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const descLines = [
    'New web form submission — awaiting initial contact and discovery call scheduling.',
    '',
    phone ? `Phone: ${phone}` : '',
    email ? `Email: ${email}` : '',
    source ? `Source: ${source}` : '',
    projectType ? `Project Type: ${projectType}` : '',
    '',
    'Action: Contact this lead and schedule a discovery call with Nathan.',
  ].filter(Boolean).join('\n');

  const taskData = await pave({
    createTask: {
      $: {
        name: `Contact ${leadName} - Schedule Discovery`.slice(0, 100),
        description: descLines,
        targetType: 'organization',
        targetId: JT_ORG,
        isToDo: true,
        endDate: tomorrow,
      },
      createdTask: { id: {}, name: {} },
    },
  });

  const taskId = taskData?.createTask?.createdTask?.id;
  if (!taskId) return null;

  // Assign to Terri
  try {
    await pave({
      createTaskAssignment: {
        $: { taskId, userId: TERRI_USER_ID },
      },
    });
  } catch (e: any) {
    console.warn('[ghl-new-lead] Could not assign task to Terri:', e.message);
  }

  return taskId;
}

// ── POST handler ──
export async function POST(request: NextRequest) {
  console.log('[ghl-new-lead] Incoming webhook');

  // Auth check
  if (WEBHOOK_SECRET) {
    const secret = request.headers.get('x-webhook-secret') || '';
    if (secret !== WEBHOOK_SECRET) {
      console.log('[ghl-new-lead] Auth FAILED');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: any;
  try {
    const rawBody = await request.text();
    console.log('[ghl-new-lead] Raw body:', rawBody.slice(0, 500));
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Extract contact info — GHL sends varying field naming conventions
  const firstName = body.firstName || body.first_name || body.contact?.firstName || '';
  const lastName = body.lastName || body.last_name || body.contact?.lastName || '';
  const email = body.email || body.contact?.email || '';
  const phone = body.phone || body.contact?.phone || '';
  const source = body.source || body.lead_source || body.utm_source || 'Web Form';
  const projectType = body.projectType || body.project_type || body.customField?.projectType || '';

  const fullName = `${firstName} ${lastName}`.trim();
  if (!fullName) {
    console.log('[ghl-new-lead] No name in payload — skipping task creation');
    return NextResponse.json({ success: false, reason: 'No name provided' }, { status: 400 });
  }

  console.log(`[ghl-new-lead] Processing: ${fullName} | ${phone} | ${email} | source=${source}`);

  try {
    const taskId = await createFollowupTask(fullName, phone, email, source, projectType);
    if (taskId) {
      console.log(`[ghl-new-lead] Created JT task ${taskId} for ${fullName}`);
      return NextResponse.json({ success: true, taskId, leadName: fullName });
    } else {
      console.warn('[ghl-new-lead] Task creation returned no ID');
      return NextResponse.json({ success: false, reason: 'Task creation returned no ID' }, { status: 500 });
    }
  } catch (err: any) {
    console.error('[ghl-new-lead] Error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'GHL New Lead → JT Task webhook',
    description: 'POST contact data to create a follow-up task in JobTread for Terri',
  });
}
