// @ts-nocheck
'use client';

/**
 * Short-URL alias for the public Review Gateway.
 *
 * This route exists so outbound SMS/email links can use a short URL like:
 *   https://r.brettkingbuilder.com/r/{contact_key}
 * instead of the long canonical form:
 *   https://bkb-client-intel.vercel.app/review/{contact_key}
 *
 * The rendered component is identical to /review/[contactId] — the shared
 * component reads `useParams()` and falls back across `contactId` and `k`,
 * so both routes submit the same `contactId` value to /api/public/review-submit.
 *
 * DO NOT duplicate gateway logic here. If behavior changes, update the source
 * at app/review/[contactId]/page.tsx and both routes stay in sync.
 */
export { default } from '../../review/[contactId]/page';
