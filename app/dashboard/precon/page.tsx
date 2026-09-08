// @ts-nocheck
'use client';

/**
 * Pre-Construction Dashboard
 *
 * Selections Overview, version 2 (register-aware, 2026-09-08).
 * Selections lead the page; the In-Design Gantt is collapsed at the
 * bottom (Nathan, 2026-09-08).
 *
 * Reads the 📜 Selections decision register on every active job per
 * claude/BKB-Selections-System-Spec.md (JobTread Assistant project):
 * one line per decision, Status never blank, statuses 0-4 are open work
 * and 5 is done. Register-health flags (strays, missing markers, blank
 * statuses, no register at all) surface here so the registers stay
 * clean. The Client Selections Sheet (branded print/PDF + public share
 * link) is folded into each job card - the standalone tab is retired.
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
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
// Master In-Design calendar lives in its own component so the page
// file stays focused. Renders above the Selections Tracker per the
// pre-con coordinator's request.
import SchedulesCalendar from './SchedulesCalendar';

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
  // Register-health flags (see the selections system spec).
  inRegister?: boolean;
  stray?: boolean;          // selection-marked/statused but OUTSIDE the register
  missingMarker?: boolean;  // in register but Selection custom field not set
  blankStatus?: boolean;    // Status was blank (shown under Not Started)
  supportLine?: boolean;    // isSpecification=false (Shipping, Templating, ...)
  // Free-form "Internal Notes" custom field from JT. Used by the
  // coordinator to log the latest update on the selection (e.g.
  // "vendor confirmed 6-week lead time", "waiting on Kim's pick").
  // Surfaced inline so Allison doesn't have to bounce into JT.
  internalNotes?: string;
}

interface JobBlock {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  customStatus: string | null;
  statusCategory: 'IN_DESIGN' | 'READY' | 'IN_PRODUCTION' | string | null;
  counts: {
    notStarted: number;
    clientSelectionNeeded: number;
    internalSelectionNeeded: number;
    pricingPending: number;
    selectedNeedsOrder: number;
    orderedFinalized: number;
  };
  actionableCount: number;
  items: SelectionItem[];
  // Register health + sheet link.
  hasRegister?: boolean;
  registerName?: string | null;
  registerNameVariant?: boolean;
  strayCount?: number;
  missingMarkerCount?: number;
  blankStatusCount?: number;
  sheetPath?: string | null;
}

interface NeedsSetupJob {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  statusCategory: string | null;
  customStatus: string | null;
  reason: 'no-register' | 'empty-register';
}

interface Totals {
  jobCount: number;
  actionable: number;
  strays: number;
  blankStatuses: number;
  needsSetupCount: number;
  notStarted: number;
  clientSelectionNeeded: number;
  internalSelectionNeeded: number;
  pricingPending: number;
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
    key: 'notStarted',
    jtValue: '0. Not Started',
    label: 'Not Started',
    shortLabel: 'Not Started',
    // Neutral stone - a decision that exists on the register but nobody
    // has picked up yet. Open work per the spec (statuses 0-3 = open).
    color: '#57534e',
    bg: 'rgba(120,113,108,0.08)',
    border: 'rgba(120,113,108,0.25)',
    actionable: true,
  },
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
    key: 'pricingPending',
    jtValue: '3. Pricing Pending',
    label: 'Pricing Pending',
    shortLabel: 'Pricing',
    // Indigo - distinct from the warmer amber above and the cooler
    // blue below, so the eye can sweep across the four-stage funnel.
    color: '#6d28d9',
    bg: 'rgba(124,58,237,0.08)',
    border: 'rgba(124,58,237,0.25)',
    actionable: true,
  },
  {
    key: 'selectedNeedsOrder',
    jtValue: '4. Selected/Needs Order',
    label: 'Selected, Needs Order',
    shortLabel: 'Order',
    color: '#1e40af',
    bg: 'rgba(59,130,246,0.08)',
    border: 'rgba(59,130,246,0.25)',
    actionable: true,
  },
  {
    key: 'orderedFinalized',
    jtValue: '5. Ordered/Finalized',
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
  const [needsSetup, setNeedsSetup] = useState<NeedsSetupJob[]>([]);
  // The In-Design Gantt is secondary on this page (Nathan, 2026-09-08:
  // "we are looking at the selections, not the schedule"). Collapsed by
  // default; the component only mounts when opened.
  const [scheduleOpen, setScheduleOpen] = useState(false);
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
      setNeedsSetup(data.needsSetup || []);
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
    const filtered = jobs.filter((j) => {
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
    // A-Z by client name (the field operators scan first), tiebreak on
    // job name so two jobs for the same client stay grouped together.
    // The API returns rows ordered by actionable backlog; the precon
    // coordinator asked for alphabetical instead so the eye can find a
    // specific project quickly.
    filtered.sort((a, b) => {
      const aKey = (a.clientName || a.jobName || '').toLowerCase().trim();
      const bKey = (b.clientName || b.jobName || '').toLowerCase().trim();
      if (aKey !== bKey) return aKey.localeCompare(bKey);
      return (a.jobName || '').toLowerCase().localeCompare((b.jobName || '').toLowerCase());
    });
    return filtered;
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
            Every active project's selections, pulled from the 📜 Selections register in each job's budget: what's open, what needs to be worked, register health, and the client sheet. The in-design schedule calendar is tucked at the bottom.
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
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
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

          {/* Projects with no selections tracking yet. Kept separate from
              the cards so the main list stays a working queue, but visible
              enough that a design/production job with no register can't
              hide. */}
          {needsSetup.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: '#fdfcfa', border: '1px dashed rgba(200,140,0,0.35)' }}>
              <div className="flex items-center gap-2 text-xs font-semibold mb-2" style={{ color: '#a06f00' }}>
                <AlertCircle size={13} />
                No selections register yet ({needsSetup.length})
                <span className="font-normal" style={{ color: '#8a8078' }}>
                  - active projects with nothing tracked. Ask Claude to build the 📜 Selections register.
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {needsSetup.map((j) => (
                  <span
                    key={j.jobId}
                    className="text-[11px] px-2 py-1 rounded inline-flex items-center gap-1.5"
                    style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.18)', color: '#3d3a36' }}
                    title={`${j.jobName}${j.reason === 'empty-register' ? ' - has a 📜 Selections group but no lines in it' : ' - no 📜 Selections group on the budget'}`}
                  >
                    <span className="font-mono" style={{ color: '#a06f00' }}>#{j.jobNumber || '—'}</span>
                    {j.clientName || j.jobName}
                    <span
                      className="text-[9px] px-1 py-px rounded"
                      style={{
                        background: STAGE_BG[j.statusCategory || ''] || 'rgba(200,140,0,0.10)',
                        color: STAGE_COLOR[j.statusCategory || ''] || '#c88c00',
                      }}
                    >
                      {STAGE_LABEL[j.statusCategory || ''] || j.customStatus || ''}
                    </span>
                    {j.reason === 'empty-register' && (
                      <span className="text-[9px]" style={{ color: '#8a8078' }}>empty register</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Job cards */}
          {filteredJobs.length === 0 ? (
            <div
              className="rounded-xl p-8 text-center text-sm"
              style={{ background: '#fdfcfa', border: '1px solid rgba(200,140,0,0.12)', color: '#8a8078' }}
            >
              {jobs.length === 0
                ? 'No active jobs have any register selections yet.'
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

      {/* In-Design Schedule - moved BELOW the selections overview and
          collapsed by default (Nathan, 2026-09-08: this page is about the
          selections pulled from the job budgets; the schedule is secondary).
          The Gantt component only mounts when the section is opened, so the
          selections view is what loads first. */}
      <div className="rounded-xl" style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.12)' }}>
        <button
          type="button"
          onClick={() => setScheduleOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-stone-50 rounded-xl"
        >
          {scheduleOpen ? (
            <ChevronDown size={16} style={{ color: '#8a8078' }} />
          ) : (
            <ChevronRight size={16} style={{ color: '#8a8078' }} />
          )}
          <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
            In-Design Schedule Gantt
          </span>
          <span className="text-xs" style={{ color: '#8a8078' }}>
            {scheduleOpen ? 'design-phase schedule calendar' : 'click to open the design-phase schedule calendar'}
          </span>
        </button>
        {scheduleOpen && (
          <div className="px-2 pb-2">
            <SchedulesCalendar />
          </div>
        )}
      </div>
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
      {/* Header row - always visible. A div (not <button>) so the Client
          Sheet link + copy control can nest inside without invalid HTML. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
        }}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 rounded-xl cursor-pointer"
      >
        {expanded ? (
          <ChevronDown size={16} style={{ color: '#8a8078' }} />
        ) : (
          <ChevronRight size={16} style={{ color: '#8a8078' }} />
        )}

        {/* Subtle gold-tinted badge that lives inside the dashboard
            palette instead of the high-contrast black+yellow chip used
            elsewhere in the hub. Same content, less visual noise. */}
        <span
          className="text-[11px] font-mono px-1.5 py-0.5 rounded shrink-0"
          style={{
            background: 'rgba(200,140,0,0.10)',
            color: '#a06f00',
            border: '1px solid rgba(200,140,0,0.20)',
            fontWeight: 600,
          }}
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

        {/* Register-health warning chip - only when something is off. */}
        {(() => {
          const problems: string[] = [];
          if (!job.hasRegister) problems.push('no 📜 Selections register - lines tracked outside it');
          if (job.registerNameVariant && job.registerName) problems.push(`register named "${job.registerName}" - rename to 📜 Selections`);
          if ((job.strayCount || 0) > 0) problems.push(`${job.strayCount} selection line${job.strayCount === 1 ? '' : 's'} outside the register (invisible to the Design Board)`);
          if ((job.blankStatusCount || 0) > 0) problems.push(`${job.blankStatusCount} line${job.blankStatusCount === 1 ? '' : 's'} with blank Status`);
          if ((job.missingMarkerCount || 0) > 0) problems.push(`${job.missingMarkerCount} register line${job.missingMarkerCount === 1 ? '' : 's'} missing the Selection marker`);
          if (problems.length === 0) return null;
          return (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 hidden sm:inline-flex items-center gap-1"
              style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.25)' }}
              title={'Register health:\n- ' + problems.join('\n- ')}
            >
              <AlertCircle size={10} /> register
            </span>
          );
        })()}

        {job.actionableCount > 0 ? (
          <span
            className="text-xs font-semibold shrink-0 hidden sm:inline-flex items-center gap-1"
            style={{ color: '#b91c1c' }}
          >
            <AlertCircle size={12} />
            {job.actionableCount} open
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

        {/* Client Selections Sheet - branded, client-safe print/PDF page.
            Opens the tokened public link; the copy control puts the same
            link on the clipboard for texting/emailing the client. */}
        {job.sheetPath && (
          <span className="shrink-0 hidden sm:inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <a
              href={job.sheetPath}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] font-semibold px-2 py-1 rounded inline-flex items-center gap-1 hover:opacity-80"
              style={{ background: 'rgba(200,140,0,0.10)', color: '#a06f00', border: '1px solid rgba(200,140,0,0.25)' }}
              title="Open the client-facing Selections Sheet (print / save as PDF from there)"
            >
              <ClipboardList size={10} /> Client Sheet
            </a>
            <CopySheetLinkButton sheetPath={job.sheetPath} />
          </span>
        )}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t" style={{ borderColor: 'rgba(200,140,0,0.10)' }}>
          {/* Register health callout - expanded view spells out what the
              header chip summarized, so the fix is obvious. */}
          {(!job.hasRegister || job.registerNameVariant || (job.strayCount || 0) > 0 || (job.blankStatusCount || 0) > 0 || (job.missingMarkerCount || 0) > 0) && (
            <div
              className="rounded-lg px-3 py-2 text-[11px] space-y-0.5"
              style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.18)', color: '#7f1d1d' }}
            >
              <div className="font-semibold text-xs flex items-center gap-1.5" style={{ color: '#b91c1c' }}>
                <AlertCircle size={12} /> Register housekeeping
              </div>
              {!job.hasRegister && <div>No 📜 Selections group on this budget - the lines below are tracked loose. Ask Claude to build the register.</div>}
              {job.registerNameVariant && job.registerName && <div>Register group is named "{job.registerName}" - should be exactly 📜 Selections.</div>}
              {(job.strayCount || 0) > 0 && <div>{job.strayCount} selection line{(job.strayCount || 0) === 1 ? ' sits' : 's sit'} outside the register (rows marked "stray" below) - invisible to the Design Board.</div>}
              {(job.blankStatusCount || 0) > 0 && <div>{job.blankStatusCount} line{(job.blankStatusCount || 0) === 1 ? ' has' : 's have'} a blank Status (shown under Not Started) - Status should never be blank.</div>}
              {(job.missingMarkerCount || 0) > 0 && <div>{job.missingMarkerCount} register line{(job.missingMarkerCount || 0) === 1 ? ' is' : 's are'} missing the Selection custom-field marker.</div>}
            </div>
          )}
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
  const notes = (item.internalNotes || '').trim();
  return (
    <div className="px-3 py-2 flex flex-col gap-1.5 text-xs" style={{ background: '#ffffff' }}>
      <div className="flex items-start gap-3">
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
          <div className="font-medium truncate flex items-center gap-1.5" style={{ color: '#1a1a1a' }}>
            <span className="truncate">{item.name || '(unnamed)'}</span>
            {item.stray && (
              <span className="text-[9px] font-semibold px-1 py-px rounded shrink-0" title="Outside the 📜 Selections register - invisible to the Design Board. Move it into the register." style={{ background: 'rgba(239,68,68,0.10)', color: '#b91c1c' }}>stray</span>
            )}
            {item.blankStatus && (
              <span className="text-[9px] font-semibold px-1 py-px rounded shrink-0" title="Status field is blank in JobTread - set it (0. Not Started at minimum)." style={{ background: 'rgba(234,179,8,0.15)', color: '#a16207' }}>no status</span>
            )}
            {item.missingMarker && (
              <span className="text-[9px] font-semibold px-1 py-px rounded shrink-0" title="In the register but the Selection custom field is not set to true." style={{ background: 'rgba(234,179,8,0.15)', color: '#a16207' }}>no marker</span>
            )}
            {item.supportLine && (
              <span className="text-[9px] px-1 py-px rounded shrink-0" title="Support line (isSpecification = false) - shipping, templating, install, allowance credit. Not a client-facing decision." style={{ background: 'rgba(120,113,108,0.10)', color: '#57534e' }}>support</span>
            )}
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
      {/* Internal Notes - rendered only when set. Uses whitespace-pre-wrap
          so multi-line notes (e.g. "Vendor confirmed 6-week lead time.\n
          Waiting on Kim's pick.") read naturally. Indented under the
          item name so it visually belongs to that row. */}
      {notes && (
        <div
          className="ml-7 text-[11px] rounded px-2 py-1 whitespace-pre-wrap"
          style={{
            background: 'rgba(200,140,0,0.06)',
            border: '1px solid rgba(200,140,0,0.15)',
            color: '#3d3a36',
          }}
        >
          <span className="text-[9px] uppercase tracking-wide font-semibold mr-1.5" style={{ color: '#8a8078' }}>
            Notes
          </span>
          {notes}
        </div>
      )}
    </div>
  );
}


// ============================================================
// Copy-share-link button for a job's Client Selections Sheet.
// Small, self-contained so each card header can drop one in.
// ============================================================

function CopySheetLinkButton({ sheetPath }: { sheetPath: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        const url = window.location.origin + sheetPath;
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="text-[10px] px-1.5 py-1 rounded inline-flex items-center hover:opacity-80"
      style={{
        background: copied ? 'rgba(34,197,94,0.10)' : 'rgba(200,140,0,0.06)',
        color: copied ? '#15803d' : '#8a8078',
        border: `1px solid ${copied ? 'rgba(34,197,94,0.30)' : 'rgba(200,140,0,0.20)'}`,
      }}
      title="Copy the client share link (no login needed)"
    >
      {copied ? <CheckCircle2 size={11} /> : <LinkIcon size={11} />}
    </button>
  );
}
