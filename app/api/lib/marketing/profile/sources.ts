// @ts-nocheck
/**
 * Gather what the profile writer may draw on, from JobTread and the Hub:
 *   job name, number, Status, full street address, client name (to keep
 *   first names out), budget specification items, approved change orders
 *   and their line items, daily log notes, and the photos, videos and plans
 *   the copy step has sent to Mike.
 *
 * Every piece of text is scrubbed of money before it reaches the model.
 *
 * Style note: no em or en dashes in this file.
 */
import { pave } from '@/app/lib/jobtread';
import { JOB_STATUS_FIELD_ID } from '@/app/api/lib/jobtread';
import { getSupabase } from '@/app/api/lib/supabase';

/** Sentences about pricing are dropped whole; product names in other sentences are kept. */
const PRICING_SENTENCE_RE = /\b(priced?|pricing|cost|costs|estimate|estimated|discount|tax|freight|margin|markup|allowance|invoice|payment|retainage|fee|credit|budget|percent of)\b/i;

/**
 * Take money out of text before the writer sees it: dollar amounts and
 * "31 at $52.60" style quantities are cut, then any sentence still about
 * pricing is dropped. Internal JobTread ids are removed too.
 */
export function scrubMoney(text: string | null | undefined): string {
  if (!text) return '';
  const cut = text
    .replace(/\b\d[\d,.]*\s*([A-Za-z]{1,6}\s+)?at\s+\$\s?[\d,.]+(\s*(per|each|\/)\s*\w+)?,?/gi, '')
    .replace(/\$\s?[\d,.]+(\s*(per|\/)\s*\w+)?/g, '')
    .replace(/\b\d[\d,.]*\s?(dollars|usd)\b/gi, '')
    .replace(/\b22P[A-Za-z0-9]{9}\b/g, '');
  return cut
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !PRICING_SENTENCE_RE.test(sentence))
        .join(' ')
        .replace(/\s+,/g, ',')
        .replace(/,\s*([.,])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trimEnd()
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '...' : s;
}

/** Line items that are about money, not work. */
export const CREDIT_LINE_RE = /\b(credit|credits|deduct|deduction|deducts|refund|rebate|reimburse|allowance|pricing|price revision|revision on pricing|discount)\b/i;
/** Routine work that is not a story on its own: paint coats, prep, patching, rehanging. */
export const ROUTINE_LINE_RE = /\b(paint|painting|repaint|repainting|touch.?up|patch|patching|rehang|re-hang|prime|primer|paint prep|prep|caulk|caulking|clean.?up)\b/i;

/** Overhead lines that say nothing about the design or the build. */
export const ADMIN_LINE_RE = /\b(project management|management time|design time|administration|admin|profit|margin|markup|overhead|dumpster|portalet|porta.?john)\b/i;

/** First names from a JobTread customer account name ("Anne Marrero", "Nicols, John & Marcie"). */
export function clientFirstNames(account: string | null | undefined): string[] {
  const a = (account || '').trim();
  if (!a) return [];
  let firsts: string[];
  if (a.includes(',')) firsts = a.split(',')[1].split(/&|\band\b/i);
  else {
    const parts = a.split(/&|\band\b/i).map((p) => p.trim()).filter(Boolean);
    firsts = parts.map((p, i) => (i === parts.length - 1 ? p.split(/\s+/).slice(0, -1).join(' ') : p));
  }
  return firsts.map((f) => f.trim().split(/\s+/)[0]).filter((f) => f && f.length > 1);
}

export type NewAsset = {
  fileId: string;
  ftpName: string;
  kind: string; // before | progress | finished | rendering | plan | video | design-video
  name: string;
  description: string | null;
  tags: string[];
  createdAt: string;
};

const PAGE = 25;
const MAX_PAGES = 20;

/**
 * Follow nextPage for one connection, PAGE at a time. JobTread answers 413
 * when a single response gets too big, so every list is fetched in small
 * pages with few nested fields.
 */
async function pageAll(build: (page: string | undefined) => any, pick: (data: any) => any): Promise<any[]> {
  const out = [];
  let page: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const conn = pick(await pave(build(page)));
    out.push(...(conn?.nodes || []));
    page = conn?.nextPage || undefined;
    if (!page) break;
  }
  return out;
}

export async function gatherSources(jobId: string, sinceISO: string | null, shownIds: Set<string>) {
  // 1. The job itself: no lists.
  const base: any = await pave({
    job: {
      $: { id: jobId },
      id: {},
      name: {},
      number: {},
      closedOn: {},
      location: { address: {}, account: { name: {} } },
      statusVal: { _: 'customFieldValues', $: { where: [['customField', 'id'], JOB_STATUS_FIELD_ID], size: 1 }, nodes: { value: {} } },
    },
  });
  if (!base?.job?.id) throw new Error('JobTread job not found');

  // 2. Specification items, paged.
  const specNodes = await pageAll(
    (page) => ({
      job: {
        $: { id: jobId },
        costItems: {
          $: { size: PAGE, where: ['isSpecification', true], ...(page ? { page } : {}) },
          nextPage: {},
          nodes: { name: {}, description: {}, costGroup: { name: {}, parentCostGroup: { name: {} } } },
        },
      },
    }),
    (d) => d?.job?.costItems
  );

  // 3. Approved customer orders, paged, with no line items in the list.
  const orderNodes = await pageAll(
    (page) => ({
      job: {
        $: { id: jobId },
        documents: {
          $: {
            size: PAGE,
            where: { and: [['type', 'customerOrder'], ['status', 'approved']] },
            sortBy: [{ field: 'issueDate', order: 'asc' }],
            ...(page ? { page } : {}),
          },
          nextPage: {},
          nodes: { id: {}, name: {}, fullName: {}, issueDate: {}, price: {} },
        },
      },
    }),
    (d) => d?.job?.documents
  );

  // 4. Line items fetched per change order, paged.
  const orders = [];
  for (const d of orderNodes.filter((x) => /change order/i.test(x.name || ''))) {
    const items = await pageAll(
      (page) => ({
        document: {
          $: { id: d.id },
          costItems: { $: { size: PAGE, ...(page ? { page } : {}) }, nextPage: {}, nodes: { name: {}, description: {}, price: {} } },
        },
      }),
      (x) => x?.document?.costItems
    );
    orders.push({ ...d, costItems: { nodes: items } });
  }

  // 5. Daily logs since the last profile, paged.
  const logNodes = await pageAll(
    (page) => ({
      job: {
        $: { id: jobId },
        dailyLogs: {
          $: {
            size: PAGE,
            sortBy: [{ field: 'date', order: 'desc' }],
            ...(sinceISO ? { where: ['date', '>=', sinceISO.slice(0, 10)] } : {}),
            ...(page ? { page } : {}),
          },
          nextPage: {},
          nodes: { date: {}, notes: {} },
        },
      },
    }),
    (d) => d?.job?.dailyLogs
  );

  const job = { ...base.job, specs: { nodes: specNodes }, orders: { nodes: orders }, dailyLogs: { nodes: logNodes } };

  const specs = (job.specs?.nodes || []).map((s) => ({
    group: [s.costGroup?.parentCostGroup?.name, s.costGroup?.name].filter(Boolean).join(' > '),
    name: s.name,
    description: clip(scrubMoney(s.description), 1500),
  }));

  // Change orders only: the construction contract and design agreements are
  // mostly terms, and their scope is already in the specification items.
  // Change orders as the writer sees them. Amounts are used here only to
  // filter and are never passed on.
  //   - Lines that are credits, deducts, refunds, allowance deductions or
  //     pricing revisions are dropped, as are admin lines (management or
  //     design time, administration, profit).
  //   - A change order that nets to a credit, or has nothing left after
  //     that, is skipped entirely (it is still recorded as covered).
  const changeOrders = [];
  const skippedChangeOrders = [];
  for (const d of job.orders?.nodes || []) {
    const raw = d.costItems?.nodes || [];
    const items = raw
      .filter((i) => !CREDIT_LINE_RE.test(i.name || '') && !ADMIN_LINE_RE.test(i.name || ''))
      .map((i) => ({ name: i.name, description: clip(scrubMoney(i.description), 600) }));
    const netCredit = typeof d.price === 'number' && d.price <= 0;
    const allCredits = raw.length > 0 && raw.every((i) => CREDIT_LINE_RE.test(i.name || '') || (typeof i.price === 'number' && i.price < 0));
    const routineOnly = items.length > 0 && items.every((i) => ROUTINE_LINE_RE.test(i.name || ''));
    if (netCredit || allCredits || items.length === 0 || routineOnly) {
      skippedChangeOrders.push({
        id: d.id,
        name: d.fullName,
        reason: netCredit || allCredits ? 'credit only' : routineOnly ? 'routine work only' : 'only admin lines',
      });
      continue;
    }
    changeOrders.push({ id: d.id, name: d.fullName, date: d.issueDate, items });
  }

  const dailyLogs = (job.dailyLogs?.nodes || [])
    .filter((l) => l.notes && l.notes.trim())
    .map((l) => ({ date: l.date, notes: clip(scrubMoney(l.notes), 800) }));

  // Files the copy step has sent that the profile does not show yet.
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from('marketing_photo_assets')
    .select('jobtread_file_id, ftp_filename, kind, created_at')
    .eq('job_id', jobId)
    .eq('excluded', false)
    .not('jobtread_file_id', 'is', null)
    .order('created_at', { ascending: true });
  const fresh = (rows || []).filter((r) => !shownIds.has(r.jobtread_file_id));

  const newAssets: NewAsset[] = [];
  for (let i = 0; i < fresh.length; i += PAGE) {
    const ids = fresh.slice(i, i + PAGE).map((r) => r.jobtread_file_id);
    const res: any = await pave({
      organization: {
        $: { id: '22P5SRwhLaYe' },
        files: {
          $: { size: PAGE, where: ['id', 'in', ids] },
          nodes: { id: {}, name: {}, description: {}, createdAt: {}, fileTags: { nodes: { name: {} } } },
        },
      },
    });
    const byId = Object.fromEntries((res?.organization?.files?.nodes || []).map((f) => [f.id, f]));
    for (const r of fresh.slice(i, i + PAGE)) {
      const f = byId[r.jobtread_file_id];
      newAssets.push({
        fileId: r.jobtread_file_id,
        ftpName: r.ftp_filename,
        kind: r.kind,
        name: f?.name || r.ftp_filename,
        description: f?.description || null,
        tags: (f?.fileTags?.nodes || []).map((t) => t.name),
        createdAt: f?.createdAt || r.created_at,
      });
    }
  }

  return {
    job: {
      id: job.id,
      name: job.name,
      number: job.number,
      status: job.statusVal?.nodes?.[0]?.value || null,
      closed: !!job.closedOn,
      address: job.location?.address || '',
      clientFirstNames: clientFirstNames(job.location?.account?.name),
    },
    specs,
    changeOrders,
    skippedChangeOrders,
    dailyLogs,
    newAssets,
  };
}
