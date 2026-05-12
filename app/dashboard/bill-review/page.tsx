// @ts-nocheck
'use client';

/**
 * /dashboard/bill-review
 *
 * Review queue for the nightly bill-categorization agent. Shows every
 * flagged vendor-bill line with:
 *   - what's wrong (uncategorized / miscategorized / budget gap)
 *   - the top suggestion (auto-selected)
 *   - a dropdown of alternative budget items (so Nathan can pick
 *     anything without clicking into JT)
 *   - one-click Apply / Dismiss buttons
 *
 * Nathan's UX requirement: "single button click or a drop down with
 * selector on the review dashboard so it did not force me to click
 * around in a lot of areas". Every row is self-contained — no modal,
 * no navigation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Check, X, Loader2, AlertTriangle, HelpCircle, PieChart,
  Search, Filter, Zap, Tag, Clock, ChevronDown, ChevronRight,
  ExternalLink, FileText, CheckSquare, Square, Brain,
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '../../hooks/useAuth';

type Candidate = {
  jobCostItemId: string;
  name: string | null;
  costCodeNumber: string | null;
  costCodeName: string | null;
  costCodeId?: string | null;
  budgetCost?: number;
  reason: string;
  score: number;
};

// Carry status + last_error so the UI can highlight rows that previously
// failed an apply attempt (so the user knows to retry rather than treating
// them as fresh).
type ReviewRow = {
  last_error?: string | null;
  id: string;
  job_id: string;
  job_name: string;
  job_number: string | null;
  document_id: string;
  document_number: string | null;
  cost_item_id: string;
  vendor_name: string | null;
  vendor_account_id: string | null;
  line_name: string | null;
  line_description: string | null;
  line_cost: number | null;
  line_cost_code_number: string | null;
  line_cost_code_name: string | null;
  current_job_cost_item_id: string | null;
  current_budget_cost_code_number: string | null;
  current_budget_cost_code_name: string | null;
  issue_type: 'uncategorized' | 'miscategorized' | 'budget_gap';
  suggested_job_cost_item_id: string | null;
  suggested_budget_item_name: string | null;
  suggested_cost_code_number: string | null;
  suggested_cost_code_name: string | null;
  match_source: string | null;
  match_confidence: number | null;
  candidate_budget_items: Candidate[] | null;
  status: string;
  first_seen_at: string;
  // JT bill issueDate (text, e.g. "2026-03-04"). Null on queue rows from
  // before migration 014 — UI falls back to first_seen_at relative time.
  document_issue_date?: string | null;
};

type Stats = {
  pendingTotal: number;
  pendingByType: { uncategorized: number; miscategorized: number; budget_gap: number };
  byJob: Array<{
    jobId: string; jobName: string; jobNumber: string | null;
    uncategorized: number; miscategorized: number; budgetGap: number; total: number;
  }>;
  lastScan: {
    started_at: string;
    finished_at: string | null;
    jobs_scanned: number;
    lines_scanned: number;
    newly_flagged: number;
    auto_cleared: number;
    error_count: number;
  } | null;
};

const ISSUE_META: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  uncategorized: { label: 'Uncategorized',   color: '#b91c1c', bg: '#fee2e2', icon: HelpCircle },
  miscategorized: { label: 'Possibly miscategorized', color: '#c88c00', bg: '#fef3c7', icon: AlertTriangle },
  budget_gap:    { label: 'Budget gap',       color: '#1e40af', bg: '#dbeafe', icon: PieChart },
};

const FILTERS = [
  { id: 'all',            label: 'All',                 type: null },
  { id: 'uncategorized',  label: 'Uncategorized',       type: 'uncategorized' },
  { id: 'miscategorized', label: 'Possibly miscategorized', type: 'miscategorized' },
  { id: 'budget_gap',     label: 'Budget gap',          type: 'budget_gap' },
];

function formatMoney(n: number | null | undefined) {
  if (n == null) return '$0';
  return `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  const d = Math.floor(hrs / 24);
  return `${d}d ago`;
}

// Format the JT bill date (issueDate) as "Mar 4, 2026". Accepts either an
// ISO-8601 timestamp or a plain "YYYY-MM-DD" date (which is what JT returns
// for issueDate). When the date is JT's date-only form, we tack a noon UTC
// time on it so the locale conversion doesn't flip it back a day in
// negative UTC offsets.
function formatBillDate(value: string | null | undefined): string {
  if (!value) return '';
  const s = value.trim();
  if (!s) return '';
  const isoCandidate = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s;
  const d = new Date(isoCandidate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BillReviewPage() {
  const auth = useAuth();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [jobFilter, setJobFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);
  const [pickedCandidate, setPickedCandidate] = useState<Record<string, string>>({});
  const [lastError, setLastError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Row IDs the user has checked for bulk-approve. We only allow bulk-
  // approve on rows that have at least one candidate budget item.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Bulk-action progress: when running, shows "Applying N of M…" so the
  // user knows it's working through the queue.
  const [bulk, setBulk] = useState<{ done: number; total: number; failed: number } | null>(null);
  // Per-row "show description" toggle — line_description from the JT bill
  // can be long, so we collapse by default and let the user expand.
  const [showDesc, setShowDesc] = useState<Set<string>>(new Set());

  // Searchable picker state: which row's picker is currently open, the
  // current search query, and a per-job cache of all approved budget items
  // (fetched lazily on first open of a row in that job).
  type BudgetItem = {
    id: string;
    name: string | null;
    costCodeId: string | null;
    costCodeNumber: string | null;
    costCodeName: string | null;
    cost: number;
  };
  const [openPickerRowId, setOpenPickerRowId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [budgetItemsCache, setBudgetItemsCache] = useState<Record<string, BudgetItem[]>>({});
  const [budgetItemsLoading, setBudgetItemsLoading] = useState<Record<string, boolean>>({});
  // Direction to open the picker popover ('down' below the button, 'up'
  // above it). Computed at open time from the button's bounding rect so
  // the dropdown flips up when the row is too close to the bottom of the
  // viewport (the common case being one-row-left in the queue).
  const [pickerOpenDir, setPickerOpenDir] = useState<'down' | 'up'>('down');

  // Close picker when clicking outside of it.
  useEffect(() => {
    if (!openPickerRowId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(`[data-picker-row="${openPickerRowId}"]`)) {
        setOpenPickerRowId(null);
        setPickerSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openPickerRowId]);

  async function fetchBudgetItemsForJob(jobId: string) {
    if (budgetItemsCache[jobId] || budgetItemsLoading[jobId]) return;
    setBudgetItemsLoading(prev => ({ ...prev, [jobId]: true }));
    try {
      const res = await fetch(`/api/dashboard/bill-review/budget-items?jobId=${encodeURIComponent(jobId)}`, { headers });
      const json = await res.json();
      if (res.ok) {
        setBudgetItemsCache(prev => ({ ...prev, [jobId]: json.items || [] }));
      }
    } catch { /* swallow — picker will fall back to candidates only */ }
    setBudgetItemsLoading(prev => ({ ...prev, [jobId]: false }));
  }

  const token = typeof window !== 'undefined' ? localStorage.getItem('bkb-token') : null;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLastError(null);
    try {
      const params = new URLSearchParams({ limit: '500', includeStats: '1' });
      if (filter !== 'all') {
        const f = FILTERS.find(x => x.id === filter);
        if (f?.type) params.set('issueType', f.type);
      }
      if (jobFilter) params.set('jobId', jobFilter);
      const res = await fetch(`/api/dashboard/bill-review?${params.toString()}`, { headers });
      const json = await res.json();
      if (res.ok) {
        setRows(json.rows || []);
        setStats(json.stats || null);
      } else {
        setLastError(json.error || 'Failed to load queue');
      }
    } catch (err: any) {
      setLastError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, filter, jobFilter]);

  useEffect(() => { load(); }, [load]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      (r.vendor_name || '').toLowerCase().includes(q) ||
      (r.line_name || '').toLowerCase().includes(q) ||
      (r.job_name || '').toLowerCase().includes(q) ||
      (r.document_number || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  async function runScanNow() {
    if (!confirm('Kick off a fresh scan across all active jobs? This takes a few minutes.')) return;
    setRunning(true);
    try {
      const res = await fetch('/api/cron/categorize-bills?trigger=manual', {
        headers: {
          ...headers,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET || ''}`,
        },
      });
      const json = await res.json();
      if (!res.ok) alert(`Scan failed: ${json.error || res.status}`);
      else alert(
        `Scan complete\n` +
        `Jobs: ${json.jobsScanned}\n` +
        `Bills: ${json.billsScanned}\n` +
        `Lines: ${json.linesScanned}\n` +
        `Newly flagged: ${json.newlyFlagged}\n` +
        `Auto-cleared: ${json.autoCleared}`
      );
      await load();
    } finally {
      setRunning(false);
    }
  }

  async function approveRow(row: ReviewRow) {
    const picked = pickedCandidate[row.id] || row.suggested_job_cost_item_id;
    if (!picked) {
      alert('Pick a budget item first.');
      return;
    }
    setActingId(row.id);
    try {
      const res = await fetch(`/api/dashboard/bill-review/${row.id}/approve`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobCostItemId: picked, approvedBy: auth.userId || 'nathan' }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`Apply failed: ${json.error || res.status}`);
      } else {
        setRows(prev => prev.filter(r => r.id !== row.id));
      }
    } catch (err: any) {
      alert(`Apply failed: ${err.message}`);
    } finally {
      setActingId(null);
    }
  }

  // Rows eligible for bulk-approve: must have at least one candidate
  // (budget_gap rows can't be approved — only dismissed).
  const approvableRows = useMemo(
    () => filteredRows.filter(r => r.issue_type !== 'budget_gap' && (r.candidate_budget_items?.length || 0) > 0),
    [filteredRows]
  );

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const ids = approvableRows.map(r => r.id);
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id));
    if (allSelected) {
      // Deselect everything currently in approvableRows; keep any selections
      // for rows that aren't in the current filter view.
      setSelected(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
    }
  }

  // Bulk approve every selected row, sequentially. Sequential matters
  // because each approval writes back to JT and seeds the pattern store —
  // we don't want a fan-out that could rate-limit JT or race on the
  // pattern table. Each approval uses the user's picked candidate if set,
  // otherwise the top suggestion.
  async function bulkApprove() {
    const ids = approvableRows.filter(r => selected.has(r.id)).map(r => r.id);
    if (ids.length === 0) return;
    if (!confirm(`Approve ${ids.length} bill line${ids.length === 1 ? '' : 's'}? Each will be linked to its selected budget item in JobTread.`)) return;

    setBulk({ done: 0, total: ids.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const id of ids) {
      const row = filteredRows.find(r => r.id === id);
      if (!row) { done++; setBulk({ done, total: ids.length, failed }); continue; }
      const picked = pickedCandidate[id] || row.suggested_job_cost_item_id;
      if (!picked) { failed++; done++; setBulk({ done, total: ids.length, failed }); continue; }
      try {
        const res = await fetch(`/api/dashboard/bill-review/${id}/approve`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobCostItemId: picked, approvedBy: auth.userId || 'nathan' }),
        });
        if (res.ok) {
          // Optimistically remove from the visible list as each succeeds.
          setRows(prev => prev.filter(r => r.id !== id));
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      done++;
      setBulk({ done, total: ids.length, failed });
    }
    // Clear selection for processed IDs
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setBulk(null);
    if (failed > 0) alert(`${failed} approval${failed === 1 ? '' : 's'} failed. Refresh to see which lines are still pending.`);
  }

  async function bulkDismiss() {
    const ids = filteredRows.filter(r => selected.has(r.id)).map(r => r.id);
    if (ids.length === 0) return;
    if (!confirm(`Dismiss ${ids.length} bill line${ids.length === 1 ? '' : 's'}? They'll be marked OK and removed from the queue (no JobTread change).`)) return;

    setBulk({ done: 0, total: ids.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/dashboard/bill-review/${id}/dismiss`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Bulk-dismissed by Nathan', dismissedBy: auth.userId || 'nathan' }),
        });
        if (res.ok) setRows(prev => prev.filter(r => r.id !== id));
        else failed++;
      } catch {
        failed++;
      }
      done++;
      setBulk({ done, total: ids.length, failed });
    }
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setBulk(null);
    if (failed > 0) alert(`${failed} dismissal${failed === 1 ? '' : 's'} failed.`);
  }

  async function dismissRow(row: ReviewRow) {
    setActingId(row.id);
    try {
      const res = await fetch(`/api/dashboard/bill-review/${row.id}/dismiss`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Nathan marked OK', dismissedBy: auth.userId || 'nathan' }),
      });
      if (!res.ok) {
        const json = await res.json();
        alert(`Dismiss failed: ${json.error || res.status}`);
      } else {
        setRows(prev => prev.filter(r => r.id !== row.id));
      }
    } finally {
      setActingId(null);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#1a1a1a' }}>Bill Review</h1>
          <div className="text-sm mt-1" style={{ color: '#8a8078' }}>
            Flagged vendor-bill lines that need a budget-item link. Approve in one click; the agent
            learns from every match so repeat vendors auto-categorize next run.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/bill-review/patterns"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
            style={{
              background: '#ffffff',
              border: '1px solid rgba(79,70,229,0.30)',
              color: '#3730a3',
            }}
            title="See what the matcher has learned from your approvals"
          >
            <Brain size={14} />
            Learned Patterns
          </Link>
          <button
            onClick={runScanNow}
            disabled={running}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
            style={{
              background: '#68050a', color: '#ffffff',
              border: '1px solid #68050a', opacity: running ? 0.6 : 1,
            }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Scan now
          </button>
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
            style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#5a5550' }}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="flex items-center gap-4 mb-4 text-sm flex-wrap" style={{ color: '#5a5550' }}>
          <div>
            <strong style={{ color: '#1a1a1a' }}>{stats.pendingTotal}</strong> pending
          </div>
          <div style={{ color: ISSUE_META.uncategorized.color }}>
            {stats.pendingByType.uncategorized} uncategorized
          </div>
          <div style={{ color: ISSUE_META.miscategorized.color }}>
            {stats.pendingByType.miscategorized} possibly miscategorized
          </div>
          <div style={{ color: ISSUE_META.budget_gap.color }}>
            {stats.pendingByType.budget_gap} budget gaps
          </div>
          {stats.lastScan?.finished_at && (
            <div className="flex items-center gap-1 ml-auto" style={{ color: '#8a8078' }}>
              <Clock size={12} /> Last scan: {timeAgo(stats.lastScan.finished_at)}
              {' · '}{stats.lastScan.jobs_scanned} jobs
              {' · '}{stats.lastScan.newly_flagged} new flags
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {lastError && (
        <div className="mb-3 p-3 rounded-lg text-sm" style={{ background: '#fee2e2', color: '#b91c1c' }}>
          {lastError}
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => {
          const isActive = filter === f.id;
          const count = f.type
            ? stats?.pendingByType?.[f.type as keyof typeof stats.pendingByType] || 0
            : stats?.pendingTotal || 0;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm"
              style={{
                background: isActive ? '#68050a' : '#ffffff',
                color: isActive ? '#ffffff' : '#5a5550',
                border: '1px solid',
                borderColor: isActive ? '#68050a' : '#e8e5e0',
              }}
            >
              {f.label}
              <span className="inline-flex items-center justify-center rounded-full text-xs px-1.5"
                    style={{
                      background: isActive ? 'rgba(255,255,255,0.15)' : '#f8f6f3',
                      color: isActive ? '#ffffff' : '#8a8078', minWidth: 20,
                    }}>
                {count}
              </span>
            </button>
          );
        })}

        {/* Job filter — compact dropdown */}
        {stats && stats.byJob.length > 1 && (
          <select
            value={jobFilter || ''}
            onChange={(e) => setJobFilter(e.target.value || null)}
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#5a5550' }}
          >
            <option value="">All jobs ({stats.byJob.length})</option>
            {stats.byJob.map((j) => (
              <option key={j.jobId} value={j.jobId}>
                {j.jobName} — {j.total} pending
              </option>
            ))}
          </select>
        )}

        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8a8078' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor, line, job..."
            className="pl-9 pr-3 py-2 rounded-lg text-sm"
            style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#1a1a1a', minWidth: 260 }}
          />
        </div>
      </div>

      {/* Bulk action toolbar — only visible when at least one row is checked.
          Sticky-ish at the top of the rows table so it stays in view while
          the user scrolls through the queue. */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg"
          style={{ background: 'rgba(104,5,10,0.06)', border: '1px solid rgba(104,5,10,0.20)' }}
        >
          <span className="text-sm" style={{ color: '#68050a' }}>
            <strong>{selected.size}</strong> selected
            {bulk && (
              <span className="ml-2" style={{ color: '#5a5550' }}>
                · Applying {bulk.done} of {bulk.total}…
              </span>
            )}
          </span>
          <button
            onClick={bulkApprove}
            disabled={!!bulk}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium"
            style={{ background: '#68050a', color: '#ffffff', opacity: bulk ? 0.5 : 1 }}
          >
            {bulk ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Approve selected
          </button>
          <button
            onClick={bulkDismiss}
            disabled={!!bulk}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm"
            style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#5a5550', opacity: bulk ? 0.5 : 1 }}
          >
            <X size={13} /> Dismiss selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            disabled={!!bulk}
            className="text-xs px-2 py-1.5 rounded"
            style={{ color: '#8a8078' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Rows */}
      {/* Note: NOT using overflow-hidden here — the per-row "Apply to" picker
          is absolutely positioned, and clipping the container caused the
          dropdown to be cut off whenever the row sat near the bottom of the
          container (worst case: only one row left in the queue). The
          dropdown also auto-flips upward when there isn't room below the
          button, so both edge cases are covered. */}
      <div className="rounded-xl" style={{ background: '#ffffff', border: '1px solid #e8e5e0' }}>
        {loading ? (
          <div className="p-8 text-center" style={{ color: '#8a8078' }}>
            <Loader2 size={18} className="inline-block animate-spin mr-2" />
            Loading queue...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-10 text-center" style={{ color: '#8a8078' }}>
            <Check size={24} className="inline-block mb-2" style={{ color: '#15803d' }} />
            <div>All clear. Every bill line is categorized.</div>
          </div>
        ) : (
          <div>
            {/* Select-all header — only appears when there's at least one
                approvable row in the current filter view. Clicking toggles
                every approvable row in this view (budget_gap rows excluded). */}
            {approvableRows.length > 0 && (
              <div
                className="flex items-center gap-2 px-4 py-2 text-xs"
                style={{ background: '#faf8f5', borderBottom: '1px solid #e8e5e0', color: '#5a5550' }}
              >
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1.5"
                  style={{ color: '#5a5550' }}
                >
                  {approvableRows.length > 0 && approvableRows.every(r => selected.has(r.id))
                    ? <CheckSquare size={14} style={{ color: '#68050a' }} />
                    : <Square size={14} />}
                  Select all approvable ({approvableRows.length})
                </button>
              </div>
            )}
            {filteredRows.map((row, idx) => {
              const meta = ISSUE_META[row.issue_type] || ISSUE_META.uncategorized;
              const Icon = meta.icon;
              const candidates = row.candidate_budget_items || [];
              const currentPick = pickedCandidate[row.id] || row.suggested_job_cost_item_id || '';
              const confidence = row.match_confidence || 0;
              const isActing = actingId === row.id;
              const isApprovable = row.issue_type !== 'budget_gap' && candidates.length > 0;
              const isSelected = selected.has(row.id);
              const isDescOpen = showDesc.has(row.id);
              const jtBillUrl = row.job_id && row.document_id
                ? `https://app.jobtread.com/jobs/${row.job_id}/documents/${row.document_id}`
                : null;

              return (
                <div
                  key={row.id}
                  style={{
                    padding: '14px 16px',
                    borderBottom: idx < filteredRows.length - 1 ? '1px solid #e8e5e0' : 'none',
                  }}
                >
                  {/* Top row — checkbox, issue pill, vendor, JT deep link, amount */}
                  <div className="flex items-start gap-3 flex-wrap">
                    {/* Bulk-approve checkbox. Greyed out (but still clickable
                        for dismiss) when the row has no approvable candidate. */}
                    <button
                      type="button"
                      onClick={() => toggleSelect(row.id)}
                      className="mt-0.5 shrink-0"
                      title={isApprovable ? 'Select for bulk approve' : 'Row has no candidate — can only be bulk-dismissed'}
                      style={{ color: isSelected ? '#68050a' : '#8a8078' }}
                    >
                      {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: meta.bg, color: meta.color }}
                    >
                      <Icon size={11} /> {meta.label}
                    </span>
                    {/* Previous-apply-failed indicator. Surfaced when the row
                        is currently in 'failed' status (typically a prior JT
                        update threw) so the user knows it needs a retry. The
                        last_error tooltip is the raw JT message for diagnosis. */}
                    {row.status === 'failed' && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                        style={{
                          background: 'rgba(239,68,68,0.10)',
                          color: '#b91c1c',
                          border: '1px solid rgba(239,68,68,0.25)',
                        }}
                        title={row.last_error || 'Previous apply attempt failed — try again.'}
                      >
                        <AlertTriangle size={10} />
                        Previous apply failed — retry
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2 flex-wrap" style={{ color: '#1a1a1a' }}>
                        <span>
                          {row.vendor_name || 'Unknown vendor'}
                          {row.document_number ? ` · Bill #${row.document_number}` : ''}
                        </span>
                        {jtBillUrl && (
                          <a
                            href={jtBillUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded hover:underline"
                            style={{
                              background: 'rgba(99,102,241,0.10)',
                              color: '#3730a3',
                              border: '1px solid rgba(99,102,241,0.20)',
                            }}
                            title="Open this bill in JobTread (attachments are on the right-side panel)"
                          >
                            <ExternalLink size={10} />
                            Open bill in JobTread
                          </a>
                        )}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: '#8a8078' }}>
                        {row.job_name}
                        {row.line_name ? ` · ${row.line_name}` : ''}
                      </div>
                    </div>
                    <div className="text-right" style={{ color: '#1a1a1a' }}>
                      <div className="text-sm font-semibold">{formatMoney(row.line_cost)}</div>
                      <div className="text-xs" style={{ color: '#8a8078' }}>
                        {/* Real bill date from JT (document_issue_date).
                            No fallback to scanner first-seen time — the
                            scanner refresh date isn't useful information.
                            Shows a dash on the rare bill that has no
                            issueDate set in JT, or on queue rows from
                            before migration 014 (those clear on next scan). */}
                        {formatBillDate(row.document_issue_date) || '—'}
                      </div>
                    </div>
                  </div>

                  {/* Bill description — captured from JT at scan time. Collapsed
                      by default; click "Show description" to expand. Hidden
                      entirely when no description is present. */}
                  {row.line_description && row.line_description.trim().length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setShowDesc(prev => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })}
                        className="flex items-center gap-1 text-xs hover:underline"
                        style={{ color: '#5a5550' }}
                      >
                        {isDescOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        <FileText size={11} style={{ color: '#8a8078' }} />
                        {isDescOpen ? 'Hide description' : 'Show description from JobTread'}
                      </button>
                      {isDescOpen && (
                        <div
                          className="mt-1.5 p-2.5 rounded text-xs"
                          style={{
                            background: '#faf8f5',
                            border: '1px solid #e8e5e0',
                            color: '#1a1a1a',
                            whiteSpace: 'pre-wrap',
                            lineHeight: '1.5',
                          }}
                        >
                          {row.line_description}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Current state row */}
                  <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: '#5a5550' }}>
                    <span style={{ color: '#8a8078' }}>
                      Line cost code:{' '}
                      <strong style={{ color: '#1a1a1a' }}>
                        {row.line_cost_code_number || '—'}
                      </strong>
                      {row.line_cost_code_name ? ` (${row.line_cost_code_name})` : ''}
                    </span>
                    {row.issue_type === 'miscategorized' && row.current_budget_cost_code_number && (
                      <span style={{ color: '#c88c00' }}>
                        → currently linked to budget cc{' '}
                        <strong>{row.current_budget_cost_code_number}</strong>
                        {row.current_budget_cost_code_name ? ` (${row.current_budget_cost_code_name})` : ''}
                      </span>
                    )}
                  </div>

                  {/* Suggestion + dropdown + buttons.
                      Budget-gap rows get the same picker as uncategorized /
                      miscategorized rows so a bill that was tagged with the
                      wrong cost code can be re-linked to ANY approved budget
                      item on the job. The blue banner above the picker
                      explains the situation. */}
                  {row.issue_type === 'budget_gap' && (
                    <div className="mt-3 p-3 rounded-lg text-sm" style={{ background: '#dbeafe', color: '#1e40af' }}>
                      No budget item exists for cost code{' '}
                      <strong>{row.line_cost_code_number}</strong> on this job.
                      <div className="text-xs mt-1.5" style={{ color: '#1e3a8a' }}>
                        Two ways to clear this: <strong>(1)</strong> add the missing budget line in
                        JobTread and the next scan will resolve it automatically, or <strong>(2)</strong> if
                        the bill was tagged with the wrong cost code, pick the correct budget item
                        below and click <strong>Apply</strong> — that will re-tag the bill in JobTread.
                        Or click <strong>Dismiss</strong> if no action is needed.
                      </div>
                    </div>
                  )}
                  {(() => {
                    const _unused = row.issue_type; // keep block boundary
                    return (
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <Tag size={12} style={{ color: '#8a8078' }} />
                      <span className="text-xs" style={{ color: '#8a8078' }}>Apply to:</span>

                      {/* Searchable budget-item picker. Shows the matcher's
                          top suggestions at the top, then a search box that
                          filters the full list of approved budget items on
                          the job — so the user can route a bill to ANY real
                          budget bucket, not just the top 5 candidates. */}
                      {(() => {
                        // Find what to display in the closed picker button.
                        // Prefer the candidate match (carries score + reason),
                        // then the job's full budget item list, then a
                        // generic fallback.
                        const allItems = budgetItemsCache[row.job_id] || [];
                        const picked =
                          candidates.find(c => c.jobCostItemId === currentPick) ||
                          (currentPick
                            ? (() => {
                                const b = allItems.find(b => b.id === currentPick);
                                return b
                                  ? { jobCostItemId: b.id, name: b.name, costCodeNumber: b.costCodeNumber, costCodeName: b.costCodeName, costCodeId: b.costCodeId, score: 0, reason: 'Manually picked' }
                                  : null;
                              })()
                            : null);
                        const isOpen = openPickerRowId === row.id;
                        const isLoading = !!budgetItemsLoading[row.job_id];
                        const q = pickerSearch.trim().toLowerCase();
                        const candidateIds = new Set(candidates.map(c => c.jobCostItemId));
                        const filteredAll = q
                          ? allItems.filter(b => {
                              const hay = `${b.costCodeNumber || ''} ${b.name || ''} ${b.costCodeName || ''}`.toLowerCase();
                              return hay.includes(q);
                            })
                          : allItems;
                        // Always show all candidates in the suggested section,
                        // even when searching, so the user can fall back if
                        // the search matches nothing useful.
                        return (
                          <div data-picker-row={row.id} className="relative" style={{ minWidth: 320 }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                const next = isOpen ? null : row.id;
                                if (next) {
                                  // Measure room below the button vs the
                                  // dropdown's max height (380px). If not
                                  // enough room below AND there's more room
                                  // above, open upward.
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  const spaceBelow = window.innerHeight - rect.bottom;
                                  const spaceAbove = rect.top;
                                  const POPOVER_HEIGHT = 380;
                                  setPickerOpenDir(
                                    spaceBelow < POPOVER_HEIGHT + 20 && spaceAbove > spaceBelow
                                      ? 'up'
                                      : 'down'
                                  );
                                  void fetchBudgetItemsForJob(row.job_id);
                                }
                                setOpenPickerRowId(next);
                                setPickerSearch('');
                              }}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left"
                              style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#1a1a1a' }}
                            >
                              <span className="flex-1 truncate">
                                {picked ? (
                                  <>
                                    {picked.costCodeNumber ? <span style={{ color: '#8a8078' }}>{picked.costCodeNumber} · </span> : null}
                                    <span style={{ color: '#1a1a1a' }}>{picked.name || 'Unnamed'}</span>
                                    {picked.score > 0 && (
                                      <span style={{ color: '#8a8078' }}> · {Math.round(picked.score * 100)}%</span>
                                    )}
                                  </>
                                ) : (
                                  <span style={{ color: '#8a8078' }}>
                                    {candidates.length === 0 ? 'Pick any budget item…' : 'Pick a budget item…'}
                                  </span>
                                )}
                              </span>
                              <ChevronDown size={12} style={{ color: '#8a8078' }} />
                            </button>

                            {isOpen && (
                              <div
                                className="absolute z-20 left-0 right-0 rounded-lg shadow-lg"
                                style={{
                                  background: '#ffffff',
                                  border: '1px solid #e8e5e0',
                                  maxHeight: 380,
                                  overflow: 'hidden',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  // Flip up when there isn't enough room below
                                  // the button (computed in the click handler).
                                  ...(pickerOpenDir === 'up'
                                    ? { bottom: 'calc(100% + 4px)' }
                                    : { top: 'calc(100% + 4px)' }),
                                }}
                              >
                                <div className="p-2" style={{ borderBottom: '1px solid #f0ece6' }}>
                                  <div className="relative">
                                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: '#8a8078' }} />
                                    <input
                                      type="text"
                                      autoFocus
                                      value={pickerSearch}
                                      onChange={(e) => setPickerSearch(e.target.value)}
                                      placeholder="Search by cost code or name…"
                                      className="w-full pl-7 pr-2 py-1.5 rounded text-xs"
                                      style={{ background: '#faf8f5', border: '1px solid #e8e5e0', color: '#1a1a1a' }}
                                    />
                                  </div>
                                </div>
                                <div style={{ overflowY: 'auto', flex: 1 }}>
                                  {/* Suggested section */}
                                  {candidates.length > 0 && (
                                    <div>
                                      <div className="px-2 py-1 text-[10px] uppercase tracking-wide font-semibold" style={{ color: '#8a8078', background: '#faf8f5' }}>
                                        Suggested
                                      </div>
                                      {candidates
                                        .filter(c => !q || `${c.costCodeNumber || ''} ${c.name || ''}`.toLowerCase().includes(q))
                                        .map((c) => {
                                          const isPicked = c.jobCostItemId === currentPick;
                                          return (
                                            <button
                                              key={'sug-' + c.jobCostItemId}
                                              type="button"
                                              onClick={() => {
                                                setPickedCandidate(prev => ({ ...prev, [row.id]: c.jobCostItemId }));
                                                setOpenPickerRowId(null);
                                                setPickerSearch('');
                                              }}
                                              className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-stone-50"
                                              style={{ background: isPicked ? 'rgba(104,5,10,0.06)' : 'transparent' }}
                                            >
                                              {isPicked && <Check size={11} style={{ color: '#68050a' }} />}
                                              <span className="flex-1 min-w-0">
                                                {c.costCodeNumber && <span style={{ color: '#8a8078' }}>{c.costCodeNumber} · </span>}
                                                <span style={{ color: '#1a1a1a' }}>{c.name || 'Unnamed'}</span>
                                                <span className="block text-[10px]" style={{ color: '#8a8078' }}>
                                                  {Math.round((c.score || 0) * 100)}% · {c.reason}
                                                </span>
                                              </span>
                                            </button>
                                          );
                                        })}
                                    </div>
                                  )}
                                  {/* All approved budget items section. Exclude the
                                      ones already shown in Suggested to keep the list tidy. */}
                                  <div>
                                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide font-semibold flex items-center justify-between" style={{ color: '#8a8078', background: '#faf8f5' }}>
                                      <span>All approved budget items{allItems.length > 0 ? ` (${allItems.length})` : ''}</span>
                                      {isLoading && <Loader2 size={10} className="animate-spin" />}
                                    </div>
                                    {filteredAll.length === 0 && !isLoading ? (
                                      <div className="px-2 py-3 text-xs italic" style={{ color: '#8a8078' }}>
                                        {allItems.length === 0
                                          ? 'No approved budget items on this job.'
                                          : 'No items match the search.'}
                                      </div>
                                    ) : (
                                      filteredAll
                                        .filter(b => !candidateIds.has(b.id))
                                        .map((b) => {
                                          const isPicked = b.id === currentPick;
                                          return (
                                            <button
                                              key={'all-' + b.id}
                                              type="button"
                                              onClick={() => {
                                                setPickedCandidate(prev => ({ ...prev, [row.id]: b.id }));
                                                setOpenPickerRowId(null);
                                                setPickerSearch('');
                                              }}
                                              className="w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 hover:bg-stone-50"
                                              style={{ background: isPicked ? 'rgba(104,5,10,0.06)' : 'transparent' }}
                                            >
                                              {isPicked && <Check size={11} style={{ color: '#68050a' }} />}
                                              <span className="flex-1 min-w-0">
                                                {b.costCodeNumber && <span style={{ color: '#8a8078' }}>{b.costCodeNumber} · </span>}
                                                <span style={{ color: '#1a1a1a' }}>{b.name || 'Unnamed'}</span>
                                                {b.costCodeName && (
                                                  <span className="block text-[10px]" style={{ color: '#8a8078' }}>
                                                    {b.costCodeName}
                                                  </span>
                                                )}
                                              </span>
                                            </button>
                                          );
                                        })
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {candidates.length > 0 && confidence > 0 && (
                        <span className="text-xs" style={{ color: '#8a8078' }}>
                          {Math.round(confidence * 100)}% confident
                          {row.match_source === 'learned_pattern' ? ' (learned)' : ''}
                        </span>
                      )}

                      {/* Apply is enabled as long as something has been
                          picked — either a candidate or any budget item from
                          the searchable picker. */}
                      <button
                        onClick={() => approveRow(row)}
                        disabled={isActing || !currentPick}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium ml-auto"
                        style={{
                          background: '#68050a', color: '#ffffff',
                          border: '1px solid #68050a',
                          opacity: (isActing || !currentPick) ? 0.5 : 1,
                        }}
                      >
                        {isActing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Apply
                      </button>
                      <button
                        onClick={() => dismissRow(row)}
                        disabled={isActing}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-xs"
                        style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#5a5550' }}
                      >
                        <X size={12} /> Dismiss
                      </button>
                    </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
