// @ts-nocheck
'use client';

/**
 * Job Costing WIP Report
 *
 * Spreadsheet-style view of every open fixed-price job with the full
 * Work-in-Progress breakdown (Cost ÷ Budget = %, % × Contract =
 * Earned, Earned − Billed = Over/Under). Cost-plus jobs are excluded
 * because the model doesn't apply.
 *
 * Pulls from the same cached summary the main job costing dashboard
 * uses, so it's effectively free to render once the summary cache is
 * warm. Sortable column headers, totals row, CSV download.
 *
 * Lives at /dashboard/job-costing/wip-report. Reachable from the
 * "WIP Report" button on the main job costing dashboard header.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';

interface JobSummary {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  customStatus: string | null;
  isCostPlus: boolean;
  contractPrice?: number;
  estimatedCost: number;
  totalCosts?: number;
  actualCost: number;
  pendingCost?: number;
  invoicedAmount: number;
  collectedAmount: number;
  manualPercentComplete?: number | null;
  wipStatus?: 'on_track' | 'ahead' | 'behind' | 'na';
  costBasedPercent?: number | null;
  earnedRevenue?: number;
  overUnderBilled?: number;
  overUnderPercent?: number;
  // Slippage: margin erosion between bid and projected completion.
  slippageStatus?: 'gained' | 'on_track' | 'slipping' | 'na';
  slippageDollars?: number | null;
  slippagePoints?: number | null;
  slippagePctOfContract?: number | null;
}

type SortKey =
  | 'clientName' | 'customStatus'
  | 'contractPrice' | 'estimatedCost' | 'totalCosts'
  | 'costBasedPercent' | 'earnedRevenue' | 'invoicedAmount'
  | 'overUnderBilled' | 'wipStatus'
  | 'slippageDollars';

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${Math.round(n * 100)}%`;
}

const WIP_STATUS_ORDER: Record<string, number> = {
  behind: 0, ahead: 1, on_track: 2, na: 3,
};

function statusChip(status: 'behind' | 'ahead' | 'on_track' | 'na' | undefined) {
  if (!status || status === 'na') return <span style={{ color: '#8a8078' }}>—</span>;
  const cfg =
    status === 'behind'
      ? { Icon: TrendingDown, color: '#b91c1c', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.25)', label: 'Behind' }
      : status === 'ahead'
        ? { Icon: TrendingUp, color: '#1e40af', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.25)', label: 'Ahead' }
        : { Icon: Minus, color: '#15803d', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)', label: 'On track' };
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
    >
      <cfg.Icon size={10} />
      {cfg.label}
    </span>
  );
}

export default function WipReportPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('overUnderBilled');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  async function load(force = false) {
    if (force) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const url = force ? '/api/dashboard/job-costing?refresh=1' : '/api/dashboard/job-costing';
      const res = await fetch(url, { method: force ? 'POST' : 'GET', cache: 'no-store' });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      // Fixed-price only; cost-plus jobs return wipStatus='na' and
      // would clutter the report (no contract / earned-revenue
      // concept on those).
      const fixed = (data.summaries || []).filter(
        (j: JobSummary) => !j.isCostPlus && j.wipStatus && j.wipStatus !== 'na',
      );
      setJobs(fixed);
      setCachedAt(data.cachedAt || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load WIP report');
    } finally {
      if (force) setRefreshing(false); else setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const sorted = useMemo(() => {
    const arr = [...jobs];
    arr.sort((a: any, b: any) => {
      if (sortBy === 'clientName') {
        const ak = (a.clientName || a.jobName || '').toLowerCase();
        const bk = (b.clientName || b.jobName || '').toLowerCase();
        return sortDir === 'asc' ? ak.localeCompare(bk) : bk.localeCompare(ak);
      }
      if (sortBy === 'customStatus') {
        const ak = (a.customStatus || '').toLowerCase();
        const bk = (b.customStatus || '').toLowerCase();
        return sortDir === 'asc' ? ak.localeCompare(bk) : bk.localeCompare(ak);
      }
      if (sortBy === 'wipStatus') {
        const ak = WIP_STATUS_ORDER[a.wipStatus || 'na'] ?? 99;
        const bk = WIP_STATUS_ORDER[b.wipStatus || 'na'] ?? 99;
        return sortDir === 'asc' ? ak - bk : bk - ak;
      }
      const av = Number(a[sortBy] ?? 0);
      const bv = Number(b[sortBy] ?? 0);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [jobs, sortBy, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      // Money/percent columns make more sense sorted high-first;
      // text columns sorted alphabetically (low-first).
      const isNumeric =
        key !== 'clientName' && key !== 'customStatus' && key !== 'wipStatus';
      setSortDir(isNumeric ? 'desc' : 'asc');
    }
  }

  // Portfolio totals - the row at the bottom of the spreadsheet.
  const totals = useMemo(() => {
    return jobs.reduce(
      (t, j) => {
        t.contract += j.contractPrice || 0;
        t.budget += j.estimatedCost || 0;
        t.cost += j.totalCosts || j.actualCost || 0;
        t.earned += j.earnedRevenue || 0;
        t.invoiced += j.invoicedAmount || 0;
        t.overUnder += j.overUnderBilled || 0;
        t.slippage += (j.slippageStatus && j.slippageStatus !== 'na' ? (j.slippageDollars || 0) : 0);
        return t;
      },
      { contract: 0, budget: 0, cost: 0, earned: 0, invoiced: 0, overUnder: 0, slippage: 0 },
    );
  }, [jobs]);

  function downloadCsv() {
    // Standard accounting-style WIP export. Headers match the table,
    // values are unquoted numbers so it imports cleanly into Excel
    // or QuickBooks. Job names get quoted so commas inside don't
    // break columns.
    const headers = [
      'Client', 'Job Name', 'Job #', 'Status',
      'Contract Price', 'Budgeted Cost', 'Total Cost', 'Cost %',
      'Earned Revenue', 'Invoiced', 'Over/(Under)', 'WIP Status',
      'Slippage $', 'Slippage Points',
    ];
    const rows = sorted.map((j) => [
      `"${(j.clientName || '').replace(/"/g, '""')}"`,
      `"${(j.jobName || '').replace(/"/g, '""')}"`,
      j.jobNumber,
      `"${(j.customStatus || '').replace(/"/g, '""')}"`,
      (j.contractPrice || 0).toFixed(2),
      (j.estimatedCost || 0).toFixed(2),
      (j.totalCosts || j.actualCost || 0).toFixed(2),
      j.costBasedPercent != null ? (j.costBasedPercent * 100).toFixed(1) : '',
      (j.earnedRevenue || 0).toFixed(2),
      (j.invoicedAmount || 0).toFixed(2),
      (j.overUnderBilled || 0).toFixed(2),
      j.wipStatus || '',
      j.slippageStatus && j.slippageStatus !== 'na' && j.slippageDollars != null ? j.slippageDollars.toFixed(2) : '',
      j.slippageStatus && j.slippageStatus !== 'na' && j.slippagePoints != null ? j.slippagePoints.toFixed(1) : '',
    ]);
    const totalsRow = [
      '"TOTALS"', '""', '', '""',
      totals.contract.toFixed(2),
      totals.budget.toFixed(2),
      totals.cost.toFixed(2),
      totals.budget > 0 ? ((totals.cost / totals.budget) * 100).toFixed(1) : '',
      totals.earned.toFixed(2),
      totals.invoiced.toFixed(2),
      totals.overUnder.toFixed(2),
      '',
      totals.slippage.toFixed(2),
      '',
    ];
    const csv = [headers.join(','), ...rows.map((r) => r.join(',')), totalsRow.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `bkb-wip-report-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const SortHeader = ({ keyName, label, numeric }: { keyName: SortKey; label: string; numeric?: boolean }) => {
    const isActive = sortBy === keyName;
    return (
      <th
        onClick={() => toggleSort(keyName)}
        className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide select-none cursor-pointer hover:bg-stone-100"
        style={{
          color: isActive ? '#1a1a1a' : '#5a5550',
          textAlign: numeric ? 'right' : 'left',
          background: '#faf8f5',
          borderBottom: '1px solid rgba(200,140,0,0.15)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        {isActive && <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </th>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/dashboard/job-costing"
            className="inline-flex items-center gap-1 text-xs hover:underline mb-1"
            style={{ color: '#8a8078' }}
          >
            <ArrowLeft size={12} /> Back to job costing
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: '#c88c00', fontFamily: 'Georgia, serif' }}>
            WIP Report
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
            Cost-based earned-revenue breakdown across every open fixed-price job. Cost-plus jobs excluded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {cachedAt && (
            <span className="text-xs hidden sm:inline" style={{ color: '#8a8078' }}>
              Data as of {new Date(cachedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={downloadCsv}
            disabled={jobs.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.20)', color: '#1a1a1a' }}
            title="Download as CSV (Excel-compatible)"
          >
            <Download size={14} /> CSV
          </button>
          <button
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50"
            style={{ background: '#c88c00', color: '#ffffff' }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 gap-3" style={{ color: '#8a8078' }}>
          <Loader2 size={24} className="animate-spin" />
          <span>Loading WIP report…</span>
        </div>
      )}
      {error && !loading && (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid rgba(200,140,0,0.15)', background: '#ffffff' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <SortHeader keyName="clientName" label="Client / Job" />
                  <SortHeader keyName="customStatus" label="Status" />
                  <SortHeader keyName="contractPrice" label="Contract" numeric />
                  <SortHeader keyName="estimatedCost" label="Budgeted Cost" numeric />
                  <SortHeader keyName="totalCosts" label="Cost to Date" numeric />
                  <SortHeader keyName="costBasedPercent" label="% Complete" numeric />
                  <SortHeader keyName="earnedRevenue" label="Earned" numeric />
                  <SortHeader keyName="invoicedAmount" label="Invoiced" numeric />
                  <SortHeader keyName="overUnderBilled" label="Over / (Under)" numeric />
                  <SortHeader keyName="wipStatus" label="WIP" />
                  <SortHeader keyName="slippageDollars" label="Slippage $" numeric />
                </tr>
              </thead>
              <tbody>
                {sorted.map((j) => {
                  const wipColor =
                    j.wipStatus === 'behind' ? '#b91c1c'
                    : j.wipStatus === 'ahead' ? '#1e40af'
                    : '#15803d';
                  return (
                    <tr key={j.jobId} style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                      <td className="px-2 py-2" style={{ color: '#1a1a1a' }}>
                        <div className="font-semibold">{j.clientName || j.jobName}</div>
                        <div className="text-[10px]" style={{ color: '#8a8078' }}>
                          {j.jobName} · #{j.jobNumber}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-[11px]" style={{ color: '#5a5550' }}>
                        {j.customStatus || '—'}
                      </td>
                      <td className="px-2 py-2 font-mono text-right" style={{ color: '#1a1a1a' }}>
                        ${fmtMoney(j.contractPrice || 0)}
                      </td>
                      <td className="px-2 py-2 font-mono text-right" style={{ color: '#1a1a1a' }}>
                        ${fmtMoney(j.estimatedCost || 0)}
                      </td>
                      <td className="px-2 py-2 font-mono text-right" style={{ color: '#1a1a1a' }}>
                        ${fmtMoney(j.totalCosts || j.actualCost || 0)}
                      </td>
                      <td className="px-2 py-2 font-mono text-right" style={{ color: '#1a1a1a' }}>
                        {fmtPct(j.costBasedPercent)}
                      </td>
                      <td className="px-2 py-2 font-mono text-right" style={{ color: '#1a1a1a' }}>
                        ${fmtMoney(j.earnedRevenue || 0)}
                      </td>
                      <td className="px-2 py-2 font-mono text-right" style={{ color: '#1a1a1a' }}>
                        ${fmtMoney(j.invoicedAmount || 0)}
                      </td>
                      <td
                        className="px-2 py-2 font-mono text-right"
                        style={{ color: wipColor, fontWeight: 600 }}
                      >
                        {(j.overUnderBilled || 0) >= 0 ? '+' : '−'}${fmtMoney(Math.abs(j.overUnderBilled || 0))}
                      </td>
                      <td className="px-2 py-2">
                        {statusChip(j.wipStatus as any)}
                      </td>
                      <td
                        className="px-2 py-2 font-mono text-right"
                        style={{
                          color:
                            j.slippageStatus === 'slipping' ? '#b91c1c'
                            : j.slippageStatus === 'gained' ? '#15803d'
                            : '#8a8078',
                          fontWeight: 600,
                        }}
                        title={j.slippagePoints != null ? `${j.slippagePoints > 0 ? '-' : '+'}${Math.abs(j.slippagePoints).toFixed(1)} margin pts` : ''}
                      >
                        {j.slippageDollars == null || j.slippageStatus === 'na' ? '—' : (
                          <>
                            {j.slippageDollars > 0 ? '−' : j.slippageDollars < 0 ? '+' : ''}${fmtMoney(Math.abs(j.slippageDollars))}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-2 py-8 text-center italic" style={{ color: '#8a8078' }}>
                      No fixed-price jobs to report on. Cost-plus jobs are excluded from WIP.
                    </td>
                  </tr>
                )}
              </tbody>
              {sorted.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid rgba(200,140,0,0.20)', background: '#faf8f5' }}>
                    <td className="px-2 py-2 font-semibold" style={{ color: '#1a1a1a' }}>
                      TOTALS ({sorted.length} jobs)
                    </td>
                    <td />
                    <td className="px-2 py-2 font-mono text-right font-semibold" style={{ color: '#1a1a1a' }}>
                      ${fmtMoney(totals.contract)}
                    </td>
                    <td className="px-2 py-2 font-mono text-right font-semibold" style={{ color: '#1a1a1a' }}>
                      ${fmtMoney(totals.budget)}
                    </td>
                    <td className="px-2 py-2 font-mono text-right font-semibold" style={{ color: '#1a1a1a' }}>
                      ${fmtMoney(totals.cost)}
                    </td>
                    <td className="px-2 py-2 font-mono text-right font-semibold" style={{ color: '#1a1a1a' }}>
                      {totals.budget > 0 ? `${Math.round((totals.cost / totals.budget) * 100)}%` : '—'}
                    </td>
                    <td className="px-2 py-2 font-mono text-right font-semibold" style={{ color: '#1a1a1a' }}>
                      ${fmtMoney(totals.earned)}
                    </td>
                    <td className="px-2 py-2 font-mono text-right font-semibold" style={{ color: '#1a1a1a' }}>
                      ${fmtMoney(totals.invoiced)}
                    </td>
                    <td
                      className="px-2 py-2 font-mono text-right font-semibold"
                      style={{ color: totals.overUnder >= 0 ? '#1e40af' : '#b91c1c' }}
                    >
                      {totals.overUnder >= 0 ? '+' : '−'}${fmtMoney(Math.abs(totals.overUnder))}
                    </td>
                    <td />
                    <td
                      className="px-2 py-2 font-mono text-right font-semibold"
                      style={{ color: totals.slippage > 0 ? '#b91c1c' : totals.slippage < 0 ? '#15803d' : '#8a8078' }}
                    >
                      {totals.slippage > 0 ? '−' : totals.slippage < 0 ? '+' : ''}${fmtMoney(Math.abs(totals.slippage))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
