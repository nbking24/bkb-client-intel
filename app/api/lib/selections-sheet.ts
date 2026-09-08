// @ts-nocheck
// ============================================================
// Client Selections Sheet — data + token helpers
//
// Builds a CLIENT-SAFE view of a job's 📜 Selections register:
//   - only register lines (Selection custom field = true)
//   - only real decisions (isSpecification = true)
//   - name, description, status, trade/area grouping
//   - NO internal notes, NO costs, NO vendor chatter
//
// The JobTread Specifications tab remains the internal/trade
// document (it prints Internal Notes by design). This module is
// the client-facing counterpart, per
// claude/BKB-Selections-System-Spec.md in the JobTread Assistant
// project.
// ============================================================

import { createHmac } from 'crypto';

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';

// Custom field IDs (BKB org 22P5SRwhLaYe)
const CF_SELECTION = '22PBByMRR2XS'; // boolean identity marker
const CF_STATUS = '22P5WiHgkzx9'; // workflow status
// Internal Notes (22P5WiMpe6AM) is deliberately NEVER fetched here.

export const STATUS_BUCKETS = [
  {
    key: 'client',
    statuses: ['1. Client Selection Needed'],
    title: 'Your Decisions Needed',
    blurb: 'These selections are waiting on you. Your choices here keep the project moving.',
  },
  {
    key: 'upcoming',
    statuses: ['0. Not Started'],
    title: 'Coming Up',
    blurb: 'Decisions on the horizon. Nothing needed yet, but feel free to start browsing.',
  },
  {
    key: 'internal',
    statuses: ['2. Internal Selection Needed', '3. Pricing Pending'],
    title: 'In Progress with Our Team',
    blurb: 'Our team is working through these. We will bring them to you when they are ready.',
  },
  {
    key: 'ordering',
    statuses: ['4. Selected/Needs Order'],
    title: 'Selected, Being Ordered',
    blurb: 'Decided and moving into ordering.',
  },
  {
    key: 'done',
    statuses: ['5. Ordered/Finalized'],
    title: 'Finalized',
    blurb: 'Locked in. Shown here so the whole picture stays in one place.',
  },
];

async function jtQuery(query) {
  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { $: { grantKey: JT_KEY() }, ...query } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('JobTread API error ' + res.status + ': ' + text.slice(0, 200));
  }
  return res.json();
}

// ------------------------------------------------------------
// Share-link tokens: /s/{jobId}~{sig}
// HMAC keyed on a dedicated secret, falling back to APP_PIN so
// no new env var is strictly required.
// ------------------------------------------------------------

function linkSecret() {
  return (
    process.env.SELECTIONS_LINK_SECRET ||
    process.env.APP_PIN ||
    'bkb-selections-sheet'
  );
}

export function makeSheetToken(jobId) {
  const sig = createHmac('sha256', linkSecret())
    .update('selections:' + jobId)
    .digest('base64url')
    .slice(0, 16);
  return jobId + '~' + sig;
}

export function verifySheetToken(token) {
  const idx = (token || '').indexOf('~');
  if (idx < 1) return null;
  const jobId = token.slice(0, idx);
  if (!/^[A-Za-z0-9]{6,24}$/.test(jobId)) return null;
  return makeSheetToken(jobId) === token ? jobId : null;
}

// ------------------------------------------------------------
// Fetch + shape the sheet
// ------------------------------------------------------------

export async function fetchSelectionsSheet(jobId) {
  // 1. Job header info
  const jobData = await jtQuery({
    job: {
      $: { id: jobId },
      id: {},
      name: {},
      number: {},
      location: {
        id: {},
        name: {},
        address: {},
        account: { id: {}, name: {} },
      },
    },
  });

  const job = jobData?.job;
  if (!job?.id) throw new Error('Job not found');

  // 1b. All cost groups (for the path map) — PAVE caps size at 100, paginate.
  const groups = [];
  let groupPage = undefined;
  for (let i = 0; i < 10; i++) {
    const params = {
      $: { size: 100 },
      nextPage: {},
      nodes: {
        id: {},
        name: {},
        position: {},
        parentCostGroup: { id: {} },
      },
    };
    if (groupPage) params.$.page = groupPage;
    const gd = await jtQuery({ job: { $: { id: jobId }, costGroups: params } });
    groups.push(...(gd?.job?.costGroups?.nodes || []));
    groupPage = gd?.job?.costGroups?.nextPage || null;
    if (!groupPage) break;
  }
  const groupById = {};
  for (const g of groups) groupById[g.id] = g;

  // 2. Register lines: Selection = true AND isSpecification = true.
  //    Paginated at 50 per the org's PAVE limits.
  const items = [];
  let page = undefined;
  for (let i = 0; i < 20; i++) {
    const params = {
      $: {
        size: 50,
        with: {
          cf: {
            _: 'customFieldValues',
            $: { where: [['customField', 'id'], CF_SELECTION] },
            values: { $: { field: 'value' } },
          },
        },
        where: {
          and: [
            [['cf', 'values'], '=', true],
            ['isSpecification', '=', true],
          ],
        },
      },
      nextPage: {},
      nodes: {
        id: {},
        name: {},
        description: {},
        position: {},
        costGroup: { id: {} },
        customFieldValues: {
          $: { size: 10 },
          nodes: { value: {}, customField: { id: {} } },
        },
      },
    };
    if (page) params.$.page = page;
    const data = await jtQuery({ job: { $: { id: jobId }, costItems: params } });
    const batch = data?.job?.costItems?.nodes || [];
    items.push(...batch);
    page = data?.job?.costItems?.nextPage || null;
    if (!page) break;
  }

  // 3. Walk each item's group chain up to the 📜 Selections root.
  //    trade = first level under the register, area = the rest.
  const shaped = [];
  for (const it of items) {
    const chain = [];
    let gid = it.costGroup?.id;
    let inRegister = false;
    let guard = 0;
    while (gid && guard++ < 15) {
      const g = groupById[gid];
      if (!g) break;
      if ((g.name || '').includes('📜')) {
        inRegister = true;
        break;
      }
      chain.unshift(g.name || '');
      gid = g.parentCostGroup?.id;
    }
    if (!inRegister) continue; // stray Selection-flagged item outside the register

    let status = '';
    for (const v of it.customFieldValues?.nodes || []) {
      if (v.customField?.id === CF_STATUS) status = String(v.value || '');
    }

    shaped.push({
      id: it.id,
      name: it.name,
      description: it.description || '',
      status,
      trade: (chain[0] || 'General').replace(/^\d+\s*/, '').trim() || 'General',
      tradeSort: chain[0] || 'zzz',
      area: chain.slice(1).join(' — '),
      position: it.position || '',
    });
  }

  // 4. Bucket by status, then group by trade within each bucket.
  const buckets = STATUS_BUCKETS.map((b) => {
    const lines = shaped
      .filter((s) => b.statuses.includes(s.status))
      .sort(
        (a, x) =>
          a.tradeSort.localeCompare(x.tradeSort) ||
          a.position.localeCompare(x.position)
      );
    const trades = [];
    for (const line of lines) {
      let t = trades[trades.length - 1];
      if (!t || t.trade !== line.trade) {
        t = { trade: line.trade, lines: [] };
        trades.push(t);
      }
      t.lines.push(line);
    }
    return { key: b.key, title: b.title, blurb: b.blurb, count: lines.length, trades };
  }).filter((b) => b.count > 0);

  // Lines whose status fits no bucket (blank/unknown) — surface under Coming Up
  const known = new Set(STATUS_BUCKETS.flatMap((b) => b.statuses));
  const orphans = shaped.filter((s) => !known.has(s.status));

  return {
    job: {
      id: job.id,
      name: job.name,
      number: job.number,
      client: job.location?.account?.name || '',
      address: job.location?.address || job.location?.name || '',
    },
    generatedAt: new Date().toISOString(),
    totalCount: shaped.length,
    openCount: shaped.filter((s) => !s.status.startsWith('5.')).length,
    clientActionCount: shaped.filter((s) => s.status.startsWith('1.')).length,
    buckets,
    unbucketedCount: orphans.length,
  };
}
