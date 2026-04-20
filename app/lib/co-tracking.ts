/**
 * Shared Change Order (CO) Tracking Utility
 *
 * Extracted from field-dashboard/route.ts to provide a single source of truth
 * for CO detection across all dashboards (field, admin/Terri, invoicing).
 *
 * Uses document→budget linkage (not name matching) for reliable approval detection:
 * 1. Fetch cost groups + documents for a job
 * 2. Identify approved customerOrder documents
 * 3. Find Post Pricing hierarchy (roots → org groups → actual CO subgroups)
 * 4. Walk parent chain on approved doc cost items to determine which COs are approved
 */

import { pave } from './jobtread';

export interface BudgetCO {
  id: string;
  name: string;
  isApproved: boolean;
}

/**
 * Price split for an approved customerOrder document. A single document can
 * mix base-contract items with post-pricing (CO) items — e.g. a re-generated
 * "Construction Contract" that rolls a small scope revision into the original
 * contract. In that case the base portion should stay with `totalContractValue`
 * and only the CO portion should feed `approvedCOValue`.
 */
export interface DocumentPriceSplit {
  /** Sum of item prices that walk up (via jobCostItem.costGroup parent chain) to a CO group under Post Pricing. */
  coValue: number;
  /** Sum of item prices that do NOT link to a CO group — i.e. base-contract scope. */
  baseValue: number;
}

export interface COTrackingResult {
  budgetCOs: BudgetCO[];
  /**
   * IDs of approved customerOrder documents whose line items link (via
   * jobCostItem.costGroup parent chain) to at least one Post Pricing CO group.
   * Kept for callers that only need a yes/no signal; for value math use
   * `documentSplits` instead.
   */
  coDocumentIds: string[];
  /**
   * Map of approved customerOrder docId → per-document price split.
   * Use this to avoid double-counting a document as "100% CO" when it only
   * partially links to Post Pricing.
   */
  documentSplits: Record<string, DocumentPriceSplit>;
}

export interface JobCOResult {
  jobId: string;
  budgetCOs: BudgetCO[];
  coDocumentIds: string[];
  documentSplits: Record<string, DocumentPriceSplit>;
}

// Org/status groups are direct children of Post Pricing that organize COs:
//   Client Requested, Trade Walk, ✅ Approved, 🚫 OS Out of Scope, etc.
// NOTE: ✅ prefix is also used as an approval marker on individual CO names
// (e.g. "✅ Paint Colors"), so we match only KNOWN org group names.
const KNOWN_ORG_NAMES = /^(client requested|trade walk|os out of scope|approved|declined|pending|out of scope)$/i;

function isOrgGroup(name: string): boolean {
  const trimmed = name.trim();
  // Strip leading emoji + space if present, then check against known org names
  // Use a broad non-ASCII prefix strip instead of Unicode property escapes (TS target compat)
  const stripped = trimmed.replace(/^[^\w\s]+\s*/g, '');
  return KNOWN_ORG_NAMES.test(stripped);
}

/** Normalize CO name: strip ✅ approval prefix for deduplication/matching */
export function normalizeCOName(name: string): string {
  return (name || '').replace(/^✅\s*/, '');
}

/**
 * Get CO tracking data for a single job using document→budget linkage.
 * This is the gold-standard approach — matches approved customerOrder documents
 * against budget cost groups via parent chain walk (up to 5 levels).
 */
export async function getCOTrackingForJob(jobId: string): Promise<COTrackingResult> {
  try {
    // --- Phase 1: Fetch cost groups + approved documents in parallel ---
    const firstPageSize = 100;
    const [groupPage1, docData] = await Promise.all([
      pave({
        job: {
          $: { id: jobId },
          costGroups: {
            $: { size: firstPageSize },
            nextPage: {},
            nodes: { id: {}, name: {}, parentCostGroup: { id: {} } },
          },
        },
      }),
      pave({
        job: {
          $: { id: jobId },
          documents: {
            $: { size: 50 },
            nodes: { id: {}, type: {}, status: {} },
          },
        },
      }),
    ]);

    // Paginate remaining cost groups
    let allGroups: any[] = (groupPage1 as any)?.job?.costGroups?.nodes || [];
    let nextGroupPage = (groupPage1 as any)?.job?.costGroups?.nextPage || null;
    for (let i = 1; i < 10 && nextGroupPage; i++) {
      const gd = await pave({
        job: {
          $: { id: jobId },
          costGroups: {
            $: { size: firstPageSize, page: nextGroupPage },
            nextPage: {},
            nodes: { id: {}, name: {}, parentCostGroup: { id: {} } },
          },
        },
      });
      const cg = (gd as any)?.job?.costGroups;
      allGroups = allGroups.concat(cg?.nodes || []);
      nextGroupPage = cg?.nextPage || null;
      if ((cg?.nodes?.length || 0) < firstPageSize) break;
    }

    // --- Phase 2: Identify approved customerOrder documents ---
    const allDocs = (docData as any)?.job?.documents?.nodes || [];
    const approvedCODocIds = allDocs
      .filter((d: any) => d.type === 'customerOrder' && d.status === 'approved')
      .map((d: any) => d.id as string);

    // --- Phase 3: Find ALL "Post Pricing Changes" roots and their CO groups ---
    // Some jobs have multiple PP roots (from separate scopes/copies). We must
    // collect COs from ALL of them so document-link matching works correctly.
    const postPricingRoots = allGroups.filter((g: any) =>
      /post\s*pricing/i.test(g.name || '')
    );
    if (postPricingRoots.length === 0) return { budgetCOs: [], coDocumentIds: [], documentSplits: {} };

    const ppRootIds = new Set(postPricingRoots.map((g: any) => g.id));
    const orgGroupIds = new Set<string>();
    const coGroups: any[] = [];
    const seenCONames = new Set<string>(); // Dedupe same-named COs across PP roots

    for (const ppRoot of postPricingRoots) {
      const directChildren = allGroups.filter((g: any) =>
        g.parentCostGroup?.id === ppRoot.id
      );

      for (const g of directChildren) {
        const norm = normalizeCOName(g.name);
        if (isOrgGroup(g.name || '')) {
          orgGroupIds.add(g.id);
        } else if (!seenCONames.has(norm)) {
          seenCONames.add(norm);
          coGroups.push(g);
        }
      }
    }
    // Also check children of org groups across all PP roots
    if (orgGroupIds.size > 0) {
      for (const g of allGroups) {
        const norm = normalizeCOName(g.name);
        if (g.parentCostGroup?.id && orgGroupIds.has(g.parentCostGroup.id) && !seenCONames.has(norm)) {
          seenCONames.add(norm);
          coGroups.push(g);
        }
      }
    }
    if (coGroups.length === 0) return { budgetCOs: [], coDocumentIds: [], documentSplits: {} };

    // Build a comprehensive set of ALL CO group IDs across ALL PP roots
    // (same-named COs under different PP roots have different IDs, but we
    // need to match against ALL of them for document-link approval)
    const coNameToCanonicalId = new Map<string, string>();
    for (const co of coGroups) {
      coNameToCanonicalId.set(normalizeCOName(co.name), co.id);
    }
    // Collect ALL group IDs that represent CO groups (including duplicates across PP roots)
    const allCOGroupIds = new Set<string>();
    for (const ppRoot of postPricingRoots) {
      const directChildren = allGroups.filter((g: any) =>
        g.parentCostGroup?.id === ppRoot.id
      );
      for (const g of directChildren) {
        const norm = normalizeCOName(g.name);
        if (!isOrgGroup(g.name || '') && coNameToCanonicalId.has(norm)) {
          allCOGroupIds.add(g.id);
        }
      }
    }
    if (orgGroupIds.size > 0) {
      for (const g of allGroups) {
        const norm = normalizeCOName(g.name);
        if (g.parentCostGroup?.id && orgGroupIds.has(g.parentCostGroup.id) && coNameToCanonicalId.has(norm)) {
          allCOGroupIds.add(g.id);
        }
      }
    }
    // Map any CO group ID (from any PP root) back to the canonical CO entry
    const coIdToCanonicalId = new Map<string, string>();
    for (const ppRoot of postPricingRoots) {
      const directChildren = allGroups.filter((g: any) =>
        g.parentCostGroup?.id === ppRoot.id
      );
      for (const g of directChildren) {
        const norm = normalizeCOName(g.name);
        if (!isOrgGroup(g.name || '') && coNameToCanonicalId.has(norm)) {
          coIdToCanonicalId.set(g.id, coNameToCanonicalId.get(norm)!);
        }
      }
    }
    if (orgGroupIds.size > 0) {
      for (const g of allGroups) {
        const norm = normalizeCOName(g.name);
        if (g.parentCostGroup?.id && orgGroupIds.has(g.parentCostGroup.id) && coNameToCanonicalId.has(norm)) {
          coIdToCanonicalId.set(g.id, coNameToCanonicalId.get(norm)!);
        }
      }
    }

    // --- Phase 4: Determine approval via document→budget linkage ---
    // For each approved customerOrder doc, query its cost items' jobCostItem.costGroup
    // with a parent chain (up to 5 levels). Walk up to find which CO group under
    // Post Pricing each item belongs to. We match against ALL CO group IDs across
    // ALL PP roots, then map back to the canonical CO entry for deduplication.
    const approvedCOIds = new Set<string>();
    // Track which approved customerOrder docs actually link to a CO group
    // (i.e. are change-order documents, not the base contract).
    const coDocIdSet = new Set<string>();
    // Per-document price split: coValue = sum of item prices linked to a CO
    // group under Post Pricing; baseValue = everything else on that document.
    // This lets callers handle mixed documents (a base contract that also
    // rolls in a scope revision) without flipping the whole doc to "CO".
    const documentSplits: Record<string, DocumentPriceSplit> = {};

    if (approvedCODocIds.length > 0) {
      const docItemResults = await Promise.all(
        approvedCODocIds.map((docId: string) =>
          pave({
            document: {
              $: { id: docId },
              costItems: {
                $: { size: 100 },
                nodes: {
                  price: {},
                  jobCostItem: {
                    costGroup: {
                      id: {}, name: {},
                      parentCostGroup: {
                        id: {}, name: {},
                        parentCostGroup: {
                          id: {}, name: {},
                          parentCostGroup: {
                            id: {}, name: {},
                            parentCostGroup: { id: {}, name: {} },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          }).then((r: any) => ({ docId, items: r?.document?.costItems?.nodes || [] }))
            .catch(() => ({ docId, items: [] as any[] }))
        )
      );

      for (const { docId, items } of docItemResults) {
        let docTouchesCO = false;
        let coValue = 0;
        let baseValue = 0;
        for (const item of items) {
          const itemPrice = typeof item?.price === 'number' ? item.price : 0;
          const cg = item?.jobCostItem?.costGroup;

          let isCOItem = false;
          if (cg) {
            // Walk up the parent chain to find which CO group this item belongs to
            // Match against ALL CO group IDs (from any PP root), then map to canonical
            let curr = cg;
            while (curr?.id) {
              if (allCOGroupIds.has(curr.id)) {
                const canonicalId = coIdToCanonicalId.get(curr.id) || curr.id;
                approvedCOIds.add(canonicalId);
                docTouchesCO = true;
                isCOItem = true;
                break;
              }
              curr = curr.parentCostGroup;
            }
          }

          if (isCOItem) coValue += itemPrice;
          else baseValue += itemPrice;
        }
        if (docTouchesCO) coDocIdSet.add(docId);
        documentSplits[docId] = { coValue, baseValue };
      }
    }

    return {
      budgetCOs: coGroups.map((co: any) => ({
        id: co.id,
        name: (co.name || '').replace(/^✅\s*/, ''), // Strip approval emoji for clean display
        isApproved: approvedCOIds.has(co.id),
      })),
      coDocumentIds: Array.from(coDocIdSet),
      documentSplits,
    };
  } catch (err: any) {
    console.error(`[CO-TRACK] ERROR for job ${jobId}:`, err?.message || err);
    return { budgetCOs: [], coDocumentIds: [], documentSplits: {} };
  }
}

/**
 * Get CO tracking data for multiple jobs in parallel batches.
 * Processes in batches of 5 to avoid overloading PAVE.
 */
export async function getCOTrackingForJobs(
  jobIds: string[]
): Promise<JobCOResult[]> {
  const results: JobCOResult[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < jobIds.length; i += BATCH_SIZE) {
    const batch = jobIds.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (jobId) => {
        const tracking = await getCOTrackingForJob(jobId);
        return {
          jobId,
          budgetCOs: tracking.budgetCOs,
          coDocumentIds: tracking.coDocumentIds,
          documentSplits: tracking.documentSplits,
        };
      })
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        console.error('[CO-TRACK] Batch job error:', r.reason?.message || r.reason);
      }
    }
  }

  return results;
}
