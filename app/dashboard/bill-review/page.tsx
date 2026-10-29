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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Check, X, Loader2, AlertTriangle, HelpCircle, PieChart,
  Search, Filter, Zap, Tag, Clock, ChevronDown, ChevronRight, Flag,
  ExternalLink, FileText, CheckSquare, Square, Brain, DollarSign,
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
  // "Flag for Nathan" (migration 036). Set when someone escalates the row
  // instead of applying or dismissing it.
  flag_note?: string | null;
  flagged_by?: string | null;
  flagged_at?: string | null;
};

type Stats = {
  pendingTotal: number;
  pendingByType: { uncategorized: number; miscategorized: number; budget_gap: number };
  /** Rows escalated to Nathan. Not part of pendingTotal. */
  flaggedTotal?: number;
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
  // Its own view, not a slice of pending: a flagged row has left the
  // pending queue and is waiting on Nathan.
  { id: 'flagged',        label: 'Flagged for Nathan',  type: null, status: 'flagged' },
];

/**
 * BKB pricebook: the last two digits of a 4-digit cost code are the cost
 * type. 1602 = cost code 16, Subcontractor. Mirrors extractSubTypeToken()
 * in app/lib/bill-categorization.ts; the names here are JobTread's own
 * cost-type names (org has Labor / Materials / Subcontractor / Other /
 * Allowance / Selection).
 */
const SUB_TYPE_TO_COST_TYPE: Record<string, string> = {
  '01': 'Labor',
  '02': 'Subcontractor',
  '03': 'Materials',
};

/**
 * Parse what the user typed into the picker box. Codes only — no free text.
 *   ''      -> null              (show everything allowed)
 *   '16'    -> division 16
 *   '1602'  -> division 16 + Subcontractor
 * Anything else (letters, 1 or 3 digits, 5+) returns `invalid`, which the
 * picker renders as a hint rather than an empty list.
 */
/**
 * What to pre-fill the picker box with for a row: the bill line's own cost
 * code. A 4-digit code is kept whole when its last two digits are a type we
 * understand (01/02/03) — that narrows straight to the right bucket —
 * otherwise we fall back to the 2-digit division so the list isn't empty.
 */
function defaultCodeForRow(row: { line_cost_code_number?: string | null; suggested_cost_code_number?: string | null }): string {
  const raw = String(row.line_cost_code_number || row.suggested_cost_code_number || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4) {
    const four = digits.slice(0, 4);
    return SUB_TYPE_TO_COST_TYPE[four.slice(2)] ? four : four.slice(0, 2);
  }
  if (digits.length >= 2) return digits.slice(0, 2);
  return '';
}

function parseCodeQuery(raw: string): { division: string; costType: string | null } | 'invalid' | null {
  const q = (raw || '').trim();
  if (!q) return null;
  if (!/^\d+$/.test(q)) return 'invalid';
  if (q.length === 2) return { division: q, costType: null };
  if (q.length === 4) {
    const sub = q.slice(2);
    const costType = SUB_TYPE_TO_COST_TYPE[sub];
    if (!costType) return 'invalid';
    return { division: q.slice(0, 2), costType };
  }
  return 'invalid';
}

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
  // Per-row inline error message. Sticks visibly under the row when Apply or
  // Dismiss returns an error or the JT-side verification fails. Previously
  // these were one-shot `alert()` popups that some users dismissed without
  // reading, so the failure looked like "Apply did nothing."
  const [rowError, setRowError] = useState<Record<string, string>>({});
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
    /** JobTread cost type: "Labor" | "Materials" | "Subcontractor" | ... */
    costTypeName?: string | null;
    cost: number;
    // True when this budget item is on an approved CO. Fixed-price jobs
    // gate picker visibility on this (cc23 items are always allowed).
    // Cost-plus jobs ignore it.
    isApproved?: boolean;
  };
  // Declared before anything that lists `token` in a dependency array.
  // A hook's dependency array is evaluated during render, so a `const`
  // declared further down the component is still in its temporal dead zone
  // at that point — which crashed the whole page with "Cannot access 'x'
  // before initialization".
  const token = typeof window !== 'undefined' ? localStorage.getItem('bkb-token') : null;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const [openPickerRowId, setOpenPickerRowId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [budgetItemsCache, setBudgetItemsCache] = useState<Record<string, BudgetItem[]>>({});
  const [budgetItemsLoading, setBudgetItemsLoading] = useState<Record<string, boolean>>({});
  // Per-job cost-plus flag returned alongside the budget items. Used by
  // the picker to skip the "approved only" gate on cost-plus jobs.
  const [jobIsCostPlus, setJobIsCostPlus] = useState<Record<string, boolean>>({});
  // Direction to open the picker popover ('down' below the button, 'up'
  // above it). Computed at open time from the button's bounding rect so
  // the dropdown flips up when the row is too close to the bottom of the
  // viewport (the common case being one-row-left in the queue).
  const [pickerOpenDir, setPickerOpenDir] = useState<'down' | 'up'>('down');
  // "Flag for Nathan": which row's note box is open, and the note text.
  const [flagRowId, setFlagRowId] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState<Record<string, string>>({});

  // "Billables to bill": jobs carrying cost code 23 costs that haven't been
  // turned into a change order yet. Read from the cached invoicing report —
  // see /api/dashboard/bill-review/billables.
  const [billables, setBillables] = useState<any | null>(null);
  const [billablesOpen, setBillablesOpen] = useState(false);
  const [billablesJobOpen, setBillablesJobOpen] = useState<string | null>(null);

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

  // In-flight guard that survives re-renders. setState is async, so two
  // rows on the same job opening back-to-back both saw budgetItemsLoading
  // as false and fired duplicate fetches.
  const budgetFetchInFlight = useRef<Set<string>>(new Set());

  // Mirror of budgetItemsCache for the in-flight guard below (reading state
  // inside a useCallback would capture a stale snapshot). Declared before
  // the callback that reads it, same reason as token above.
  const budgetItemsCacheRef = useRef<Record<string, BudgetItem[]>>({});
  useEffect(() => { budgetItemsCacheRef.current = budgetItemsCache; }, [budgetItemsCache]);

  const fetchBudgetItemsForJob = useCallback(async (jobId: string) => {
    if (!jobId || !token) return;
    if (budgetItemsCacheRef.current[jobId] || budgetFetchInFlight.current.has(jobId)) return;
    budgetFetchInFlight.current.add(jobId);
    setBudgetItemsLoading(prev => ({ ...prev, [jobId]: true }));
    try {
      const res = await fetch(`/api/dashboard/bill-review/budget-items?jobId=${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setBudgetItemsCache(prev => ({ ...prev, [jobId]: json.items || [] }));
        setJobIsCostPlus(prev => ({ ...prev, [jobId]: !!json.isCostPlus }));
      }
    } catch { /* swallow — picker will fall back to candidates only */ }
    budgetFetchInFlight.current.delete(jobId);
    setBudgetItemsLoading(prev => ({ ...prev, [jobId]: false }));
  }, [token]);



  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLastError(null);
    try {
      const params = new URLSearchParams({ limit: '500', includeStats: '1' });
      if (filter !== 'all') {
        const f = FILTERS.find(x => x.id === filter);
        if (f?.type) params.set('issueType', f.type);
        // 'flagged' swaps the whole view to escalated rows rather than
        // narrowing the pending list by issue type.
        if ((f as any)?.status) params.set('status', (f as any).status);
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

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/bill-review/billables', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!cancelled && res.ok) setBillables(json);
      } catch { /* panel just stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Prefetch budget items for every job represented in the queue as soon as
  // the rows land, so the "Apply to" dropdown opens instantly instead of
  // blocking on a JobTread round-trip the first time each job is touched.
  // Results are cached for the session in budgetItemsCache.
  //
  // Fetched a few jobs at a time: the queue can span a dozen jobs and firing
  // them all at once just queues up behind JobTread's rate limit anyway.
  useEffect(() => {
    if (!token || rows.length === 0) return;
    let cancelled = false;
    const jobIds = [...new Set(rows.map(r => r.job_id).filter(Boolean))];
    (async () => {
      const CONCURRENCY = 3;
      for (let i = 0; i < jobIds.length; i += CONCURRENCY) {
        if (cancelled) return;
        await Promise.all(jobIds.slice(i, i + CONCURRENCY).map(id => fetchBudgetItemsForJob(id)));
      }
    })();
    return () => { cancelled = true; };
  }, [rows, token, fetchBudgetItemsForJob]);

  /**
   * Escalate a row to Nathan with a short note. Takes it out of the pending
   * queue; the nightly scan leaves flagged rows alone.
   */
  async function flagRow(row: ReviewRow) {
    const note = (flagNote[row.id] || '').trim();
    if (!note) {
      setRowError((m) => ({ ...m, [row.id]: 'Add a short note so Nathan knows what to look at.' }));
      return;
    }
    setActingId(row.id);
    setRowError((m) => { const n = { ...m }; delete n[row.id]; return n; });
    try {
      const res = await fetch(`/api/dashboard/bill-review/${row.id}/flag`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setRowError((m) => ({ ...m, [row.id]: json?.error || `Flag failed (HTTP ${res.status})` }));
      } else {
        // Leaves the pending view immediately; reload picks up the counts.
        setRows(prev => prev.filter(r => r.id !== row.id));
        setFlagRowId(null);
        setFlagNote(prev => { const n = { ...prev }; delete n[row.id]; return n; });
        void load();
      }
    } catch (err: any) {
      setRowError((m) => ({ ...m, [row.id]: `Network error: ${err?.message || 'unknown'}` }));
    } finally {
      setActingId(null);
    }
  }

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
      setRowError((m) => ({ ...m, [row.id]: 'Pick a budget item first.' }));
      return;
    }
    setActingId(row.id);
    // Clear any prior error on this row before retrying.
    setRowError((m) => { const next = { ...m }; delete next[row.id]; return next; });
    try {
      const res = await fetch(`/api/dashboard/bill-review/${row.id}/approve`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobCostItemId: picked, approvedBy: auth.userId || 'nathan' }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setRowError((m) => ({
          ...m,
          [row.id]: json?.error || `Apply failed (HTTP ${res.status})`,
        }));
      } else {
        setRows(prev => prev.filter(r => r.id !== row.id));
      }
    } catch (err: any) {
      setRowError((m) => ({
        ...m,
        [row.id]: `Network error: ${err?.message || 'unknown'}. Check your connection and try again.`,
      }));
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
          // Reason + actor are resolved server-side from the signed-in
          // user (see the dismiss route) — this used to say "Nathan" no
          // matter who clicked it.
          body: JSON.stringify({ bulk: true }),
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
    setRowError((m) => { const next = { ...m }; delete next[row.id]; return next; });
    try {
      const res = await fetch(`/api/dashboard/bill-review/${row.id}/dismiss`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        // Reason + actor resolved server-side from the signed-in user.
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({} as any));
        setRowError((m) => ({ ...m, [row.id]: json?.error || `Dismiss failed (HTTP ${res.status})` }));
      } else {
        setRows(prev => prev.filter(r => r.id !== row.id));
      }
    } catch (err: any) {
      setRowError((m) => ({ ...m, [row.id]: `Network error: ${err?.message || 'unknown'}` }));
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

      {/* Billables to bill — cost code 23 costs with no change order yet.
          Sits above the queue because it is step 1 of Heather's weekly
          pass, and because the money here is invisible on the Bill Review
          queue itself (a 23 line is correctly categorized — it just hasn't
          been billed to anyone). */}
      {billables && (billables.totals?.jobCount > 0 || billables.notComputed) && (
        <div className="mb-4 rounded-lg" style={{ background: '#fffdf5', border: '1px solid #e8d9a8' }}>
          <button
            type="button"
            onClick={() => setBillablesOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <DollarSign size={16} style={{ color: '#8a6100' }} />
            <span className="font-semibold text-sm" style={{ color: '#8a6100' }}>
              Billables to bill
            </span>
            {billables.notComputed ? (
              <span className="text-xs" style={{ color: '#8a8078' }}>{billables.message}</span>
            ) : (
              <span className="text-sm" style={{ color: '#5a5550' }}>
                <strong style={{ color: '#1a1a1a' }}>{formatMoney(billables.totals.amount)}</strong>
                {billables.totals.hours > 0 && (
                  <> and <strong style={{ color: '#1a1a1a' }}>{billables.totals.hours} hrs</strong></>
                )}
                {' '}across <strong style={{ color: '#1a1a1a' }}>{billables.totals.jobCount}</strong> job{billables.totals.jobCount === 1 ? '' : 's'}
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {billables.cachedAt && (
                <span className="text-xs" style={{ color: '#8a8078' }}>
                  as of {timeAgo(billables.cachedAt)}
                </span>
              )}
              {billablesOpen ? <ChevronDown size={14} style={{ color: '#8a6100' }} /> : <ChevronRight size={14} style={{ color: '#8a6100' }} />}
            </span>
          </button>

          {billablesOpen && !billables.notComputed && (
            <div style={{ borderTop: '1px solid #e8d9a8' }}>
              <div className="px-4 py-2 text-xs" style={{ color: '#5a4a1f', background: 'rgba(232,217,168,0.25)' }}>
                These are cost code 23 costs (2301 Labor, 2302 Subs, 2303 Materials) that no change order
                covers yet. To bill one: create the change order on the job, then move those 23 costs onto
                the change order's items. Hours are shown separately because JobTread tracks 23 labor as
                time, not dollars — price them when you write the change order.
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: '#8a8078', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    <th className="text-left px-4 py-2">Job</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-right px-4 py-2">Billable $</th>
                    <th className="text-right px-4 py-2">Billable hrs</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {billables.jobs.map((j: any) => {
                    const expanded = billablesJobOpen === j.jobId;
                    return (
                      <Fragment key={j.jobId}>
                        <tr style={{ borderTop: '1px solid #f0ece6' }}>
                          <td className="px-4 py-2">
                            <span style={{ color: '#8a8078' }}>{j.jobNumber ? `${j.jobNumber} · ` : ''}</span>
                            <span style={{ color: '#1a1a1a', fontWeight: 600 }}>{j.jobName}</span>
                            {j.priceType && (
                              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#f1efec', color: '#8a8078' }}>
                                {j.priceType}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-xs" style={{ color: '#8a8078' }}>{j.customStatus || '—'}</td>
                          <td className="px-4 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: j.amount > 0 ? '#1a1a1a' : '#b0a89e' }}>
                            {j.amount > 0 ? formatMoney(j.amount) : '—'}
                          </td>
                          <td className="px-4 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: j.hours > 0 ? '#1a1a1a' : '#b0a89e' }}>
                            {j.hours > 0 ? `${j.hours} hrs` : '—'}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {j.lines?.length > 0 && (
                              <button
                                onClick={() => setBillablesJobOpen(expanded ? null : j.jobId)}
                                className="text-xs mr-2"
                                style={{ background: 'none', border: 'none', color: '#8a6100', cursor: 'pointer' }}
                              >
                                {expanded ? 'Hide' : `${j.lines.length} line${j.lines.length === 1 ? '' : 's'}`}
                              </button>
                            )}
                            <a
                              href={j.jtBudgetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs inline-flex items-center gap-1"
                              style={{ color: '#68050a' }}
                            >
                              Open budget <ExternalLink size={10} />
                            </a>
                          </td>
                        </tr>
                        {expanded && j.lines?.length > 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 pb-3" style={{ background: '#fffdf5' }}>
                              {j.lines.map((l: any) => (
                                <div key={l.costItemId} className="flex items-center gap-2 text-xs py-0.5" style={{ color: '#5a5550' }}>
                                  <span className="flex-1">{l.name}</span>
                                  {l.documentName && <span style={{ color: '#8a8078' }}>{l.documentName}</span>}
                                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(l.total)}</span>
                                </div>
                              ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => {
          const isActive = filter === f.id;
          const count = (f as any).status === 'flagged'
            ? stats?.flaggedTotal || 0
            : f.type
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
                    {/* Escalated row: show who flagged it and why, right next
                        to the issue pill, so Nathan can triage the list
                        without opening anything. */}
                    {row.status === 'flagged' && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
                        style={{ background: '#fef3c7', color: '#8a6100' }}
                        title={row.flagged_at ? `Flagged ${timeAgo(row.flagged_at)}` : 'Flagged'}
                      >
                        <Flag size={11} /> Flagged{row.flagged_by ? ` by ${row.flagged_by}` : ''}
                      </span>
                    )}
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

                  {/* The flag note itself. Always expanded — it is the whole
                      reason the row is in front of Nathan. */}
                  {row.status === 'flagged' && row.flag_note && (
                    <div
                      className="mt-2 p-2 rounded text-xs"
                      style={{ background: '#fffdf5', border: '1px solid #e8d9a8', color: '#5a4a1f' }}
                    >
                      <span className="font-semibold">Note: </span>{row.flag_note}
                    </div>
                  )}

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
                        // The box takes a COST CODE, not free text: 2 digits
                        // for a division, 4 for division + cost type.
                        const codeQuery = parseCodeQuery(pickerSearch);
                        const candidateIds = new Set(candidates.map(c => c.jobCostItemId));
                        // Enforce BKB's matching rule per pricing type:
                        // - Fixed-price: only show budget items that are on
                        //   an approved CO. ALWAYS allow cost code 23 items
                        //   (the billable labor / sub / materials buckets
                        //   used for change-order billable lines) regardless
                        //   of approval state.
                        // - Cost-plus: no approval gate — pick from anything.
                        // The flag is loaded alongside the items; while it's
                        // still loading we default to fixed-price gating
                        // (the safer behavior).
                        const isCostPlus = !!jobIsCostPlus[row.job_id];
                        const isAllowedTarget = (b: BudgetItem): boolean => {
                          if (isCostPlus) return true;
                          if ((b.costCodeNumber || '').trim() === '23') return true;
                          return !!b.isApproved;
                        };
                        const allowedItems = allItems.filter(isAllowedTarget);
                        /**
                         * Cost-code match. A budget item's code may be 2 or 4
                         * digits ("16" or "1602"); we compare on the first two
                         * (the division) and, when the user typed 4 digits,
                         * also require the cost type to match.
                         */
                        const matchesCode = (
                          codeNumber: string | null | undefined,
                          costTypeName: string | null | undefined,
                        ): boolean => {
                          if (!codeQuery || codeQuery === 'invalid') return codeQuery !== 'invalid';
                          const division = String(codeNumber || '').trim().slice(0, 2);
                          if (division !== codeQuery.division) return false;
                          if (!codeQuery.costType) return true;
                          return String(costTypeName || '').trim().toLowerCase()
                            === codeQuery.costType.toLowerCase();
                        };
                        const filteredAll = codeQuery === 'invalid'
                          ? []
                          : allowedItems.filter(b => matchesCode(b.costCodeNumber, b.costTypeName));
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
                                // Pre-fill with the bill line's own cost code
                                // so the right list is already showing. Falls
                                // back to the division when the line carries
                                // a 4-digit code whose type we don't map.
                                setPickerSearch(next ? defaultCodeForRow(row) : '');
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
                                      inputMode="numeric"
                                      maxLength={4}
                                      value={pickerSearch}
                                      onChange={(e) => setPickerSearch(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                      placeholder="Cost code — 16, or 1602"
                                      className="w-full pl-7 pr-2 py-1.5 rounded text-xs"
                                      style={{ background: '#faf8f5', border: '1px solid #e8e5e0', color: '#1a1a1a' }}
                                    />
                                  </div>
                                  <div className="mt-1 text-[10px]" style={{ color: codeQuery === 'invalid' ? '#b91c1c' : '#8a8078' }}>
                                    {codeQuery === 'invalid'
                                      ? 'Enter 2 digits (16) or 4 digits (1602 = 16 Subcontractor).'
                                      : codeQuery
                                        ? `Showing cost code ${codeQuery.division}${codeQuery.costType ? ` · ${codeQuery.costType}` : ''}`
                                        : 'Last 2 digits are the type: 01 Labor · 02 Subcontractor · 03 Materials'}
                                  </div>
                                </div>
                                <div style={{ overflowY: 'auto', flex: 1 }}>
                                  {/* Suggested section. Same pricing-type
                                      gate as the All section — fixed-price
                                      jobs only show suggestions that are
                                      on an approved CO (cc23 always allowed). */}
                                  {(() => {
                                    // Approval gate first, then the cost-code
                                    // filter — so an empty result hides the
                                    // whole section rather than leaving a
                                    // bare "Suggested" header behind.
                                    const suggested = candidates
                                      .filter(c => {
                                        if (isCostPlus) return true;
                                        if ((c.costCodeNumber || '').trim() === '23') return true;
                                        const b = allItems.find(b => b.id === c.jobCostItemId);
                                        return !!b?.isApproved;
                                      })
                                      .filter(c => matchesCode(
                                        c.costCodeNumber,
                                        allItems.find(b => b.id === c.jobCostItemId)?.costTypeName,
                                      ));
                                    if (suggested.length === 0) return null;
                                    return (
                                    <div>
                                      <div className="px-2 py-1 text-[10px] uppercase tracking-wide font-semibold" style={{ color: '#8a8078', background: '#faf8f5' }}>
                                        Suggested
                                      </div>
                                      {suggested
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
                                    );
                                  })()}
                                  {/* "All" section. Label and count adjust by
                                      pricing type — fixed-price says "approved
                                      budget items", cost-plus says "all
                                      budget items". The count reflects what's
                                      actually selectable, not the raw item
                                      count returned from JT. */}
                                  <div>
                                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide font-semibold flex items-center justify-between" style={{ color: '#8a8078', background: '#faf8f5' }}>
                                      <span>
                                        {isCostPlus ? 'All budget items' : 'All approved budget items'}
                                        {allowedItems.length > 0 ? ` (${allowedItems.length})` : ''}
                                      </span>
                                      {isLoading && <Loader2 size={10} className="animate-spin" />}
                                    </div>
                                    {filteredAll.length === 0 && !isLoading ? (
                                      <div className="px-2 py-3 text-xs italic" style={{ color: '#8a8078' }}>
                                        {allowedItems.length === 0
                                          ? 'No approved budget items on this job — flag it for Nathan.'
                                          : codeQuery === 'invalid'
                                            ? 'Enter a 2- or 4-digit cost code.'
                                            : codeQuery
                                              ? `No approved budget item on cost code ${codeQuery.division}${codeQuery.costType ? ` · ${codeQuery.costType}` : ''} — flag it for Nathan.`
                                              : 'No approved budget items match.'}
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

                      {(() => {
                        // Nothing legal to apply to? Then Apply is a dead
                        // end — swap it for the escalation path. "Nothing
                        // legal" means no approved budget item on this job
                        // the fixed-price rule would accept.
                        const allItemsForRow = budgetItemsCache[row.job_id] || [];
                        const costPlus = !!jobIsCostPlus[row.job_id];
                        const anyAllowed = allItemsForRow.some(b =>
                          costPlus || (b.costCodeNumber || '').trim() === '23' || !!b.isApproved
                        );
                        const stillLoading = !!budgetItemsLoading[row.job_id];
                        const noTargets = !stillLoading && !anyAllowed;
                        if (noTargets) {
                          return (
                            <span className="ml-auto text-xs italic" style={{ color: '#8a8078' }}>
                              No approved budget item to apply to
                            </span>
                          );
                        }
                        return (
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
                        );
                      })()}

                      {/* Flag for Nathan — available on every row, not just
                          the dead ends, so Heather can escalate anything she
                          isn't sure about. */}
                      <button
                        onClick={() => {
                          setFlagRowId(flagRowId === row.id ? null : row.id);
                          setRowError((m) => { const n = { ...m }; delete n[row.id]; return n; });
                        }}
                        disabled={isActing}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-xs"
                        style={{
                          background: flagRowId === row.id ? '#fef3c7' : '#ffffff',
                          border: '1px solid #e8d9a8',
                          color: '#8a6100',
                        }}
                      >
                        <Flag size={12} /> Flag for Nathan
                      </button>

                      {flagRowId === row.id && (
                        <div
                          className="basis-full mt-2 p-2 rounded"
                          style={{ background: '#fffdf5', border: '1px solid #e8d9a8' }}
                        >
                          <label className="block text-[11px] font-semibold mb-1" style={{ color: '#8a6100' }}>
                            What should Nathan look at?
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              autoFocus
                              maxLength={500}
                              value={flagNote[row.id] || ''}
                              onChange={(e) => setFlagNote(prev => ({ ...prev, [row.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); void flagRow(row); }
                                if (e.key === 'Escape') setFlagRowId(null);
                              }}
                              placeholder="e.g. no 16 Subcontractor line on the contract — is this a change order?"
                              className="flex-1 px-2 py-1.5 rounded text-xs"
                              style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#1a1a1a' }}
                            />
                            <button
                              onClick={() => flagRow(row)}
                              disabled={isActing || !(flagNote[row.id] || '').trim()}
                              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium"
                              style={{
                                background: '#8a6100', color: '#ffffff', border: '1px solid #8a6100',
                                opacity: (isActing || !(flagNote[row.id] || '').trim()) ? 0.5 : 1,
                              }}
                            >
                              {isActing ? <Loader2 size={12} className="animate-spin" /> : <Flag size={12} />}
                              Flag
                            </button>
                            <button
                              onClick={() => setFlagRowId(null)}
                              className="px-2 py-1.5 rounded text-xs"
                              style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#5a5550' }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      {rowError[row.id] && (
                        <div
                          className="basis-full mt-2 p-2 rounded text-xs"
                          style={{
                            background: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.25)',
                            color: '#b91c1c',
                          }}
                          role="alert"
                        >
                          <div className="flex items-start gap-2">
                            <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
                            <div className="flex-1">
                              <div className="font-semibold mb-0.5">Apply did not stick</div>
                              <div>{rowError[row.id]}</div>
                            </div>
                            <button
                              onClick={() => setRowError((m) => { const n = { ...m }; delete n[row.id]; return n; })}
                              aria-label="Dismiss"
                              className="shrink-0 text-xs"
                              style={{ color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      )}
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
