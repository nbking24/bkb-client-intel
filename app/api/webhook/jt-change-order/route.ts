// @ts-nocheck
/**
 * JobTread webhook (documentUpdated), organization scope.
 * URL: /api/webhook/jt-change-order?key=<JT_CO_WEBHOOK_KEY>
 *
 * When a Change Order document is approved or declined in JobTread, forward
 * ONE delivery to the DataX "Change Order Approval Tagger" agent, which tags
 * the budget group with a check or a cross and files it under
 * Post Pricing Changes > Approved / Declined.
 *
 * documentUpdated fires on every edit, so we re-read the document and only
 * forward when: type is customerOrder, the name contains "Change Order",
 * status is approved or denied, the job is open, and the document was closed
 * (approved or declined) in the last 15 minutes. That keeps later edits to an
 * already approved change order from re-running the agent.
 *
 * Manual re-send for one document (skips the 15 minute check):
 *   POST /api/webhook/jt-change-order?key=<JT_CO_WEBHOOK_KEY>&documentId=<id>
 *
 * Style: no em or en dashes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const DATAX_URL = () =>
  process.env.DATAX_CO_TAGGER_WEBHOOK_URL || 'https://datax.to/api/agent-webhook/48247ac8278279b437934cacc156c800';
// Low-risk endpoint: it only re-reads JobTread and forwards. The default key
// lets it work without a Vercel env change; set JT_CO_WEBHOOK_KEY to override.
const KEY = () => process.env.JT_CO_WEBHOOK_KEY || '147bfdca76042dd380e5be6483802693';
const WINDOW_MS = 15 * 60 * 1000;
const ID_RE = /^22[A-Za-z0-9]{10}$/;

/** Every JobTread-looking id anywhere in the payload, document-ish keys first. */
function candidateIds(body: any): string[] {
  const first: string[] = [];
  const rest: string[] = [];
  const walk = (v: any, key = '', depth = 0) => {
    if (depth > 8 || v == null) return;
    if (typeof v === 'string') {
      if (ID_RE.test(v)) (/document/i.test(key) || key === 'id' ? first : rest).push(v);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key, depth + 1));
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(body);
  return [...new Set([...first, ...rest])].slice(0, 6);
}

async function readDocument(id: string) {
  try {
    const r: any = await pave({
      document: {
        $: { id },
        id: {}, name: {}, number: {}, type: {}, status: {}, closedAt: {},
        job: { id: {}, name: {}, number: {}, closedOn: {} },
      },
    });
    const d = r?.document;
    return d && d.id ? d : null;
  } catch {
    return null;
  }
}

async function handle(body: any, forcedId?: string) {
  const ids = forcedId ? [forcedId] : candidateIds(body);
  let doc: any = null;
  for (const id of ids) {
    doc = await readDocument(id);
    if (doc) break;
  }
  if (!doc) return { ok: true, skipped: 'no document in payload', ids };

  const why =
    doc.type !== 'customerOrder' ? 'not a customer order' :
    !/change order/i.test(doc.name || '') ? 'not a change order' :
    !['approved', 'denied'].includes(doc.status) ? `status ${doc.status}` :
    doc.job?.closedOn ? 'job closed' :
    !forcedId && (!doc.closedAt || Date.now() - new Date(doc.closedAt).getTime() > WINDOW_MS) ? 'not newly approved or declined' :
    '';
  if (why) return { ok: true, skipped: why, document: doc.id, number: doc.number };

  const delivery = {
    jobId: doc.job.id,
    jobName: `${doc.job.name} #${doc.job.number}`,
    documentId: doc.id,
    documentName: `${doc.name} #${doc.number}`,
    status: doc.status,
  };
  try {
    const r = await fetch(DATAX_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(delivery),
      cache: 'no-store',
    });
    return { ok: true, forwarded: r.status, delivery };
  } catch (e: any) {
    console.error('[jt-change-order] forward failed', e);
    return { ok: false, forwardError: String(e?.message || e).slice(0, 300), delivery };
  }
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') || '';
  if (!KEY() || key !== KEY()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const forced = req.nextUrl.searchParams.get('documentId') || undefined;
  const result = await handle(body, forced);
  console.log('[jt-change-order]', JSON.stringify(result));
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'JobTread change order approved or declined, forward to DataX CO tagger' });
}
