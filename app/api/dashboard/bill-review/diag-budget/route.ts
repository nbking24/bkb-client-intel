// @ts-nocheck
/**
 * GET /api/dashboard/bill-review/diag-budget?jobId=XXX
 *
 * Diagnostic — probe the JT cost item schema for fields that signal
 * "approved" state at the budget-line level. Tries a panel of candidate
 * names with PAVE and returns the value + raw shape for the first 5
 * budget items so we can identify the right field name.
 *
 * Auth: CRON_SECRET via Bearer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pave } from '../../../../lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Each candidate is tried as its own query. Any that fail with
// "field does not exist" are reported as unsupported; any that
// succeed return their value for the sampled cost items.
const CANDIDATE_FIELDS = [
  'approvedPrice',
  'approvedCost',
  'approvedQuantity',
  'approvedUnitPrice',
  'approvedAt',
  'approvedBy',
  'priceApproved',
  'costApproved',
  'isApproved',
  'approved',
  'baseCost',
  'basePrice',
  'baseQuantity',
  'baseUnitCost',
  'baseUnitPrice',
];

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  }

  // Get a sample of budget item IDs first (the safe, known query).
  let sampleIds: string[] = [];
  try {
    const baseData = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: { size: 5 },
          nodes: { id: {}, name: {}, cost: {}, price: {} },
        },
      },
    });
    const nodes = (baseData as any)?.job?.costItems?.nodes || [];
    sampleIds = nodes.map((n: any) => n.id);
  } catch (err: any) {
    return NextResponse.json({ error: 'Base query failed: ' + (err?.message || err) }, { status: 500 });
  }

  // For each candidate field, run a tiny query and see what comes back.
  const results: Record<string, any> = {};
  for (const field of CANDIDATE_FIELDS) {
    try {
      const data = await pave({
        job: {
          $: { id: jobId },
          costItems: {
            $: { size: 5 },
            nodes: { id: {}, [field]: {} },
          },
        },
      });
      const nodes = (data as any)?.job?.costItems?.nodes || [];
      results[field] = {
        supported: true,
        values: nodes.map((n: any) => ({ id: n.id, [field]: n[field] })),
      };
    } catch (err: any) {
      results[field] = {
        supported: false,
        error: (err?.message || String(err)).slice(0, 240),
      };
    }
  }

  return NextResponse.json({
    jobId,
    sampleIds,
    fields: results,
  });
}
