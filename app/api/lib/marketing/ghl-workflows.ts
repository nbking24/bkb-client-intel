// @ts-nocheck
/**
 * Loop / GHL handoff — tag-based workflow triggering.
 *
 * Instead of firing workflows by ID, we add a tag to the GHL contact. The
 * corresponding Loop Automation workflow listens for that tag being added
 * and takes over from there (survey, branch on stars, send review links).
 *
 * This keeps the Client Hub decoupled from Loop workflow IDs — Nathan or
 * Terri can rebuild the Loop workflows without changing our code.
 *
 * Tag convention:
 *   completion   → send-review-request-completion
 *   nurture      → send-review-request-nurture
 *   post_design  → send-review-request-post-design
 *   annual       → send-review-request-annual
 *
 * Env required:
 *  - GHL_API_KEY
 *  - GHL_LOCATION_ID
 *
 * (Workflow IDs are NO LONGER needed in env — the tag is the handoff.)
 */
const GHL_BASE = 'https://services.leadconnectorhq.com';

function headers() {
  return {
    Authorization: 'Bearer ' + (process.env.GHL_API_KEY || ''),
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

export type ReviewTrigger = 'completion' | 'nurture' | 'post_design' | 'annual';

export function tagForTrigger(trigger: ReviewTrigger): string {
  return `send-review-request-${trigger.replace('_', '-')}`;
}

/**
 * Add the review-request tag to a GHL contact. The matching Loop workflow
 * listens for this tag and fires the actual survey + review request send.
 */
export async function addContactToReviewWorkflow(
  contactId: string,
  trigger: ReviewTrigger
): Promise<{ success: boolean; tag?: string; error?: string }> {
  const tag = tagForTrigger(trigger);
  try {
    const url = `${GHL_BASE}/contacts/${contactId}/tags`;
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ tags: [tag] }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        success: false,
        tag,
        error: `GHL add-tag failed: ${res.status} ${body}`,
      };
    }
    return { success: true, tag };
  } catch (err: any) {
    return {
      success: false,
      tag,
      error: err?.message || 'unknown error',
    };
  }
}

/**
 * Remove a review-request tag (cleanup after workflow completes, to allow
 * future re-triggering of the same trigger type if needed).
 */
export async function removeReviewTagFromContact(
  contactId: string,
  trigger: ReviewTrigger
): Promise<{ success: boolean; tag?: string; error?: string }> {
  const tag = tagForTrigger(trigger);
  try {
    const url = `${GHL_BASE}/contacts/${contactId}/tags`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: headers(),
      body: JSON.stringify({ tags: [tag] }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        success: false,
        tag,
        error: `GHL remove-tag failed: ${res.status} ${body}`,
      };
    }
    return { success: true, tag };
  } catch (err: any) {
    return { success: false, tag, error: err?.message || 'unknown error' };
  }
}
