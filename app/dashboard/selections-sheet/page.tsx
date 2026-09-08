// @ts-nocheck
/**
 * The standalone Selections Sheet tab is retired (2026-09-08): the
 * Client Selections Sheet is now reached from each job card on the
 * Pre-Construction selections overview. This route sticks around only
 * so old bookmarks land somewhere sensible.
 *
 * The public share links (/s/[token]) and the API
 * (/api/dashboard/selections-sheet) are unchanged.
 */
import { redirect } from 'next/navigation';

export default function SelectionsSheetRedirect() {
  redirect('/dashboard/precon');
}
