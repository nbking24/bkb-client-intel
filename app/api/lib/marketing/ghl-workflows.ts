// @ts-nocheck
/**
 * GHL Workflow helpers — fire a GHL workflow for a contact.
 *
 * The three review-engine workflows are set up in GHL by Nathan. Each has a
 * numeric workflow id which we store in env so this code stays generic.
 *
 * Env required:
 *  - GHL_API_KEY
 *  - GHL_LOCATION_ID
 *  - GHL_REVIEW_WORKFLOW_COMPLETION_ID
 *  - GHL_REVIEW_WORKFLOW_NURTURE_ID
 *  - GHL_REVIEW_WORKFLOW_POST_DESIGN_ID
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

function workflowIdForTrigger(trigger: ReviewTrigger): string | null {
  switch (trigger) {
    case 'completion':
      return process.env.GHL_REVIEW_WORKFLOW_COMPLETION_ID || null;
    case 'nurture':
      return process.env.GHL_REVIEW_WORKFLOW_NURTURE_ID || null;
    case 'post_design':
      return process.env.GHL_REVIEW_WORKFLOW_POST_DESIGN_ID || null;
    case 'annual':
      return process.env.GHL_REVIEW_WORKFLOW_ANNUAL_ID || null;
    default:
      return null;
  }
}

/**
 * Add a GHL contact to a workflow. The workflow itself handles the survey →
 * branch → review-link logic inside GHL.
 */
export async function addContactToReviewWorkflow(
  contactId: string,
  trigger: ReviewTrigger
): Promise<{ success: boolean; workflowId?: string; error?: string }> {
  const workflowId = workflowIdForTrigger(trigger);
  if (!workflowId) {
    return {
      success: false,
      error: `No workflow id configured for trigger '${trigger}'`,
    };
  }

  try {
    const url = `${GHL_BASE}/contacts/${contactId}/workflow/${workflowId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        success: false,
        workflowId,
        error: `GHL add-to-workflow failed: ${res.status} ${body}`,
      };
    }
    return { success: true, workflowId };
  } catch (err: any) {
    return {
      success: false,
      workflowId,
      error: err?.message || 'unknown error',
    };
  }
}
