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
  Search, Filter, Zap, Tag, Clock, ChevronDown,
} from 'lucide-react';
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

type ReviewRow = {
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

      {/* Rows */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #e8e5e0' }}>
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
            {filteredRows.map((row, idx) => {
              const meta = ISSUE_META[row.issue_type] || ISSUE_META.uncategorized;
              const Icon = meta.icon;
              const candidates = row.candidate_budget_items || [];
              const currentPick = pickedCandidate[row.id] || row.suggested_job_cost_item_id || '';
              const confidence = row.match_confidence || 0;
              const isActing = actingId === row.id;

              return (
                <div
                  key={row.id}
                  style={{
                    padding: '14px 16px',
                    borderBottom: idx < filteredRows.length - 1 ? '1px solid #e8e5e0' : 'none',
                  }}
                >
                  {/* Top row — issue pill, vendor, amount */}
                  <div className="flex items-start gap-3 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
                      style={{ background: meta.bg, color: meta.color }}
                    >
                      <Icon size={11} /> {meta.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                        {row.vendor_name || 'Unknown vendor'}
                        {row.document_number ? ` · Bill #${row.document_number}` : ''}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: '#8a8078' }}>
                        {row.job_name}
                        {row.line_name ? ` · ${row.line_name}` : ''}
                      </div>
                    </div>
                    <div className="text-right" style={{ color: '#1a1a1a' }}>
                      <div className="text-sm font-semibold">{formatMoney(row.line_cost)}</div>
                      <div className="text-xs" style={{ color: '#8a8078' }}>
                        {timeAgo(row.first_seen_at)}
                      </div>
                    </div>
                  </div>

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

                  {/* Suggestion + dropdown + buttons */}
                  {row.issue_type === 'budget_gap' ? (
                    <div className="mt-3 p-3 rounded-lg text-sm" style={{ background: '#dbeafe', color: '#1e40af' }}>
                      No budget item exists for cost code{' '}
                      <strong>{row.line_cost_code_number}</strong> on this job. Add a budget line in
                      JobTread, then re-run the scan.
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => dismissRow(row)}
                          disabled={isActing}
                          className="px-3 py-1 rounded text-xs"
                          style={{ background: '#ffffff', border: '1px solid #bfdbfe', color: '#1e40af' }}
                        >
                          {isActing ? <Loader2 size={12} className="inline animate-spin" /> : 'Acknowledge'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <Tag size={12} style={{ color: '#8a8078' }} />
                      <span className="text-xs" style={{ color: '#8a8078' }}>Apply to:</span>

                      {candidates.length > 0 ? (
                        <select
                          value={currentPick}
                          onChange={(e) =>
                            setPickedCandidate(prev => ({ ...prev, [row.id]: e.target.value }))
                          }
                          className="px-2 py-1.5 rounded text-xs"
                          style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#1a1a1a', minWidth: 280 }}
                        >
                          {candidates.map((c) => (
                            <option key={c.jobCostItemId} value={c.jobCostItemId}>
                              {c.costCodeNumber ? `${c.costCodeNumber} · ` : ''}{c.name || 'Unnamed'}
                              {' '}
                              ({Math.round((c.score || 0) * 100)}% — {c.reason})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs italic" style={{ color: '#b91c1c' }}>
                          No candidate budget items — pick one in JT or dismiss
                        </span>
                      )}

                      {candidates.length > 0 && confidence > 0 && (
                        <span className="text-xs" style={{ color: '#8a8078' }}>
                          {Math.round(confidence * 100)}% confident
                          {row.match_source === 'learned_pattern' ? ' (learned)' : ''}
                        </span>
                      )}

                      <button
                        onClick={() => approveRow(row)}
                        disabled={isActing || candidates.length === 0}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium ml-auto"
                        style={{
                          background: '#68050a', color: '#ffffff',
                          border: '1px solid #68050a',
                          opacity: (isActing || candidates.length === 0) ? 0.5 : 1,
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
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
