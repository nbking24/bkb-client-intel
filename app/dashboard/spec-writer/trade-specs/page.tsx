'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  PenTool,
  RefreshCw,
  Search,
  ShieldCheck,
  SkipForward,
  X,
  XCircle,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================
interface JobOption {
  id: string;
  name: string;
  number: string;
  account: string;
}

interface BudgetGroup {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number | null;
}

interface BudgetItem {
  id: string;
  name: string;
  description: string;
  quantity: number | null;
  unitName: string;
  unitPrice: number | null;
  costCodeName: string;
  costTypeName: string;
  costGroupId: string | null;
  // Group context for the preview pane — the immediate parent group's
  // name and client-facing scope description, joined server-side so the
  // UI can show the "original verbiage" Nathan wrote when the estimate
  // was created (line item descriptions themselves are usually blank).
  costGroupName?: string;
  costGroupDescription?: string;
  isSpecification: boolean;
  approvedPrice: number;
  documentVerbiage: string;
}

interface PreviewItem extends BudgetItem {
  newDescription: string;
  include: boolean;
  generationError?: string;
}

interface ApplyResult {
  costItemId: string;
  status: 'applied' | 'skipped' | 'error';
  reason?: string;
}

type Step = 'select' | 'preview' | 'done';

const GOLD = '#c88c00';
const GRAY = '#8a8078';
const BORDER = 'rgba(200,140,0,0.15)';

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function TradeSpecsPage() {
  // Job selection
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobId, setJobId] = useState('');
  const [jobName, setJobName] = useState('');
  // Searchable picker state. Nathan asked for an A-Z sorted list plus
  // type-ahead filtering by client name. We render an input that filters
  // a dropdown below instead of a native <select>, so partial matches
  // against the client account, job name, or number all surface the
  // right row.
  const [jobQuery, setJobQuery] = useState('');
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [jobHighlight, setJobHighlight] = useState(0);
  const jobPickerRef = useRef<HTMLDivElement | null>(null);
  const jobInputRef = useRef<HTMLInputElement | null>(null);

  // Budget data
  const [groups, setGroups] = useState<BudgetGroup[]>([]);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState('');
  const [budgetLoaded, setBudgetLoaded] = useState(false);

  // Group selection
  const [selectedGroupId, setSelectedGroupId] = useState('');

  // Generation + preview
  const [step, setStep] = useState<Step>('select');
  const [generating, setGenerating] = useState(false);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [markAsSpec, setMarkAsSpec] = useState(true);

  // Apply
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<ApplyResult[]>([]);
  const [applyError, setApplyError] = useState('');

  // ------------------------------------------------------------
  // Load active jobs on mount
  // ------------------------------------------------------------
  useEffect(() => {
    fetch('/api/spec-writer/trade-specs/jobs')
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .catch(() => setJobs([]))
      .finally(() => setJobsLoading(false));
  }, []);

  // Sort the job list A-Z by client account (the field Nathan types into
  // when looking for a job), tiebreak by job name. Falls back to job name
  // when account is blank so jobs without a client still land in order.
  const sortedJobs = useMemo(() => {
    const arr = [...jobs];
    arr.sort((a, b) => {
      const aKey = (a.account || a.name || '').toLowerCase().trim();
      const bKey = (b.account || b.name || '').toLowerCase().trim();
      if (aKey !== bKey) return aKey.localeCompare(bKey);
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    });
    return arr;
  }, [jobs]);

  // Apply the type-ahead filter. We match across client account, job
  // name, and job number so Nathan can type either a client surname
  // ("berntsen") or a job number ("193") and zoom to the right row.
  const filteredJobs = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    if (!q) return sortedJobs;
    return sortedJobs.filter((j) => {
      const hay = `${j.account || ''} ${j.name || ''} ${j.number || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedJobs, jobQuery]);

  // Reset the highlight any time the filtered list changes so arrow-key
  // navigation always starts from the first visible match.
  useEffect(() => {
    setJobHighlight(0);
  }, [jobQuery, jobPickerOpen]);

  // Close the dropdown when the user clicks anywhere outside the picker.
  useEffect(() => {
    if (!jobPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (!jobPickerRef.current) return;
      if (!jobPickerRef.current.contains(e.target as Node)) {
        setJobPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [jobPickerOpen]);

  // Pick a job — fires loadBudget, syncs the display text, closes the dropdown.
  function chooseJob(j: JobOption) {
    setJobId(j.id);
    // Display "Client Name — #123 — Job Name" so the input mirrors what's
    // selected once the dropdown closes. The display string is replaced
    // by raw search text the moment the user starts editing it again.
    const label = j.account
      ? `${j.account} — #${j.number} — ${j.name}`
      : `#${j.number} — ${j.name}`;
    setJobQuery(label);
    setJobPickerOpen(false);
    loadBudget(j.id);
  }

  function clearJobPicker() {
    setJobId('');
    setJobName('');
    setJobQuery('');
    setJobPickerOpen(false);
    jobInputRef.current?.focus();
  }

  // ------------------------------------------------------------
  // Group tree helpers
  // ------------------------------------------------------------
  const groupChildren = useMemo(() => {
    const map = new Map<string | null, BudgetGroup[]>();
    for (const g of groups) {
      const key = g.parentId || null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    const entries = Array.from(map.values());
    for (const arr of entries) {
      arr.sort((a, b) => (a.sortOrder ?? 999999) - (b.sortOrder ?? 999999));
    }
    return map;
  }, [groups]);

  /** All descendant group IDs of a group (inclusive). */
  const descendantIds = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    function collect(id: string): Set<string> {
      if (cache.has(id)) return cache.get(id)!;
      const set = new Set<string>([id]);
      for (const child of groupChildren.get(id) || []) {
        const childSet = collect(child.id);
        childSet.forEach((cid) => set.add(cid));
      }
      cache.set(id, set);
      return set;
    }
    for (const g of groups) collect(g.id);
    return cache;
  }, [groups, groupChildren]);

  /** Flat, depth-annotated group list for the dropdown. */
  const flatGroups = useMemo(() => {
    const out: Array<{ id: string; label: string; depth: number }> = [];
    function walk(parentId: string | null, depth: number) {
      for (const g of groupChildren.get(parentId) || []) {
        out.push({ id: g.id, label: g.name, depth });
        walk(g.id, depth + 1);
      }
    }
    walk(null, 0);
    return out;
  }, [groupChildren]);

  /** Items within the selected group subtree. */
  const scopedItems = useMemo(() => {
    if (!selectedGroupId) return [];
    const ids = descendantIds.get(selectedGroupId) || new Set([selectedGroupId]);
    return items.filter((it) => it.costGroupId && ids.has(it.costGroupId));
  }, [items, selectedGroupId, descendantIds]);

  const eligibleItems = useMemo(
    () => scopedItems.filter((it) => it.approvedPrice > 0 && !it.documentVerbiage.trim()),
    [scopedItems]
  );
  const notApprovedItems = useMemo(
    () => scopedItems.filter((it) => it.approvedPrice <= 0),
    [scopedItems]
  );
  const alreadyProcessedItems = useMemo(
    () => scopedItems.filter((it) => it.approvedPrice > 0 && it.documentVerbiage.trim()),
    [scopedItems]
  );

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  async function loadBudget(id: string) {
    setBudgetLoading(true);
    setBudgetError('');
    setBudgetLoaded(false);
    setSelectedGroupId('');
    try {
      const res = await fetch('/api/spec-writer/trade-specs/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load budget');
      setGroups(data.groups || []);
      setItems(data.items || []);
      setJobName(data.jobName || '');
      setBudgetLoaded(true);
    } catch (err: any) {
      setBudgetError(err.message || 'Failed to load budget');
    } finally {
      setBudgetLoading(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setApplyError('');
    try {
      const groupLabel = flatGroups.find((g) => g.id === selectedGroupId)?.label || '';
      const res = await fetch('/api/spec-writer/trade-specs/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobName,
          items: eligibleItems.map((it) => ({
            id: it.id,
            name: it.name,
            description: it.description,
            quantity: it.quantity,
            unitName: it.unitName,
            costCodeName: it.costCodeName,
            costTypeName: it.costTypeName,
            groupPath: groupLabel,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      const byId = new Map<string, string>(
        (data.results || []).map((r: { id: string; description: string }) => [r.id, r.description])
      );
      const errById = new Map<string, string>(
        (data.errors || []).map((e: { id: string; error: string }) => [e.id, e.error])
      );
      setPreviewItems(
        eligibleItems.map((it) => ({
          ...it,
          newDescription: byId.get(it.id) || '',
          include: byId.has(it.id),
          generationError: errById.get(it.id),
        }))
      );
      setStep('preview');
    } catch (err: any) {
      setApplyError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function apply() {
    setApplying(true);
    setApplyError('');
    try {
      const toApply = previewItems.filter((it) => it.include && it.newDescription.trim());
      const res = await fetch('/api/spec-writer/trade-specs/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markAsSpecification: markAsSpec,
          items: toApply.map((it) => ({ costItemId: it.id, newDescription: it.newDescription })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Apply failed');
      setApplyResults(data.results || []);
      setStep('done');
    } catch (err: any) {
      setApplyError(err.message || 'Apply failed');
    } finally {
      setApplying(false);
    }
  }

  function reset() {
    setStep('select');
    setPreviewItems([]);
    setApplyResults([]);
    setApplyError('');
    if (jobId) loadBudget(jobId);
  }

  const includedCount = previewItems.filter((it) => it.include && it.newDescription.trim()).length;

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="p-2 rounded-lg hover:bg-[#f0eeeb]" style={{ color: GRAY }}>
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: 'Georgia, serif', color: GOLD }}>
            Trade Specs
          </h1>
          <p className="text-xs mt-0.5" style={{ color: GRAY }}>
            Convert client-facing contract verbiage into trade-focused field specs
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b" style={{ borderColor: BORDER }}>
        <Link
          href="/dashboard/spec-writer"
          className="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
          style={{ color: GRAY, background: 'transparent' }}
        >
          Quick Specs
        </Link>
        <Link
          href="/dashboard/spec-writer/contract"
          className="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
          style={{ color: GRAY, background: 'transparent' }}
        >
          Contract
        </Link>
        <button
          className="px-4 py-2 text-sm font-medium rounded-t-lg"
          style={{ color: GOLD, background: 'rgba(200,140,0,0.08)', borderBottom: `2px solid ${GOLD}` }}
        >
          Trade Specs
        </button>
      </div>

      {/* ============================================ */}
      {/* STEP 1: SELECT JOB + PARENT GROUP */}
      {/* ============================================ */}
      {step === 'select' && (
        <div className="space-y-4">
          {/* Job picker */}
          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: BORDER, background: '#ffffff' }}>
            <label className="text-sm font-medium" style={{ color: '#3d3a36' }}>
              1. Select project
            </label>
            {/* Searchable job picker. Click or focus the input to open the
                dropdown of all active jobs (A-Z by client). Type to filter;
                Arrow keys + Enter pick a row; Escape closes. */}
            <div className="relative" ref={jobPickerRef}>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: GRAY }} />
                <input
                  ref={jobInputRef}
                  type="text"
                  value={jobQuery}
                  placeholder={jobsLoading ? 'Loading jobs…' : 'Type a client name or job number…'}
                  disabled={jobsLoading}
                  onFocus={() => setJobPickerOpen(true)}
                  onClick={() => setJobPickerOpen(true)}
                  onChange={(e) => {
                    setJobQuery(e.target.value);
                    setJobPickerOpen(true);
                    // Clear any prior selection the moment the text diverges
                    // from the display label, so a stale jobId doesn't
                    // linger if Nathan starts typing a new search.
                    if (jobId) setJobId('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setJobPickerOpen(true);
                      setJobHighlight((i) => Math.min(i + 1, filteredJobs.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setJobHighlight((i) => Math.max(i - 1, 0));
                    } else if (e.key === 'Enter') {
                      if (filteredJobs[jobHighlight]) {
                        e.preventDefault();
                        chooseJob(filteredJobs[jobHighlight]);
                      }
                    } else if (e.key === 'Escape') {
                      setJobPickerOpen(false);
                    }
                  }}
                  className="w-full rounded-lg border pl-9 pr-9 py-2.5 text-sm"
                  style={{ borderColor: BORDER, color: '#3d3a36', background: '#fdfcfa' }}
                />
                {jobQuery ? (
                  <button
                    type="button"
                    onClick={clearJobPicker}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-stone-100"
                    title="Clear"
                  >
                    <X size={14} style={{ color: GRAY }} />
                  </button>
                ) : (
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: GRAY }} />
                )}
              </div>

              {jobPickerOpen && !jobsLoading && (
                <div
                  className="absolute z-20 mt-1 w-full max-h-80 overflow-y-auto rounded-lg border shadow-lg"
                  style={{ borderColor: BORDER, background: '#ffffff' }}
                >
                  {filteredJobs.length === 0 ? (
                    <div className="px-3 py-2.5 text-sm italic" style={{ color: GRAY }}>
                      No jobs match "{jobQuery}".
                    </div>
                  ) : (
                    filteredJobs.map((j, idx) => {
                      const active = idx === jobHighlight;
                      return (
                        <button
                          key={j.id}
                          type="button"
                          onMouseEnter={() => setJobHighlight(idx)}
                          onClick={() => chooseJob(j)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm"
                          style={{
                            background: active ? 'rgba(200,140,0,0.08)' : 'transparent',
                            borderBottom: '1px solid rgba(200,140,0,0.06)',
                            color: '#3d3a36',
                          }}
                        >
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: '#222', color: '#f0c060', fontWeight: 600 }}
                          >
                            #{j.number || '—'}
                          </span>
                          <span className="font-medium truncate flex-1 min-w-0">
                            {j.account || 'No client'}
                          </span>
                          <span className="text-xs truncate max-w-[55%]" style={{ color: GRAY }}>
                            {j.name}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            {budgetLoading && (
              <div className="flex items-center gap-2 text-sm" style={{ color: GRAY }}>
                <Loader2 size={15} className="animate-spin" /> Loading budget…
              </div>
            )}
            {budgetError && <div className="text-sm text-red-600">{budgetError}</div>}
          </div>

          {/* Group picker */}
          {budgetLoaded && (
            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: BORDER, background: '#ffffff' }}>
              <label className="text-sm font-medium" style={{ color: '#3d3a36' }}>
                2. Select parent budget group
              </label>
              <div className="relative">
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="w-full appearance-none rounded-lg border px-3 py-2.5 text-sm pr-9 font-mono"
                  style={{ borderColor: BORDER, color: '#3d3a36', background: '#fdfcfa' }}
                >
                  <option value="">Choose a group…</option>
                  {flatGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {'  '.repeat(g.depth)}
                      {g.depth > 0 ? '└ ' : ''}
                      {g.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-3 pointer-events-none" style={{ color: GRAY }} />
              </div>
              <p className="text-xs" style={{ color: GRAY }}>
                All line items inside this group and its sub-groups will be reviewed.
              </p>
            </div>
          )}

          {/* Eligibility summary */}
          {budgetLoaded && selectedGroupId && (
            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: BORDER, background: '#ffffff' }}>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" style={{ color: '#3d3a36' }}>
                  3. Review eligible items
                </label>
                <span className="text-xs" style={{ color: GRAY }}>
                  {scopedItems.length} items in group
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg p-2" style={{ background: 'rgba(34,150,80,0.08)' }}>
                  <div className="text-lg font-bold" style={{ color: '#1d7a45' }}>{eligibleItems.length}</div>
                  <div className="text-[11px]" style={{ color: GRAY }}>Eligible (approved)</div>
                </div>
                <div className="rounded-lg p-2" style={{ background: 'rgba(200,140,0,0.08)' }}>
                  <div className="text-lg font-bold" style={{ color: GOLD }}>{alreadyProcessedItems.length}</div>
                  <div className="text-[11px]" style={{ color: GRAY }}>Already processed</div>
                </div>
                <div className="rounded-lg p-2" style={{ background: 'rgba(150,150,150,0.10)' }}>
                  <div className="text-lg font-bold" style={{ color: GRAY }}>{notApprovedItems.length}</div>
                  <div className="text-[11px]" style={{ color: GRAY }}>Not approved (skipped)</div>
                </div>
              </div>

              {eligibleItems.length > 0 && (
                <div className="divide-y rounded-lg border" style={{ borderColor: BORDER }}>
                  {eligibleItems.map((it) => (
                    <div key={it.id} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm truncate" style={{ color: '#3d3a36' }}>{it.name}</div>
                        <div className="text-[11px] truncate" style={{ color: GRAY }}>
                          {it.description ? `${it.description.slice(0, 90)}${it.description.length > 90 ? '…' : ''}` : 'No description'}
                        </div>
                      </div>
                      <div className="text-xs font-medium whitespace-nowrap" style={{ color: '#1d7a45' }}>
                        {fmtMoney(it.approvedPrice)} approved
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {eligibleItems.length === 0 && (
                <p className="text-sm" style={{ color: GRAY }}>
                  No eligible items in this group. Items need an approved price and an empty Document Verbiage field.
                </p>
              )}

              {applyError && <div className="text-sm text-red-600">{applyError}</div>}

              <button
                onClick={generate}
                disabled={generating || eligibleItems.length === 0}
                className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
                style={{ background: GOLD }}
              >
                {generating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Writing trade specs… this can take a minute
                  </>
                ) : (
                  <>
                    <PenTool size={16} /> Generate Trade Descriptions ({eligibleItems.length})
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ============================================ */}
      {/* STEP 2: PREVIEW + EDIT */}
      {/* ============================================ */}
      {step === 'preview' && (
        <div className="space-y-4">
          <div className="rounded-xl border p-4 flex items-center justify-between" style={{ borderColor: BORDER, background: '#ffffff' }}>
            <div>
              <div className="text-sm font-medium" style={{ color: '#3d3a36' }}>{jobName}</div>
              <div className="text-xs" style={{ color: GRAY }}>
                Review each rewrite. Originals will be preserved in the Document Verbiage field.
              </div>
            </div>
            <button onClick={() => setStep('select')} className="text-xs underline" style={{ color: GRAY }}>
              Back
            </button>
          </div>

          {previewItems.map((it, idx) => (
            <div
              key={it.id}
              className="rounded-xl border p-4 space-y-3"
              style={{ borderColor: BORDER, background: '#ffffff', opacity: it.include ? 1 : 0.55 }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold" style={{ color: '#3d3a36' }}>{it.name}</div>
                  <div className="text-[11px]" style={{ color: GRAY }}>
                    {fmtMoney(it.approvedPrice)} approved{it.costCodeName ? ` · ${it.costCodeName}` : ''}
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer" style={{ color: GRAY }}>
                  <input
                    type="checkbox"
                    checked={it.include}
                    onChange={(e) => {
                      const next = [...previewItems];
                      next[idx] = { ...it, include: e.target.checked };
                      setPreviewItems(next);
                    }}
                  />
                  Include
                </label>
              </div>

              {it.generationError && (
                <div className="text-xs text-red-600">Generation failed: {it.generationError}</div>
              )}

              {/* Original group verbiage banner — full width, always shown.
                  This is the client-facing scope text Nathan wrote when the
                  estimate was generated. Most line items have an empty
                  description field of their own, so the group description
                  is the actual "original verbiage" worth reading before
                  approving the trade rewrite. */}
              {(it.costGroupDescription || it.costGroupName) && (
                <div>
                  <div className="text-[11px] font-medium mb-1 uppercase tracking-wide flex items-center gap-2" style={{ color: GRAY }}>
                    <span>Original group verbiage</span>
                    {it.costGroupName && (
                      <span className="text-[10px] normal-case font-normal" style={{ color: GRAY }}>
                        ({it.costGroupName})
                      </span>
                    )}
                  </div>
                  <div
                    className="text-xs rounded-lg border p-2.5 whitespace-pre-wrap max-h-56 overflow-y-auto"
                    style={{ borderColor: BORDER, background: '#f7f5f0', color: '#3d3a36' }}
                  >
                    {it.costGroupDescription || '(no group description set)'}
                  </div>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-medium mb-1 uppercase tracking-wide" style={{ color: GRAY }}>
                    Line item description (moves to Document Verbiage)
                  </div>
                  <div
                    className="text-xs rounded-lg border p-2.5 whitespace-pre-wrap max-h-48 overflow-y-auto"
                    style={{ borderColor: BORDER, background: '#faf9f7', color: '#6b655f' }}
                  >
                    {it.description || '(empty — nothing to back up)'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium mb-1 uppercase tracking-wide" style={{ color: GOLD }}>
                    New trade description (editable)
                  </div>
                  <textarea
                    value={it.newDescription}
                    onChange={(e) => {
                      const next = [...previewItems];
                      next[idx] = { ...it, newDescription: e.target.value };
                      setPreviewItems(next);
                    }}
                    rows={Math.min(12, Math.max(4, it.newDescription.split('\n').length + 1))}
                    className="w-full text-xs rounded-lg border p-2.5 font-mono"
                    style={{ borderColor: 'rgba(200,140,0,0.35)', background: '#fffdf8', color: '#3d3a36' }}
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="rounded-xl border p-4 space-y-3 sticky bottom-3" style={{ borderColor: BORDER, background: '#ffffff', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#3d3a36' }}>
              <input type="checkbox" checked={markAsSpec} onChange={(e) => setMarkAsSpec(e.target.checked)} />
              Also mark these items as Specifications in JobTread
            </label>
            {applyError && <div className="text-sm text-red-600">{applyError}</div>}
            <button
              onClick={apply}
              disabled={applying || includedCount === 0}
              className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: GOLD }}
            >
              {applying ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Applying to JobTread…
                </>
              ) : (
                <>
                  <ShieldCheck size={16} /> Apply {includedCount} to JobTread
                </>
              )}
            </button>
            <p className="text-[11px] text-center" style={{ color: GRAY }}>
              Approved-price and not-already-processed checks are re-verified server-side before any write.
            </p>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* STEP 3: RESULTS */}
      {/* ============================================ */}
      {step === 'done' && (
        <div className="space-y-4">
          <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: BORDER, background: '#ffffff' }}>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={20} style={{ color: '#1d7a45' }} />
              <div className="text-sm font-semibold" style={{ color: '#3d3a36' }}>
                Done — {jobName}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg p-3" style={{ background: 'rgba(34,150,80,0.08)' }}>
                <div className="text-xl font-bold" style={{ color: '#1d7a45' }}>
                  {applyResults.filter((r) => r.status === 'applied').length}
                </div>
                <div className="text-[11px]" style={{ color: GRAY }}>Applied</div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(200,140,0,0.08)' }}>
                <div className="text-xl font-bold" style={{ color: GOLD }}>
                  {applyResults.filter((r) => r.status === 'skipped').length}
                </div>
                <div className="text-[11px]" style={{ color: GRAY }}>Skipped</div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(220,60,60,0.08)' }}>
                <div className="text-xl font-bold" style={{ color: '#c43c3c' }}>
                  {applyResults.filter((r) => r.status === 'error').length}
                </div>
                <div className="text-[11px]" style={{ color: GRAY }}>Errors</div>
              </div>
            </div>

            <div className="divide-y rounded-lg border" style={{ borderColor: BORDER }}>
              {applyResults.map((r) => {
                const item = previewItems.find((p) => p.id === r.costItemId);
                return (
                  <div key={r.costItemId} className="px-3 py-2 flex items-center gap-2">
                    {r.status === 'applied' && <Check size={14} style={{ color: '#1d7a45' }} />}
                    {r.status === 'skipped' && <SkipForward size={14} style={{ color: GOLD }} />}
                    {r.status === 'error' && <XCircle size={14} style={{ color: '#c43c3c' }} />}
                    <div className="min-w-0 flex-1">
                      <span className="text-sm" style={{ color: '#3d3a36' }}>{item?.name || r.costItemId}</span>
                      {r.reason && <span className="text-[11px] ml-2" style={{ color: GRAY }}>{r.reason}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <a
                href={`https://app.jobtread.com/jobs/${jobId}/specifications`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white"
                style={{ background: GOLD }}
              >
                View Specifications in JobTread <ArrowRight size={15} />
              </a>
              <button
                onClick={reset}
                className="flex items-center justify-center gap-2 rounded-lg py-2.5 px-4 text-sm font-medium border"
                style={{ borderColor: BORDER, color: GRAY }}
              >
                <RefreshCw size={14} /> Run Another
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
