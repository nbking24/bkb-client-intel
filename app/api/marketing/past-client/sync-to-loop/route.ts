// @ts-nocheck
/**
 * POST /api/marketing/past-client/sync-to-loop
 *
 * Upserts past-client-outreach contacts into Loop/GHL so every contact we
 * send to is linked back to a Loop contact record for long-term CRM
 * tracking. Links are stored on past_client_outreach.ghl_contact_id.
 *
 * Targets rows where ghl_contact_id is null. Skips rows without any
 * contactable fields (phone + email both missing).
 *
 * Tagging:
 *   - All synced rows get the campaign tag (default: past-client-review-2026)
 *   - Rows with priority < 50 (FRIEND/SUB) also get a referral-source tag
 *     (default: friend-referral)
 *
 * Body (all optional):
 *   {
 *     only_priority?: number,   // sync only rows with this exact priority (10 = FRIEND/SUB)
 *     only_missing_ghl?: boolean,   // default true; false to re-sync all
 *     campaign_tag?: string,    // default 'past-client-review-2026'
 *     friend_tag?: string,      // default 'friend-referral'
 *     dry_run?: boolean,        // parse + plan, don't call GHL
 *     limit?: number,           // cap rows processed (default 500)
 *   }
 *
 * Auth: x-agent-token OR Bearer
 * Response: { processed, created, updated, skipped, errors: [{contact_key, error}] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { getSupabase } from '../../../lib/supabase';
import { upsertContact } from '../../../lib/ghl';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const onlyPriority = body.only_priority;
  const onlyMissingGhl = body.only_missing_ghl !== false;
  const campaignTag = body.campaign_tag || 'past-client-review-2026';
  const friendTag = body.friend_tag || 'friend-referral';
  const dryRun = !!body.dry_run;
  const limit = Math.min(Number(body.limit) || 500, 1000);

  const supabase = getSupabase();

  let query = supabase
    .from('past_client_outreach')
    .select('id, contact_key, ghl_contact_id, first_name, last_name, full_name, phone, phone_digits, email, priority, stage')
    .not('stage', 'eq', 'skipped') // don't sync rows we explicitly skipped
    .limit(limit);

  if (onlyMissingGhl) query = query.is('ghl_contact_id', null);
  if (typeof onlyPriority === 'number') query = query.eq('priority', onlyPriority);

  const { data: rows, error } = await query;
  if (error) {
    console.error('[pco/sync-to-loop] select failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [] as Array<{ contact_key: string; error: string }>,
    dry_run_plan: dryRun ? [] as any[] : undefined,
  };

  for (const row of rows || []) {
    results.processed++;

    if (!row.phone && !row.email) {
      results.skipped++;
      results.errors.push({ contact_key: row.contact_key, error: 'no phone or email' });
      continue;
    }

    const tags = [campaignTag];
    if (typeof row.priority === 'number' && row.priority < 50) {
      tags.push(friendTag);
    }

    const payload: any = {
      firstName: row.first_name || undefined,
      lastName: row.last_name || undefined,
      name: row.full_name || undefined,
      phone: row.phone || (row.phone_digits ? `+1${row.phone_digits}` : undefined),
      email: row.email || undefined,
      tags,
      source: 'past_client_outreach_campaign',
    };

    if (dryRun) {
      (results.dry_run_plan as any[]).push({ contact_key: row.contact_key, payload });
      continue;
    }

    try {
      const { contact, isNew } = await upsertContact(payload);
      const ghlId = contact?.id;
      if (!ghlId) {
        results.errors.push({
          contact_key: row.contact_key,
          error: `no id in GHL response (shape: ${JSON.stringify(Object.keys(contact || {}))})`,
        });
        results.skipped++;
        continue;
      }
      // Persist the link. Two-step pattern with a separate post-write SELECT so we
      // can prove the value actually committed and is visible to subsequent reads.
      const updateResp = await supabase
        .from('past_client_outreach')
        .update({ ghl_contact_id: ghlId })
        .eq('contact_key', row.contact_key);

      if (updateResp.error) {
        results.errors.push({
          contact_key: row.contact_key,
          error: `db update failed: ${updateResp.error.message} (ghl_id=${ghlId}, status=${updateResp.status})`,
        });
        results.skipped++;
        continue;
      }

      // Read it back with a FRESH query — proves the row truly carries the new value
      const { data: verifyRow, error: verifyErr } = await supabase
        .from('past_client_outreach')
        .select('contact_key, ghl_contact_id')
        .eq('contact_key', row.contact_key)
        .maybeSingle();

      if (verifyErr) {
        results.errors.push({
          contact_key: row.contact_key,
          error: `verify-read failed: ${verifyErr.message} (ghl_id=${ghlId})`,
        });
        results.skipped++;
        continue;
      }
      if (!verifyRow || verifyRow.ghl_contact_id !== ghlId) {
        results.errors.push({
          contact_key: row.contact_key,
          error: `WRITE NOT PERSISTED: update returned ${updateResp.status} but readback shows ghl=${verifyRow?.ghl_contact_id} (expected ${ghlId})`,
        });
        results.skipped++;
        continue;
      }
      if (isNew) results.created++;
      else results.updated++;

      // Log an event for audit
      await supabase.from('marketing_events').insert({
        agent: 'past_client_outreach',
        event_type: isNew ? 'loop_contact_created' : 'loop_contact_linked',
        entity_type: 'past_client_outreach',
        entity_id: row.id,
        outcome: 'success',
        detail: {
          contact_key: row.contact_key,
          ghl_contact_id: ghlId,
          tags,
        },
      });
    } catch (e: any) {
      console.error(`[pco/sync-to-loop] ${row.contact_key}:`, e.message);
      results.errors.push({ contact_key: row.contact_key, error: e.message });
      results.skipped++;
    }
  }

  return NextResponse.json(results);
}
