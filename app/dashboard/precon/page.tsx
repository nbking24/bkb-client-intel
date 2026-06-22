// @ts-nocheck
'use client';

/**
 * Pre-Construction Dashboard
 *
 * Selections Tracker, version 1.
 *
 * The pre-con coordinator (currently Allison) lives in this page when
 * working through pending selections. Every active job (In Design,
 * Ready, In Production) has a card; collapsed by default so the page
 * fits a single screen. Each card surfaces only the budget line items
 * whose JT cost-item "Status" custom field is set, grouped by status:
 *
 *   1. Client Selection Needed    (red, top priority - waiting on client)
 *   2. Internal Selection Needed  (amber - waiting on BKB)
 *   3. Selected/Needs Order       (blue - decision made, needs to be ordered)
 *   4. Ordered/Finalized          (green/muted - tracking only)
 *
 * Jobs that have hit Final Billing are excluded - by then selections
 * should already be locked. Jobs with no Status-tagged items are also
 * dropped so the report stays focused.
 *
 * The previous precon page (AI agent recommendations, weekly emails,
 * orphan task panel, etc.) was wiped in favor of this single-purpose
 * tracker. If any of that needs to come back, git history has it.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

interface SelectionItem {
  id: string;
  name: string;
  description: string;
  quantity: number | null;
  unitName: string;
  unitPrice: number | null;
  cost: number;
  costCodeNumber: string;
  costCodeName: string;
  costGroupId: string | null;
  costGroupName: string;
  parentGroupName: string;
  status: string;
}

interface JobBlock {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  customStatus: string | null;
  statusCategory: 'IN_DESIGN' | 'READY' | 'IN_PRODUCTION' | string | null;
  counts: {
    clientSelectionNeeded: number;
    internalSelectionNeeded: number;
    selectedNeedsOrder: number;
    orderedFinalized: number;
  };
  actionableCount: number;
  items: SelectionItem[];
}

interface Totals {
  jobCount: number;
  actionable: number;
  clientSelectionNeeded: number;
  internalSelectionNeeded: number;
  selectedNeedsOrder: number;
  orderedFinalized: number;
}

// ============================================================
// Status display config (label, color, key)
// Order matters - this drives the section ordering inside each
// expanded job card. The three "actionable" statuses come first;
// Ordered/Finalized is rendered last and visually de-emphasized.
// ============================================================

const STATUS_CONFIG: Array<{
  key: keyof JobBlock['counts'];
  jtValue: string;
  label: string;
  shortLabel: string;
  color: string;       // text color
  bg: string;          // background tint
  border: string;
  actionable: boolean;
}> = [
  {
    key: 'clientSelectionNeeded',
    jtValue: '1. Client Selection Needed',
    label: 'Client Selection Needed',
    shortLabel: 'Client',
    color: '#b91c1c',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.25)',
    actionable: true,
  },
  {
    key: 'internalSelectionNeeded',
    jtValue: '2. Internal Selection Needed',
    label: 'Internal Selection Needed',
    shortLabel: 'Internal',
    color: '#a16207',
    bg: 'rgba(234,179,8,0.10)',
    border: 'rgba(234,179,8,0.30)',
    actionable: true,
  },
  {
    key: 'selectedNeedsOrder',
    jtValue: '3. Selected/Needs Order',
    label: 'Selected, Needs Order',
    shortLabel: 'Order',
    color: '#1e40af',
    bg: 'rgba(59,130,246,0.08)',
    border: 'rgba(59,130,246,0.25)',
    actionable: true,
  },
  {
    key: 'orderedFinalized',
    jtValue: '4. Ordered/Finalized',
    label: 'Ordered / Finalized',
    shortLabel: 'Done',
    color: '#15803d',
    bg: 'rgba(34,197,94,0.06)',
    border: 'rgba(34,197,94,0.20)',
    actionable: false,
  },
];

const STAGE_LABEL: Record<string, string> = {
  IN_DESIGN: 'In Design',
  READY: 'Ready',
  IN_PRODUCTION: 'In Production',
};

const STAGE_BG: Record<string, string> = {
  IN_DESIGN: 'rgba(160,111,0,0.10)',
  READY: 'rgba(59,130,246,0.10)',
  IN_PRODUCTION: 'rgba(34,150,80,0.10)',
};

const STAGE_COLOR: Record<string, string> = {
  IN_DESIGN: '#a06f00',
  READY: '#1e40af',
  IN_PRODUCTION: '#15803d',
};

// ============================================================
// Component
// ============================================================

export default function PreconDashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobBlock[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);

  // UI filters and expanded state.
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [hideFinalized, setHideFinalized] = useState(true);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  // ----------------------------------------------------------
  // Data load
  // ----------------------------------------------------------
  async function load(force = false) {
    if (force) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/precon/selections', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || `Load failed (${res.status})`);
      setJobs(data.jobs || []);
      setTotals(data.totals || null);
      setComputedAt(data.computedAt || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load selections');
    } finally {
      if (force) setRefreshing(false); else setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // ----------------------------------------------------------
  // Filter + sort
  // ----------------------------------------------------------
  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (stageFilter !== 'all' && j.statusCategory !== stageFilter) return false;
      if (q) {
        const hay = `${j.clientName || ''} ${j.jobName || ''} ${j.jobNumber || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Hide jobs whose only remaining statused items are Ordered/Finalized
      // when the operator chose to focus on the actionable backlog.
      if (hideFinalized && j.actionableCount === 0) return false;
      return true;
    });
  }, [jobs, search, stageFilter, hideFinalized]);

  function toggleJob(jobId: string) {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function expandAll() {
    setExpandedJobs(new Set(filteredJobs.map((j) => j.jobId)));
  }

  function collapseAll() {
    setExpandedJobs(new Set());
  }

  const cachedAtLabel = useMemo(() => {
    if (!computedAt) return null;
    const ageMs = Date.now() - new Date(computedAt).getTime();
    const min = Math.floor(ageMs / 60000);
    const hr = Math.floor(ageMs / 3600000);
    if (hr >= 1) return `${hr}h ago`;
    if (min >= 1) return `${min}m ago`;
    return 'just now';
  }, [computedAt]);

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-xs hover:underline mb-1"
            style={{ color: '#8a8078' }}
          >
            <ArrowLeft size={12} /> Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: '#c88c00', fontFamily: 'Georgia, serif' }}>
            Pre-Construction
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
            Selections tracker — every active job's pending design, internal, and order-ready selections.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {cachedAtLabel && (
            <span className="text-xs hidden sm:inline" style={{ color: '#8a8078' }}>
              Data as of {cachedAtLabel}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50"
            style={{ border: '1px solid rgba(200,140,0,0.15)', color: '#8a8078' }}
            title="Pull a fresh snapshot from JobTread"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Initial load + error */}
      {loading && (
        <div className="flex items-center justify-center py-20 gap-3" style={{ color: '#8a8078' }}>
          <Loader2 size={24} className="animate-spin" />
          <span>Loading selections across all active jobs…</span>
        </div>
      )}
      {error && !loading && (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Portfolio KPI strip */}
          {totals && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg p-3" style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.10)' }}>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#8a8078' }}>
                  <Users size={12} /> Active jobs
                </div>
                <p className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>{totals.jobCount}</p>
                <p className="text-xs" style={{ color: '#8a8078' }}>with tagged selections</p>
              </div>
              {STATUS_CONFIG.map((s) => (
                <div
                  key={s.key}
                  className="rounded-lg p-3"
                  style={{ background: s.bg, border: `1px solid ${s.border}` }}
                >
                  <div className="text-xs font-medium" style={{ color: s.color }}>{s.shortLabel}</div>
                  <p className="text-2xl font-bold" style={{ color: s.color }}>
                    {totals[s.key]}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: '#8a8078' }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Toolbar */}
          <div className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.12)' }}>
            <div className="relative flex-1 min-w-[240px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#8a8078' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by client name, job name, or job number…"
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
                style={{ background: '#fdfcfa', border: '1px solid rgba(200,140,0,0.15)', color: '#1a1a1a' }}
              />
            </div>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: '#fdfcfa', border: '1px solid rgba(200,140,0,0.15)', color: '#1a1a1a' }}
            >
              <option value="all">All stages</option>
              <option value="IN_DESIGN">In Design</option>
              <option value="READY">Ready</option>
              <option value="IN_PRODUCTION">In Production</option>
            </select>
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: '#3d3a36' }}>
              <input
                type="checkbox"
                checked={hideFinalized}
                onChange={(e) => setHideFinalized(e.target.checked)}
              />
              Hide jobs with only finalized selections
            </label>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={expandAll}
                className="text-xs px-2 py-1 rounded hover:bg-stone-50"
                style={{ border: '1px solid rgba(200,140,0,0.15)', color: '#8a8078' }}
                disabled={filteredJobs.length === 0}
              >
                Expand all
              </button>
              <button
                onClick={collapseAll}
                className="text-xs px-2 py-1 rounded hover:bg-stone-50"
                style={{ border: '1px solid rgba(200,140,0,0.15)', color: '#8a8078' }}
                disabled={expandedJobs.size === 0}
              >
                Collapse all
              </button>
            </div>
          </div>

          {/* Job cards */}
          {filteredJobs.length === 0 ? (
            <div
              className="rounded-xl p-8 text-center text-sm"
              style={{ background: '#fdfcfa', border: '1px solid rgba(200,140,0,0.12)', color: '#8a8078' }}
            >
              {jobs.length === 0
                ? 'No active jobs have any Status-tagged selections yet.'
                : 'No jobs match the current filters.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredJobs.map((job) => (
                <JobCard
                  key={job.jobId}
                  job={job}
                  expanded={expandedJobs.has(job.jobId)}
                  onToggle={() => toggleJob(job.jobId)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Job card (collapsible)
// ============================================================

function JobCard({
  job,
  expanded,
  onToggle,
}: {
  job: JobBlock;
  expanded: boolean;
  onToggle: () => void;
}) {
  const stageLabel = STAGE_LABEL[job.statusCategory || ''] || job.customStatus || '';
  const stageBg = STAGE_BG[job.statusCategory || ''] || 'rgba(200,140,0,0.10)';
  const stageColor = STAGE_COLOR[job.statusCategory || ''] || '#c88c00';

  // Group line items by status, preserving the priority order. Items
  // sort alphabetically by name within each status block.
  const itemsByStatus = useMemo(() => {
    const buckets: Record<string, SelectionItem[]> = {};
    for (const s of STATUS_CONFIG) buckets[s.jtValue] = [];
    for (const item of job.items) {
      if (buckets[item.status]) buckets[item.status].push(item);
    }
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return buckets;
  }, [job]);

  return (
    <div
      className="rounded-xl"
      style={{
        background: '#ffffff',
        border: '1px solid rgba(200,140,0,0.15)',
      }}
    >
      {/* Header row - always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 rounded-xl"
      >
        {expanded ? (
          <ChevronDown size={16} style={{ color: '#8a8078' }} />
        ) : (
          <ChevronRight size={16} style={{ color: '#8a8078' }} />
        )}

        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
          style={{ background: '#222', color: '#f0c060', fontWeight: 600 }}
        >
          #{job.jobNumber || '—'}
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: '#1a1a1a' }}>
            {job.clientName || 'No client'}
          </div>
          <div className="text-[11px] truncate" style={{ color: '#8a8078' }}>
            {job.jobName}
          </div>
        </div>

        {stageLabel && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded shrink-0"
            style={{ background: stageBg, color: stageColor }}
          >
            {stageLabel}
          </span>
        )}

        {/* Inline counters - one chip per status that has items */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          {STATUS_CONFIG.map((s) => {
            const count = job.counts[s.key];
            if (count === 0) return null;
            return (
              <span
                key={s.key}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
                title={`${count} ${s.label.toLowerCase()}`}
              >
                {count} {s.shortLabel}
              </span>
            );
          })}
        </div>

        {job.actionableCount > 0 ? (
          <span
            className="text-xs font-semibold shrink-0 hidden sm:inline-flex items-center gap-1"
            style={{ color: '#b91c1c' }}
          >
            <AlertCircle size={12} />
            {job.actionableCount} to finalize
          </span>
        ) : (
          <span
            className="text-xs shrink-0 hidden sm:inline-flex items-center gap-1"
            style={{ color: '#15803d' }}
          >
            <CheckCircle2 size={12} />
            All ordered
          </span>
        )}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t" style={{ borderColor: 'rgba(200,140,0,0.10)' }}>
          {STATUS_CONFIG.map((s) => {
            const items = itemsByStatus[s.jtValue] || [];
            if (items.length === 0) return null;
            return (
              <div
                key={s.key}
                className="rounded-lg"
                style={{
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  opacity: s.actionable ? 1 : 0.75,
                }}
              >
                <div
                  className="px-3 py-1.5 flex items-center gap-2 text-xs font-semibold"
                  style={{ color: s.color, borderBottom: `1px solid ${s.border}` }}
                >
                  <ClipboardList size={12} />
                  {s.label}
                  <span className="ml-auto text-[10px] font-normal" style={{ color: s.color }}>
                    {items.length}
                  </span>
                </div>
                <div className="divide-y" style={{ borderColor: s.border }}>
                  {items.map((it) => (
                    <SelectionRow
                      key={it.id}
                      item={it}
                      jobId={job.jobId}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <div className="text-[10px] flex items-center justify-end" style={{ color: '#8a8078' }}>
            <a
              href={`https://app.jobtread.com/jobs/${job.jobId}/budget`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:underline"
              style={{ color: '#c88c00' }}
            >
              Open job budget in JobTread <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Single selection row inside a status block
// ============================================================

function SelectionRow({ item, jobId }: { item: SelectionItem; jobId: string }) {
  const groupLabel = item.parentGroupName
    ? `${item.parentGroupName} › ${item.costGroupName}`
    : item.costGroupName;
  return (
    <div className="px-3 py-2 flex items-start gap-3 text-xs" style={{ background: '#ffffff' }}>
      {item.costCodeNumber && (
        <span
          className="font-mono shrink-0 mt-0.5"
          style={{ color: '#8a8078' }}
          title={item.costCodeName}
        >
          {item.costCodeNumber}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate" style={{ color: '#1a1a1a' }}>
          {item.name || '(unnamed)'}
        </div>
        {groupLabel && (
          <div className="text-[10px] truncate" style={{ color: '#8a8078' }}>
            {groupLabel}
          </div>
        )}
      </div>
      {item.cost > 0 && (
        <span className="font-mono shrink-0" style={{ color: '#5a5550' }}>
          ${Math.round(item.cost).toLocaleString()}
        </span>
      )}
      <a
        href={`https://app.jobtread.com/jobs/${jobId}/budget`}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 hover:opacity-80"
        title="Open in JobTread"
        style={{ color: '#c88c00' }}
      >
        <ExternalLink size={12} />
      </a>
    </div>
  );
}
