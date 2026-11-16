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

/** Drop money, percentages of price, and internal ids from text. */
export function scrubMoney(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .split('\n')
    .filter((line) => !/\$\s?\d|\d\s?(dollars|usd)\b|margin|markup|allowance of|per sf\b.*\d|invoice|payment|retainage|fee\b/i.test(line))
    .join('\n')
    .replace(/\b22P[A-Za-z0-9]{9}\b/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '...' : s;
}

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

export async function gatherSources(jobId: string, sinceISO: string | null, shownIds: Set<string>) {
  const data: any = await pave({
    job: {
      $: { id: jobId },
      id: {},
      name: {},
      number: {},
      closedOn: {},
      location: { address: {}, account: { name: {} } },
      statusVal: { _: 'customFieldValues', $: { where: [['customField', 'id'], JOB_STATUS_FIELD_ID], size: 1 }, nodes: { value: {} } },
      specs: {
        _: 'costItems',
        $: { size: 100, where: ['isSpecification', true] },
        nodes: { name: {}, description: {}, costGroup: { name: {}, parentCostGroup: { name: {} } } },
      },
      orders: {
        _: 'documents',
        $: { size: 50, where: { and: [['type', 'customerOrder'], ['status', 'approved']] }, sortBy: [{ field: 'issueDate', order: 'asc' }] },
        nodes: {
          id: {},
          name: {},
          fullName: {},
          issueDate: {},
          costItems: { $: { size: 40 }, nodes: { name: {}, description: {} } },
        },
      },
      dailyLogs: {
        $: { size: 40, sortBy: [{ field: 'date', order: 'desc' }], ...(sinceISO ? { where: ['date', '>=', sinceISO.slice(0, 10)] } : {}) },
        nodes: { date: {}, notes: {} },
      },
    },
  });
  const job = data?.job;
  if (!job?.id) throw new Error('JobTread job not found');

  const specs = (job.specs?.nodes || []).map((s) => ({
    group: [s.costGroup?.parentCostGroup?.name, s.costGroup?.name].filter(Boolean).join(' > '),
    name: s.name,
    description: clip(scrubMoney(s.description), 1500),
  }));

  // Change orders only: the construction contract and design agreements are
  // mostly terms, and their scope is already in the specification items.
  const changeOrders = (job.orders?.nodes || [])
    .filter((d) => /change order/i.test(d.name || ''))
    .map((d) => ({
      id: d.id,
      name: d.fullName,
      date: d.issueDate,
      items: (d.costItems?.nodes || []).map((i) => ({ name: i.name, description: clip(scrubMoney(i.description), 600) })),
    }));

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
  for (let i = 0; i < fresh.length; i += 50) {
    const ids = fresh.slice(i, i + 50).map((r) => r.jobtread_file_id);
    const res: any = await pave({
      organization: {
        $: { id: '22P5SRwhLaYe' },
        files: {
          $: { size: 50, where: ['id', 'in', ids] },
          nodes: { id: {}, name: {}, description: {}, createdAt: {}, fileTags: { nodes: { name: {} } } },
        },
      },
    });
    const byId = Object.fromEntries((res?.organization?.files?.nodes || []).map((f) => [f.id, f]));
    for (const r of fresh.slice(i, i + 50)) {
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
    dailyLogs,
    newAssets,
  };
}
