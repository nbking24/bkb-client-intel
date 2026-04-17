// @ts-nocheck
/**
 * Review Concierge Agent
 *
 * The brain that decides who gets asked for a review, when, and on which trigger.
 * This runs:
 *   - On a nightly cron — scans JobTread for newly-completed jobs & design phases
 *   - On GHL webhook — fires when a contact moves into the Nurture pipeline
 *
 * It does NOT send the actual email/SMS — GHL does that. The Concierge's job is
 * to decide "yes, ask this client" and then hand off to GHL via the workflow trigger.
 */
import { getSupabase } from '../supabase';
import { checkReviewEligibility } from './review-dedup';
import { addContactToReviewWorkflow, ReviewTrigger } from './ghl-workflows';

export interface ConciergeTriggerInput {
  triggerType: ReviewTrigger;
  triggerSource: string;
  clientContactId: string;
  jobtreadJobId?: string;
  jobtreadAccountId?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  rawEventDetail?: any;
}

export interface ConciergeResult {
  status: 'queued' | 'skipped' | 'failed';
  reviewRequestId?: string;
  skipReason?: string;
  error?: string;
}

/**
 * Process a single candidate review request. Called one-at-a-time from the cron
 * scanner or webhook handler.
 */
export async function processReviewTrigger(
  input: ConciergeTriggerInput
): Promise<ConciergeResult> {
  const supabase = getSupabase();

  // 1. Dedup check — the hard guardrail
  const elig = await checkReviewEligibility(input.clientContactId);

  if (!elig.eligible) {
    // Record the skipped request so we have an audit trail
    const { data: skipRow } = await supabase
      .from('review_requests')
      .insert({
        client_contact_id: input.clientContactId,
        jobtread_job_id: input.jobtreadJobId,
        jobtread_account_id: input.jobtreadAccountId,
        client_name: input.clientName,
        client_email: input.clientEmail,
        client_phone: input.clientPhone,
        trigger_type: input.triggerType,
        trigger_source: input.triggerSource,
        trigger_detail: input.rawEventDetail,
        status: 'skipped',
        skipped_reason: elig.reason,
        review_left_status:
          elig.reason === 'already_reviewed' ? 'skipped_duplicate' : 'none',
      })
      .select('id')
      .single();

    await logEvent({
      agent: 'review_concierge',
      eventType: 'request_skipped',
      entityType: 'review_request',
      entityId: skipRow?.id,
      outcome: 'skipped',
      detail: {
        trigger: input.triggerType,
        reason: elig.reason,
        existing_review: elig.existingReview || null,
      },
    });

    return { status: 'skipped', reviewRequestId: skipRow?.id, skipReason: elig.reason };
  }

  // 2. Queue the review request in our table
  const { data: rrRow, error: rrErr } = await supabase
    .from('review_requests')
    .insert({
      client_contact_id: input.clientContactId,
      jobtread_job_id: input.jobtreadJobId,
      jobtread_account_id: input.jobtreadAccountId,
      client_name: input.clientName,
      client_email: input.clientEmail,
      client_phone: input.clientPhone,
      trigger_type: input.triggerType,
      trigger_source: input.triggerSource,
      trigger_detail: input.rawEventDetail,
      status: 'queued',
    })
    .select('id')
    .single();

  if (rrErr || !rrRow) {
    return { status: 'failed', error: rrErr?.message || 'insert failed' };
  }

  // 3. Hand off to Loop — add the review-request tag on the contact.
  //    The matching Loop automation workflow fires on tag-added.
  const ghl = await addContactToReviewWorkflow(
    input.clientContactId,
    input.triggerType
  );

  if (!ghl.success) {
    await supabase
      .from('review_requests')
      .update({
        status: 'failed',
        outcome_notes: ghl.error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rrRow.id);

    await logEvent({
      agent: 'review_concierge',
      eventType: 'tag_add_failed',
      entityType: 'review_request',
      entityId: rrRow.id,
      outcome: 'failed',
      detail: { trigger: input.triggerType, tag: ghl.tag, error: ghl.error },
    });

    return { status: 'failed', reviewRequestId: rrRow.id, error: ghl.error };
  }

  // 4. Mark as sent and log (sent = "handoff to Loop complete")
  await supabase
    .from('review_requests')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      ghl_workflow_id: ghl.tag, // column reused to store the handoff tag name
      updated_at: new Date().toISOString(),
    })
    .eq('id', rrRow.id);

  await logEvent({
    agent: 'review_concierge',
    eventType: 'tag_added_handoff',
    entityType: 'review_request',
    entityId: rrRow.id,
    outcome: 'success',
    detail: {
      trigger: input.triggerType,
      tag: ghl.tag,
      contact_id: input.clientContactId,
    },
  });

  return { status: 'queued', reviewRequestId: rrRow.id };
}

/**
 * Small helper so every agent uses the same shape when writing to marketing_events.
 */
export async function logEvent(evt: {
  agent: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  outcome?: string;
  detail?: any;
}) {
  const supabase = getSupabase();
  await supabase.from('marketing_events').insert({
    agent: evt.agent,
    event_type: evt.eventType,
    entity_type: evt.entityType,
    entity_id: evt.entityId,
    outcome: evt.outcome,
    detail: evt.detail || {},
  });
}
