// @ts-nocheck
/**
 * JobTread alert helpers for the Review Engine.
 *
 * Fires a task on BKB's "Admin Project" in JobTread when a gateway submission
 * comes in. Two task types:
 *   - Low-star (stars 1-4): assigned to Nathan + Terri to investigate and follow up.
 *   - Five-star: assigned to Terri to verify the Google review was posted and
 *     send the $25 Wawa gift card.
 *
 * All failures are swallowed so the public API stays responsive — a missing
 * JobTread task should never cause the submit endpoint to 500.
 */

import { createTask } from '../jobtread';

// JobTread IDs — sourced from the BKB organization. Admin Project is job #130.
const ADMIN_PROJECT_JOB_ID = '22P6NCjBeR8d';
const NATHAN_MEMBERSHIP_ID = '22P5SRwhLaYf';
const TERRI_MEMBERSHIP_ID = '22P5SpJkype2';

export interface AlertContext {
  contactId: string;
  stars: number;
  clientName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  reviewText?: string | null;
  submissionId: string;
  jobtreadJobId?: string | null;
}

function fmtClientLabel(ctx: AlertContext): string {
  const parts: string[] = [];
  if (ctx.clientName) parts.push(ctx.clientName);
  const contact: string[] = [];
  if (ctx.clientEmail) contact.push(ctx.clientEmail);
  if (ctx.clientPhone) contact.push(ctx.clientPhone);
  if (contact.length) parts.push(`(${contact.join(' / ')})`);
  return parts.length ? parts.join(' ') : `contact ${ctx.contactId}`;
}

function fmtJobLink(jobId?: string | null): string {
  return jobId ? `https://app.jobtread.com/jobs/${jobId}` : '(no JobTread job linked)';
}

/**
 * Low-star (< 5) submission — alert Nathan and Terri for hands-on follow-up.
 */
export async function createLowStarReviewTask(ctx: AlertContext): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  const clientLabel = fmtClientLabel(ctx);
  const taskName = `Low-star review from ${ctx.clientName || 'client'} (${ctx.stars}/5) — follow up`;

  const description = [
    `A client just submitted a ${ctx.stars}-star review through the BKB gateway.`,
    ``,
    `Client: ${clientLabel}`,
    `Stars: ${ctx.stars} / 5`,
    `Linked JobTread job: ${fmtJobLink(ctx.jobtreadJobId)}`,
    `Submission ID: ${ctx.submissionId}`,
    ``,
    `Feedback they shared:`,
    ctx.reviewText?.trim() || '(no written feedback)',
    ``,
    `Next steps:`,
    `- Read through the full response in the Client Hub Reviews dashboard.`,
    `- Decide who on the team will reach out and by when.`,
    `- Document the follow-up plan and close the loop with the client.`,
  ].join('\n');

  try {
    const result = await createTask({
      jobId: ADMIN_PROJECT_JOB_ID,
      name: taskName,
      description,
      assignedMembershipIds: [NATHAN_MEMBERSHIP_ID, TERRI_MEMBERSHIP_ID],
    });
    return { ok: true, taskId: result.id };
  } catch (err: any) {
    console.error('[jobtread-alerts] low-star task creation failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Five-star submission — kick off the $25 Wawa gift card process.
 * The task asks Terri to verify on Google first, then send the gift card.
 */
export async function createFiveStarGiftCardTask(ctx: AlertContext): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  const clientLabel = fmtClientLabel(ctx);
  const taskName = `Verify ${ctx.clientName || 'client'}'s Google review and send $25 Wawa gift card`;

  const description = [
    `A client just submitted a 5-star review through the BKB gateway and was sent to Google.`,
    ``,
    `Client: ${clientLabel}`,
    `Linked JobTread job: ${fmtJobLink(ctx.jobtreadJobId)}`,
    `Submission ID: ${ctx.submissionId}`,
    ``,
    `What they wrote (what to look for on Google):`,
    ctx.reviewText?.trim() || '(no written response)',
    ``,
    `Steps:`,
    `- Check Google Business Profile for the new review from this client.`,
    `- Once confirmed, send a $25 Wawa gift card to the client.`,
    `- Mark this task complete with the date sent.`,
    `- If the review does not appear within 7 days, mark this task complete and note the client did not post.`,
  ].join('\n');

  try {
    const result = await createTask({
      jobId: ADMIN_PROJECT_JOB_ID,
      name: taskName,
      description,
      assignedMembershipIds: [TERRI_MEMBERSHIP_ID],
    });
    return { ok: true, taskId: result.id };
  } catch (err: any) {
    console.error('[jobtread-alerts] 5-star gift-card task creation failed:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}
