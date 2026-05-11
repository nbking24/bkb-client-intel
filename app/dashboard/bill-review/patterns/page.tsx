// @ts-nocheck
'use client';

/**
 * /dashboard/bill-review/patterns
 *
 * Library view of every pattern the bill-categorization matcher has learned.
 * Grouped by vendor + (line division, sub-type) so multi-target patterns sit
 * together visually — e.g. you'd see "Wehrung's Lumber + cc01" as a single
 * group with both "04 Framing Materials" and "06 Exterior Materials" as
 * sub-rows when those have been approved separately.
 *
 * Each pattern has a Delete action so a misfit pattern can be pruned. The
 * next scan picks the change up automatically.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Search, Trash2, RefreshCw, Brain } from 'lucide-react';

type PatternRow = {
  id: string;
  vendor_account_id: string;
  vendor_name: string | null;
  cost_code_number: string;       // line cc division: "01", "10", etc
  sub_type_token: string | null;  // "01" | "02" | "03" | null
  target_cost_code_number: string;
  target_cost_code_name: string | null;
  target_budget_item_name_hint: string | null;
  times_confirmed: number;
  times_overridden: number;
  last_confirmed_at: string;
  last_job_id: string | null;
  created_at: string;
};

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

function timeAgo(iso: string) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  const d = Math.floor(hrs / 24);
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  return `${m}mo ago`;
}

function subLabel(sub: string | null) {
  if (sub === '01') return 'Labor';
  if (sub === '02') return 'Sub';
  if (sub === '03') return 'Material';
  return 'any';
}

export default function PatternsLibraryPage() {
  const [rows, setRows] = useState<PatternRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/bill-review/patterns', { headers });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load patterns');
      } else {
        setRows(json.patterns || []);
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function deletePattern(id: string, label: string) {
    if (!confirm(`Delete pattern "${label}"? The matcher will fall back to cost-code matching for this vendor on the next scan.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/dashboard/bill-review/patterns/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Delete failed: ${j.error || res.status}`);
      } else {
        setRows(prev => prev.filter(r => r.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  }

  // Filter by search, then group rows by (vendor, cc, sub) so multi-target
  // patterns visually nest under the same key.
  type Group = {
    key: string;
    vendor_account_id: string;
    vendor_name: string | null;
    cost_code_number: string;
    sub_type_token: string | null;
    targets: PatternRow[];
    totalConfirms: number;
  };
  const groups = useMemo<Group[]>(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter(r =>
          (r.vendor_name || '').toLowerCase().includes(q) ||
          r.cost_code_number.includes(q) ||
          r.target_cost_code_number.includes(q) ||
          (r.target_cost_code_name || '').toLowerCase().includes(q) ||
          (r.target_budget_item_name_hint || '').toLowerCase().includes(q)
        )
      : rows;
    const map = new Map<string, Group>();
    for (const r of filtered) {
      const key = `${r.vendor_account_id}::${r.cost_code_number}::${r.sub_type_token ?? ''}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          vendor_account_id: r.vendor_account_id,
          vendor_name: r.vendor_name,
          cost_code_number: r.cost_code_number,
          sub_type_token: r.sub_type_token,
          targets: [],
          totalConfirms: 0,
        });
      }
      const g = map.get(key)!;
      g.targets.push(r);
      g.totalConfirms += r.times_confirmed || 0;
    }
    // Sort each group's targets by confirm count desc so the most-trusted
    // target appears on top.
    for (const g of map.values()) {
      g.targets.sort((a, b) => (b.times_confirmed || 0) - (a.times_confirmed || 0));
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.vendor_name || '').localeCompare(b.vendor_name || '') ||
      a.cost_code_number.localeCompare(b.cost_code_number)
    );
  }, [rows, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              href="/dashboard/bill-review"
              className="flex items-center gap-1 text-sm hover:underline"
              style={{ color: '#5a5550' }}
            >
              <ArrowLeft size={14} /> Back to Bill Review
            </Link>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: '#1a1a1a' }}>
            <Brain size={20} style={{ color: '#3730a3' }} />
            Learned Patterns
          </h1>
          <div className="text-sm mt-1" style={{ color: '#8a8078' }}>
            Every pattern the bill-categorization matcher has learned from your approvals.
            A pattern with many confirmations means the matcher will auto-suggest the same target
            for future bills from that vendor. Delete one if it learned the wrong thing.
          </div>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#5a5550' }}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8a8078' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by vendor, cost code, target…"
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
            style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#1a1a1a' }}
          />
        </div>
        <div className="text-sm" style={{ color: '#8a8078' }}>
          {groups.length} group{groups.length === 1 ? '' : 's'} · {rows.length} pattern{rows.length === 1 ? '' : 's'}
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-lg text-sm" style={{ background: '#fee2e2', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #e8e5e0' }}>
        {loading ? (
          <div className="p-8 text-center" style={{ color: '#8a8078' }}>
            <Loader2 size={18} className="inline-block animate-spin mr-2" />
            Loading patterns…
          </div>
        ) : groups.length === 0 ? (
          <div className="p-10 text-center" style={{ color: '#8a8078' }}>
            <Brain size={24} className="inline-block mb-2" style={{ color: '#bcb5ad' }} />
            <div>{rows.length === 0
              ? 'No patterns learned yet. Approve a few bills in the queue and the matcher will start remembering vendor → category mappings.'
              : 'No patterns match your search.'}</div>
          </div>
        ) : (
          <div>
            {groups.map((g, gi) => (
              <div
                key={g.key}
                style={{
                  borderBottom: gi < groups.length - 1 ? '1px solid #e8e5e0' : 'none',
                  padding: '12px 16px',
                }}
              >
                {/* Group header — vendor + line cc */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
                    {g.vendor_name || '(unknown vendor)'}
                  </span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: '#f0ece6', color: '#5a5550', fontFamily: 'monospace' }}
                  >
                    cc {g.cost_code_number}{g.sub_type_token ? `·${g.sub_type_token}` : ''} ({subLabel(g.sub_type_token)})
                  </span>
                  {g.targets.length > 1 && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(79,70,229,0.10)', color: '#3730a3' }}
                    >
                      {g.targets.length} target options
                    </span>
                  )}
                  <span className="text-xs ml-auto" style={{ color: '#8a8078' }}>
                    {g.totalConfirms} total approval{g.totalConfirms === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Per-target rows */}
                <div className="space-y-1">
                  {g.targets.map((t) => {
                    const share = g.totalConfirms > 0
                      ? (t.times_confirmed || 0) / g.totalConfirms
                      : 1;
                    const label = `${g.vendor_name || 'vendor'} · cc${g.cost_code_number} → ${t.target_cost_code_number}${t.target_budget_item_name_hint ? ` (${t.target_budget_item_name_hint})` : ''}`;
                    return (
                      <div
                        key={t.id}
                        className="flex items-center gap-3 px-2 py-1.5 rounded text-xs"
                        style={{ background: '#faf8f5', border: '1px solid #f0ece6' }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                              style={{ background: '#222', color: '#f0c060', fontWeight: 600 }}
                            >
                              {t.target_cost_code_number}
                            </span>
                            <span style={{ color: '#1a1a1a' }}>
                              {t.target_budget_item_name_hint || t.target_cost_code_name || '(unnamed target)'}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div style={{ color: '#1a1a1a', fontWeight: 600 }}>
                            {t.times_confirmed}x
                          </div>
                          {g.targets.length > 1 && (
                            <div className="text-[10px]" style={{ color: '#8a8078' }}>
                              {Math.round(share * 100)}% of approvals
                            </div>
                          )}
                        </div>
                        <div className="text-right text-[10px] shrink-0" style={{ color: '#8a8078', width: 80 }}>
                          {timeAgo(t.last_confirmed_at)}
                        </div>
                        <button
                          onClick={() => deletePattern(t.id, label)}
                          disabled={deletingId === t.id}
                          className="shrink-0 p-1 rounded hover:bg-red-50"
                          style={{ color: '#b91c1c', opacity: deletingId === t.id ? 0.5 : 1 }}
                          title="Delete this pattern"
                        >
                          {deletingId === t.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
