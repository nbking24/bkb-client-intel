// @ts-nocheck
/**
 * POST /api/dashboard/bill-review/[id]/billable
 *
 * Body: { kind: "subs" | "materials", note?: string }
 *
 * Tag a bill line as billable to the client: link it to the job's
 * "Billable Items" budget line, 2302 Billable Subs or 2303 Billable
 * Materials, so it shows under Billables to bill and is invoiced later.
 *
 *   1. Load the queue row (pending, failed or flagged).
 *   2. Find the job's Billable Items line for `kind`; if the job has no
 *      Billable Items group (or not that line), create it in JobTread from
 *      the BKB catalog items.
 *   3. Relink the bill line to it, adding the optional note to the bill
 *      line's description as "Billable: <note>", then read it back to make
 *      sure JobTread took the change.
 *   4. Mark the row applied and billable.
 *
 * Unlike Approve, this does NOT record a vendor pattern: billable is a one
 * off for that job, so it must not teach the matcher (Nathan, 2026-11-19).
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '../../../../lib/supabase';
import { resolveActorName } from '@/app/lib/actor-name';
import { pave, updateDocumentCostItem } from '@/app/lib/jobtread';
import { getOrCreateBillableLine } from '@/app/lib/bill-billable';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_NOTE = 500;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const id = params.id;
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const kind = body.kind === 'materials' ? 'materials' : body.kind === 'subs' ? 'subs' : null;
  if (!kind) return NextResponse.json({ error: 'kind must be "subs" or "materials"' }, { status: 400 });
  const note = String(body.note || '').trim().slice(0, MAX_NOTE);

  const { data: row, error: loadErr } = await supabase.from('bill_review_queue').select('*').eq('id', id).maybeSingle();
  if (loadErr || !row) return NextResponse.json({ error: 'Queue row not found' }, { status: 404 });
  if (!['pending', 'failed', 'flagged'].includes(row.status)) {
    return NextResponse.json({ error: `Row is ${row.status}, not pending` }, { status: 409 });
  }

  // 2. The job's billable line (created if missing).
  let target;
  let created = null;
  try {
    const r = await getOrCreateBillableLine(row.job_id, kind);
    target = r.line;
    created = r.created;
  } catch (err: any) {
    return NextResponse.json({ error: 'Could not find or create the Billable Items line: ' + (err?.message || err) }, { status: 502 });
  }

  const actor = await resolveActorName(supabase, auth.userId);
  await supabase
    .from('bill_review_queue')
    .update({ status: 'approved', approved_job_cost_item_id: target.id, approved_by: actor, approved_at: new Date().toISOString() })
    .eq('id', id);

  // 3. Relink the bill line, with the note added to its description.
  try {
    let description: string | undefined;
    if (note) {
      const cur: any = await pave({ costItem: { $: { id: row.cost_item_id }, description: {} } });
      const existing = String(cur?.costItem?.description || '').trim();
      description = (existing ? existing + '\n\n' : '') + 'Billable: ' + note;
    }
    await updateDocumentCostItem(row.cost_item_id, {
      jobCostItemId: target.id,
      costCodeId: target.costCodeId || undefined,
      ...(description !== undefined ? { description } : {}),
    });
  } catch (err: any) {
    await supabase.from('bill_review_queue').update({ status: 'failed', last_error: err?.message || String(err) }).eq('id', id);
    return NextResponse.json({ error: 'JT update failed: ' + (err?.message || String(err)) }, { status: 502 });
  }

  // Read back: JobTread's update does not return the new link.
  try {
    const v: any = await pave({ costItem: { $: { id: row.cost_item_id }, jobCostItem: { id: {}, name: {} } } });
    const observed = v?.costItem?.jobCostItem?.id || null;
    if (observed !== target.id) {
      const msg = observed
        ? `JT did not accept the change. The bill line is still linked to "${v?.costItem?.jobCostItem?.name || observed}". The bill may be locked (paid or synced to QuickBooks).`
        : 'JT did not accept the change. The bill line came back with no budget item linked. The bill may be locked.';
      await supabase.from('bill_review_queue').update({ status: 'failed', last_error: msg }).eq('id', id);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  } catch (verifyErr: any) {
    console.error('[bill-review/billable] verify failed:', verifyErr?.message || verifyErr);
  }

  // 4. Applied and billable. No pattern is recorded on purpose.
  await supabase
    .from('bill_review_queue')
    .update({
      status: 'applied',
      applied_at: new Date().toISOString(),
      last_error: null,
      billable: true,
      billable_note: note || null,
    })
    .eq('id', id);

  return NextResponse.json({
    ok: true,
    appliedTo: { jobCostItemId: target.id, name: target.name, kind },
    created,
  });
}
