// @ts-nocheck
'use client';

/**
 * Company Financials — owner-only whole-company dashboard.
 *
 * Two data sources, clearly labelled on screen:
 *   QuickBooks — a nightly snapshot (the Hub has no QB OAuth; a scheduled
 *     Cowork task pushes the figures in). Stamped with its `asOf` date.
 *   JobTread — the Job Costing cache, powering the per-job profitability
 *     drawer at the bottom.
 *
 * Definitions used throughout (validated against QB 2026-09-09 and the
 * coach's scorecard mapping):
 *   COGS      = 4000 Direct Job Costs + 4500 Indirect Job Costs
 *   Overhead  = total Expenses - COGS
 *   Net       = Revenue - COGS - Overhead   (standard P&L net income)
 *   Coach net = Net - owner draws            (shown as a secondary figure)
 *
 * Charts are hand-rolled inline SVG — the Hub carries no chart library and
 * the Gantt sets the precedent.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, Loader2, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, Wallet, Building2, AlertCircle, Lock,
} from 'lucide-react';

// ---- palette (matches the rest of the Hub) ----
const GOLD = '#c88c00';
const GOLD_DK = '#a06f00';
const INK = '#1a1a1a';
const MUTED = '#8a8078';
const LINE = 'rgba(200,140,0,0.12)';
const GREEN = '#15803d';
const RED = '#b91c1c';
const AMBER = '#a16207';
const BLUE = '#1d4ed8';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}
const money = (n) =>
  n == null || isNaN(n) ? '—' :
  (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const moneyK = (n) => {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1000000) return sign + '$' + (a / 1000000).toFixed(2) + 'M';
  if (a >= 1000) return sign + '$' + Math.round(a / 1000) + 'K';
  return sign + '$' + Math.round(a);
};
const pct = (n, digits = 1) => (n == null || isNaN(n) ? '—' : n.toFixed(digits) + '%');
const ratioPct = (num, den) => (den ? (num / den) * 100 : null);

/** Signed delta with direction-aware coloring. `goodWhenUp` flips it for costs. */
function Delta({ current, prior, goodWhenUp = true, asPct = false, suffix = '' }) {
  if (current == null || prior == null || !isFinite(current) || !isFinite(prior)) return null;
  const diff = current - prior;
  if (Math.abs(diff) < 0.05) {
    return <span style={{ color: MUTED, fontSize: 11 }}>flat vs last year</span>;
  }
  const up = diff > 0;
  const good = goodWhenUp ? up : !up;
  const relative = !asPct && prior !== 0 ? ` (${up ? '+' : ''}${((diff / Math.abs(prior)) * 100).toFixed(1)}%)` : '';
  return (
    <span style={{ color: good ? GREEN : RED, fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {asPct ? `${up ? '+' : ''}${diff.toFixed(1)} pts` : `${up ? '+' : '-'}${moneyK(Math.abs(diff))}${suffix}`}
      {relative}
      <span style={{ color: MUTED, fontWeight: 400 }}>vs LY</span>
    </span>
  );
}

// ============================================================
// Monthly revenue + profit chart (inline SVG)
// Bars = revenue, stacked cost/overhead shading, line = net margin %.
// ============================================================
function MonthlyChart({ months, asOf }) {
  if (!months || months.length === 0) return null;

  // The current month is almost always partial (e.g. Sep 1-9), which makes
  // its margin meaningless — a 9-day stub with one bad week reads as -880%
  // and flattens every other month on the line. Mark it, keep its bar (the
  // revenue is real), but leave it out of the margin line and the scale.
  const asOfMonth = (asOf || '').slice(0, 7);
  const rows = months.map((m) => ({ ...m, partial: m.month === asOfMonth }));
  const full = rows.filter((m) => !m.partial);

  const W = 900, H = 268, PADL = 58, PADR = 52, PADT = 18, PADB = 40;
  const plotW = W - PADL - PADR, plotH = H - PADT - PADB;
  const maxRev = Math.max(...rows.map((m) => m.revenue), 1);
  const yMax = Math.ceil(maxRev / 100000) * 100000 || 100000;
  const bw = plotW / rows.length;
  const barW = Math.min(46, bw * 0.6);
  const y = (v) => PADT + plotH - (v / yMax) * plotH;

  // Margin axis scaled to the full months only, padded to a round band.
  const marginOf = (m) => (m.revenue > 0 ? (m.net / m.revenue) * 100 : 0);
  const fullMargins = full.map(marginOf);
  const rawMin = fullMargins.length ? Math.min(...fullMargins) : 0;
  const rawMax = fullMargins.length ? Math.max(...fullMargins) : 40;
  const mMin = Math.min(0, Math.floor(rawMin / 10) * 10);
  const mMax = Math.max(20, Math.ceil(rawMax / 10) * 10);
  const my = (v) => PADT + plotH - ((Math.max(mMin, Math.min(mMax, v)) - mMin) / (mMax - mMin)) * plotH;

  // Four evenly spaced, de-duplicated ticks so labels never collide.
  const ticks = Array.from(new Set([0, 1, 2, 3].map((i) => Math.round(mMin + ((mMax - mMin) * i) / 3))));

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = (mm) => MON[Number(mm.split('-')[1]) - 1];

  // Line spans the full months only (contiguous from January).
  const linePts = rows
    .map((m, i) => (m.partial ? null : `${PADL + i * bw + bw / 2},${my(marginOf(m))}`))
    .filter(Boolean)
    .join(' ');

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 620, height: 'auto', display: 'block' }} role="img"
        aria-label="Monthly revenue with job costs, overhead and net margin">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={PADL} x2={W - PADR} y1={y(yMax * f)} y2={y(yMax * f)} stroke={LINE} strokeWidth="1" />
            <text x={PADL - 8} y={y(yMax * f) + 4} textAnchor="end" fontSize="10" fill={MUTED}>{moneyK(yMax * f)}</text>
          </g>
        ))}
        {mMin < 0 && (
          <line x1={PADL} x2={W - PADR} y1={my(0)} y2={my(0)} stroke="rgba(185,28,28,0.22)" strokeWidth="1" strokeDasharray="3 3" />
        )}

        {rows.map((m, i) => {
          const cx = PADL + i * bw + bw / 2;
          const cogsH = (m.cogs / yMax) * plotH;
          const ohH = (m.overhead / yMax) * plotH;
          const revH = (m.revenue / yMax) * plotH;
          return (
            <g key={m.month} opacity={m.partial ? 0.55 : 1}>
              <rect x={cx - barW / 2} y={y(m.revenue)} width={barW} height={Math.max(0, revH)}
                fill="rgba(200,140,0,0.14)" stroke="rgba(200,140,0,0.45)" strokeWidth="1"
                strokeDasharray={m.partial ? '3 2' : undefined} rx="2" />
              <rect x={cx - barW / 2} y={PADT + plotH - cogsH} width={barW} height={Math.max(0, cogsH)}
                fill="rgba(29,78,216,0.55)" rx="1" />
              <rect x={cx - barW / 2} y={PADT + plotH - cogsH - ohH} width={barW} height={Math.max(0, ohH)}
                fill="rgba(161,98,7,0.55)" rx="1" />
              <text x={cx} y={H - PADB + 14} textAnchor="middle" fontSize="10" fill={MUTED}>{label(m.month)}</text>
              {m.partial && (
                <text x={cx} y={H - PADB + 25} textAnchor="middle" fontSize="8" fill={MUTED}>partial</text>
              )}
              <title>{`${m.month}${m.partial ? ' (month in progress)' : ''}\nRevenue ${money(m.revenue)}\nJob costs ${money(m.cogs)}\nOverhead ${money(m.overhead)}\nNet ${money(m.net)}${m.partial ? '' : ` (${pct(marginOf(m))})`}`}</title>
            </g>
          );
        })}

        {linePts && <polyline points={linePts} fill="none" stroke={GREEN} strokeWidth="2" />}
        {rows.map((m, i) => (m.partial ? null : (
          <circle key={m.month} cx={PADL + i * bw + bw / 2} cy={my(marginOf(m))} r="3"
            fill="#fff" stroke={GREEN} strokeWidth="2" />
        )))}
        {ticks.map((v) => (
          <text key={v} x={W - PADR + 8} y={my(v) + 4} fontSize="10" fill={GREEN}>{v}%</text>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: MUTED, paddingLeft: 6, marginTop: 2 }}>
        <Legend color="rgba(200,140,0,0.45)" label="Revenue" outline />
        <Legend color="rgba(29,78,216,0.55)" label="Job costs (COGS)" />
        <Legend color="rgba(161,98,7,0.55)" label="Overhead" />
        <Legend color={GREEN} label="Net margin % (right axis)" line />
        {rows.some((m) => m.partial) && <span>Faded bar = month still in progress, left out of the margin line.</span>}
      </div>
    </div>
  );
}

function Legend({ color, label, line, outline }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{
        width: 12, height: line ? 2 : 10, borderRadius: line ? 0 : 2,
        background: outline ? 'rgba(200,140,0,0.14)' : color,
        border: outline ? `1px solid ${color}` : 'none', display: 'inline-block',
      }} />
      {label}
    </span>
  );
}

// ============================================================
// Page
// ============================================================
export default function CompanyFinancialsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [ohOpen, setOhOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/company-financials', {
        headers: { authorization: `Bearer ${getToken()}` },
        cache: 'no-store',
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || `Load failed (${res.status})`);
      setData(d);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const qb = data?.quickbooks || null;

  // ---- derived headline figures ----
  const d = useMemo(() => {
    if (!qb?.ytd) return null;
    const y = qb.ytd, p = qb.priorYtd || null;
    const gp = y.revenue - y.cogs;
    const pgp = p ? p.revenue - p.cogs : null;
    const draws = qb.ownerDraws?.ytd ?? null;
    // Pace: how far through the year we are, by day count.
    const asOf = qb.asOf ? new Date(qb.asOf + 'T12:00:00Z') : new Date();
    const yearStart = Date.UTC(asOf.getUTCFullYear(), 0, 1);
    const yearEnd = Date.UTC(asOf.getUTCFullYear() + 1, 0, 1);
    const elapsed = (asOf.getTime() - yearStart) / (yearEnd - yearStart);
    const runRate = elapsed > 0 ? y.revenue / elapsed : null;
    const goal = qb.goal || null;

    // Year-end projection. Straight-line from COMPLETE months only: the
    // current month is partial (e.g. Sep 1-9 is 9 days of revenue against a
    // full month of overhead), and including it drags the estimate down by
    // ~$159K on the 2026-09-09 data. Falls back to the day-based run rate
    // in early January when no month has closed yet.
    const asOfMonth = (qb.asOf || '').slice(0, 7);
    const fullMonths = (qb.months || []).filter((m) => m.month !== asOfMonth);
    let projected = null;
    if (fullMonths.length > 0) {
      const f = 12 / fullMonths.length;
      const sum = (k) => fullMonths.reduce((a, m) => a + (Number(m[k]) || 0), 0);
      projected = {
        basis: 'months',
        monthsComplete: fullMonths.length,
        revenue: sum('revenue') * f,
        cogs: sum('cogs') * f,
        overhead: sum('overhead') * f,
        netIncome: sum('net') * f,
      };
    } else if (runRate) {
      projected = {
        basis: 'days', monthsComplete: 0,
        revenue: runRate,
        cogs: y.cogs / elapsed, overhead: y.overhead / elapsed, netIncome: y.netIncome / elapsed,
      };
    }

    return {
      y, p, gp, pgp, draws, elapsed, runRate, goal, projected,
      gpPct: ratioPct(gp, y.revenue),
      pgpPct: p ? ratioPct(pgp, p.revenue) : null,
      cogsPct: ratioPct(y.cogs, y.revenue),
      pcogsPct: p ? ratioPct(p.cogs, p.revenue) : null,
      ohPct: ratioPct(y.overhead, y.revenue),
      pohPct: p ? ratioPct(p.overhead, p.revenue) : null,
      netPct: ratioPct(y.netIncome, y.revenue),
      pnetPct: p ? ratioPct(p.netIncome, p.revenue) : null,
      coachNet: draws != null ? y.netIncome - draws : null,
    };
  }, [qb]);

  // ---- job drawer grouping ----
  const jobsByStage = useMemo(() => {
    const jobs = data?.jobs || [];
    const order = ['In Design', 'Ready', 'In Production', 'Final Billing', 'Closed', 'Other'];
    const map = {};
    for (const j of jobs) (map[j.stage] ||= []).push(j);
    return order.filter((s) => map[s]?.length).map((s) => ({ stage: s, jobs: map[s] }));
  }, [data]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* ---------- header ---------- */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs hover:underline mb-1" style={{ color: MUTED }}>
            <ArrowLeft size={12} /> Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: GOLD, fontFamily: 'Georgia, serif' }}>
            Company Financials
            <span title="Owner-only page" style={{ display: 'inline-flex', color: MUTED }}><Lock size={14} /></span>
          </h1>
          <p className="text-sm mt-1" style={{ color: MUTED }}>
            Whole-company performance: year to date against prior years and goal, profitability, overhead, and cash.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {qb?.asOf && (
            <span className="text-xs text-right hidden sm:block" style={{ color: MUTED }}>
              QuickBooks as of <b style={{ color: INK }}>{qb.asOf}</b>
              {data?.jobsComputedAt && (
                <><br />JobTread jobs as of {new Date(data.jobsComputedAt).toLocaleDateString('en-US')}</>
              )}
            </span>
          )}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50"
            style={{ border: `1px solid ${LINE}`, color: MUTED }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 gap-3" style={{ color: MUTED }}>
          <Loader2 size={22} className="animate-spin" /> Loading company financials…
        </div>
      )}
      {error && !loading && (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.08)', color: RED, border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {/* ---------- no snapshot yet ---------- */}
      {!loading && !error && data && !data.hasSnapshot && (
        <div className="rounded-xl p-5 text-sm" style={{ background: '#fdfcfa', border: '1px dashed rgba(200,140,0,0.35)', color: '#3d3a36' }}>
          <div className="flex items-center gap-2 font-semibold mb-2" style={{ color: GOLD_DK }}>
            <AlertCircle size={15} /> No QuickBooks snapshot yet
          </div>
          <p>
            The Hub cannot query QuickBooks directly, so the figures are pushed in by a scheduled task.
            Ask Claude to run the company financials refresh and this page will fill in.
          </p>
        </div>
      )}

      {!loading && !error && d && (
        <>
          {/* ---------- headline band ---------- */}
          <div className="rounded-xl p-4" style={{ background: '#fff', border: `2px solid rgba(200,140,0,0.30)` }}>
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: GOLD_DK }}>
                Year to date · {qb.fiscalYear || new Date().getFullYear()}
              </p>
              <p className="text-[11px]" style={{ color: MUTED }}>
                {d.y.periodStart} → {d.y.periodEnd} · compared with the same window last year
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Tile label="Revenue" value={money(d.y.revenue)}
                sub={<Delta current={d.y.revenue} prior={d.p?.revenue} />} color={INK} />
              <Tile label="Gross Profit" value={money(d.gp)}
                sub={<>
                  <span style={{ color: INK, fontWeight: 600 }}>{pct(d.gpPct)}</span>{' '}
                  <span style={{ color: MUTED }}>margin</span>{' '}
                  {d.pgpPct != null && <Delta current={d.gpPct} prior={d.pgpPct} asPct />}
                </>} color={INK} />
              <Tile label="Overhead" value={money(d.y.overhead)}
                sub={<>
                  <span style={{ color: d.ohPct > 13 ? RED : INK, fontWeight: 600 }}>{pct(d.ohPct)}</span>{' '}
                  <span style={{ color: MUTED }}>of revenue</span>{' '}
                  {d.pohPct != null && <Delta current={d.ohPct} prior={d.pohPct} asPct goodWhenUp={false} />}
                </>} color={d.ohPct > 13 ? RED : INK} />
              <Tile label="Net Profit" value={money(d.y.netIncome)}
                sub={<>
                  <span style={{ color: d.y.netIncome >= 0 ? GREEN : RED, fontWeight: 600 }}>{pct(d.netPct)}</span>{' '}
                  <span style={{ color: MUTED }}>margin</span>{' '}
                  {d.pnetPct != null && <Delta current={d.netPct} prior={d.pnetPct} asPct />}
                </>} color={d.y.netIncome >= 0 ? GREEN : RED} />
            </div>

            {/* plain-english math + coach framing */}
            <div className="mt-3 pt-3 space-y-1 text-xs" style={{ borderTop: `1px solid ${LINE}`, color: '#5a5550' }}>
              <p>
                Revenue <b style={{ color: INK }}>{money(d.y.revenue)}</b>
                {' '}− job costs <b style={{ color: INK }}>{money(d.y.cogs)}</b> ({pct(d.cogsPct)})
                {' '}− overhead <b style={{ color: INK }}>{money(d.y.overhead)}</b> ({pct(d.ohPct)})
                {' '}= net profit <b style={{ color: d.y.netIncome >= 0 ? GREEN : RED }}>{money(d.y.netIncome)}</b> ({pct(d.netPct)})
              </p>
              {d.draws != null && (
                <p>
                  Owner draws YTD <b style={{ color: INK }}>{money(d.draws)}</b> →
                  {' '}coach-framework net{' '}
                  <b style={{ color: d.coachNet >= 0 ? GREEN : RED }}>{money(d.coachNet)}</b>.
                  <span style={{ color: MUTED }}>
                    {' '}Draws are S-corp distributions from retained earnings, not an operating expense — which is why the two figures differ.
                  </span>
                </p>
              )}
              {d.projected ? (
                <p>
                  Pace: {(d.elapsed * 100).toFixed(0)}% through the year. At this rate the year ends near{' '}
                  <b style={{ color: INK }}>{moneyK(d.projected.revenue)}</b> revenue and{' '}
                  <b style={{ color: d.projected.netIncome >= 0 ? GREEN : RED }}>{moneyK(d.projected.netIncome)}</b> net
                  {d.goal?.revenue ? (
                    <>
                      {' '}vs goal <b style={{ color: INK }}>{moneyK(d.goal.revenue)}</b>{' '}
                      <b style={{ color: d.projected.revenue >= d.goal.revenue ? GREEN : RED }}>
                        ({d.projected.revenue >= d.goal.revenue ? '+' : ''}{moneyK(d.projected.revenue - d.goal.revenue)})
                      </b>
                    </>
                  ) : null}
                  <span style={{ color: MUTED }}>
                    {' '}Straight-line from {d.projected.basis === 'months'
                      ? `${d.projected.monthsComplete} complete month${d.projected.monthsComplete === 1 ? '' : 's'}`
                      : 'days elapsed'}.
                  </span>
                </p>
              ) : null}
            </div>
          </div>

          {/* ---------- year over year ---------- */}
          <Section
            title="Year over year"
            note={`Full prior years from QuickBooks, this year to date, the year-end projection${d.projected ? ` (straight-line from ${d.projected.monthsComplete} complete month${d.projected.monthsComplete === 1 ? '' : 's'}, so the part-finished month does not drag it down)` : ''}, and the ${qb.goal?.year || ''} goal.`}
          >
            <YoyTable qb={qb} d={d} />
          </Section>

          {/* ---------- monthly trend ---------- */}
          {qb.months?.length > 0 && (
            <Section title="Revenue and profit by month" note="Bars are revenue with job costs and overhead stacked inside; the green line is net margin.">
              <MonthlyChart months={qb.months} asOf={qb.asOf} />
            </Section>
          )}

          {/* ---------- overhead ---------- */}
          {qb.overheadCategories?.length > 0 && (
            <Section
              title="Overhead tracking"
              note={`${money(d.y.overhead)} YTD · ${pct(d.ohPct)} of revenue${d.goal?.overhead && d.goal?.revenue ? ` · goal ${pct(ratioPct(d.goal.overhead, d.goal.revenue), 0)}` : ''}`}
            >
              <OverheadPanel
                categories={qb.overheadCategories}
                total={d.y.overhead}
                revenue={d.y.revenue}
                priorOverhead={d.p?.overhead}
                priorRevenue={d.p?.revenue}
                goalPct={d.goal?.overhead && d.goal?.revenue ? ratioPct(d.goal.overhead, d.goal.revenue) : null}
                open={ohOpen}
                setOpen={setOhOpen}
              />
            </Section>
          )}

          {/* ---------- cash + position ---------- */}
          {qb.position && (
            <Section title="Cash and position" note={`Balance sheet as of ${qb.asOf}. Prior-year-end shown for comparison.`}>
              <PositionPanel position={qb.position} receivables={qb.receivables} payables={qb.payables} />
            </Section>
          )}

          {/* ---------- job profitability drawer ---------- */}
          <div className="rounded-xl" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <button type="button" onClick={() => setJobsOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-stone-50 rounded-xl">
              {jobsOpen ? <ChevronDown size={16} style={{ color: MUTED }} /> : <ChevronRight size={16} style={{ color: MUTED }} />}
              <span className="text-sm font-semibold" style={{ color: INK }}>Job profitability at current stage</span>
              <span className="text-xs" style={{ color: MUTED }}>
                {data.jobTotals?.count || 0} jobs · received {moneyK(data.jobTotals?.collected)} · cost {moneyK(data.jobTotals?.costToDate)} · projected profit {moneyK(data.jobTotals?.projectedProfit)}
              </span>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{ background: 'rgba(200,140,0,0.10)', color: GOLD_DK }}>JobTread</span>
            </button>
            {jobsOpen && <JobTable groups={jobsByStage} totals={data.jobTotals} />}
          </div>

          <p className="text-[11px] pt-1" style={{ color: MUTED }}>
            QuickBooks figures are a snapshot pushed in by a scheduled task (the Hub has no direct QuickBooks
            connection) — as of {qb.asOf}. Job figures come from the Job Costing cache, so they match that page.
            COGS = 4000 Direct Job Costs + 4500 Indirect Job Costs; overhead = all other expenses.
          </p>
        </>
      )}
    </div>
  );
}

// ============================================================
// Presentational pieces
// ============================================================
function Tile({ label, value, sub, color }) {
  return (
    <div>
      <p className="text-xs mb-1" style={{ color: MUTED }}>{label}</p>
      <p className="text-2xl font-bold leading-tight" style={{ color }}>{value}</p>
      <p className="text-[11px] mt-1 flex flex-wrap items-center gap-1.5">{sub}</p>
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="mb-3">
        <h2 className="text-sm font-bold" style={{ color: INK }}>{title}</h2>
        {note && <p className="text-xs mt-0.5" style={{ color: MUTED }}>{note}</p>}
      </div>
      {children}
    </div>
  );
}

/** Year-over-year comparison. Full years + this YTD + prior YTD + goal. */
function YoyTable({ qb, d }) {
  const cols = [];
  for (const yr of qb.years || []) {
    cols.push({ key: `fy${yr.year}`, label: `${yr.year}`, sub: 'full year', data: yr });
  }
  if (d.p) cols.push({ key: 'pytd', label: `${new Date(d.p.periodEnd).getUTCFullYear()} YTD`, sub: 'same window', data: d.p, dim: true });
  cols.push({ key: 'ytd', label: `${qb.fiscalYear} YTD`, sub: 'current', data: d.y, highlight: true });
  if (d.projected) {
    cols.push({
      key: 'proj',
      label: `${qb.fiscalYear} projected`,
      sub: d.projected.basis === 'months' ? `${d.projected.monthsComplete} mo run rate` : 'run rate',
      data: d.projected,
      projected: true,
    });
  }
  if (qb.goal) cols.push({ key: 'goal', label: `${qb.goal.year} goal`, sub: 'target', data: qb.goal, goal: true });

  const rows = [
    { label: 'Revenue', get: (x) => x.revenue, pctOf: false },
    { label: 'Job costs (COGS)', get: (x) => x.cogs, pctOf: true, invert: true },
    { label: 'Gross profit', get: (x) => x.revenue - x.cogs, pctOf: true },
    { label: 'Overhead', get: (x) => x.overhead, pctOf: true, invert: true },
    { label: 'Net profit', get: (x) => x.netIncome, pctOf: true, strong: true },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 640 }}>
        <thead>
          <tr>
            <th className="text-left" style={{ padding: '6px 8px', color: MUTED, fontSize: 11, fontWeight: 500 }} />
            {cols.map((c) => (
              <th key={c.key} className="text-right" style={{
                padding: '6px 8px', fontSize: 11, fontWeight: 700,
                color: c.highlight ? GOLD_DK : c.goal ? BLUE : c.projected ? '#6d28d9' : c.dim ? MUTED : INK,
                borderBottom: `1px solid ${LINE}`,
                background: c.highlight ? 'rgba(200,140,0,0.05)' : c.projected ? 'rgba(124,58,237,0.05)' : undefined,
              }}>
                {c.label}
                <div style={{ fontWeight: 400, color: MUTED, fontSize: 10 }}>{c.sub}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={{ padding: '7px 8px', color: INK, fontWeight: r.strong ? 700 : 500, borderBottom: `1px solid rgba(200,140,0,0.06)` }}>
                {r.label}
              </td>
              {cols.map((c) => {
                const v = r.get(c.data);
                const p = r.pctOf ? ratioPct(v, c.data.revenue) : null;
                // On the projected column, flag the gap to goal for the two
                // rows that drive the conversation: revenue and net profit.
                const gap = c.projected && qb.goal && (r.label === 'Revenue' || r.strong)
                  ? v - r.get(qb.goal) : null;
                return (
                  <td key={c.key} className="text-right" style={{
                    padding: '7px 8px', borderBottom: `1px solid rgba(200,140,0,0.06)`,
                    background: c.highlight ? 'rgba(200,140,0,0.05)' : c.projected ? 'rgba(124,58,237,0.05)' : undefined,
                    color: c.dim ? MUTED : INK, fontWeight: r.strong ? 700 : 400,
                  }}
                    title={gap != null ? `${money(gap)} vs goal` : undefined}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{moneyK(v)}</span>
                    {p != null && (
                      <span style={{ color: MUTED, fontSize: 11, marginLeft: 5, fontVariantNumeric: 'tabular-nums' }}>
                        {pct(p, 0)}
                      </span>
                    )}
                    {gap != null && (
                      <div style={{ fontSize: 10, fontWeight: 600, color: gap >= 0 ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>
                        {gap >= 0 ? '+' : ''}{moneyK(gap)} vs goal
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Overhead: % of revenue vs goal, plus category bars. */
function OverheadPanel({ categories, total, revenue, priorOverhead, priorRevenue, goalPct, open, setOpen }) {
  const sorted = [...categories].sort((a, b) => b.amount - a.amount);
  const shown = open ? sorted : sorted.slice(0, 6);
  const max = Math.max(...sorted.map((c) => c.amount), 1);
  const ohPct = ratioPct(total, revenue);
  const priorPct = priorOverhead != null && priorRevenue ? ratioPct(priorOverhead, priorRevenue) : null;
  const overGoal = goalPct != null && ohPct > goalPct;

  return (
    <div className="space-y-3">
      {/* % of revenue meter vs goal */}
      <div className="rounded-lg p-3" style={{ background: overGoal ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)', border: `1px solid ${overGoal ? 'rgba(239,68,68,0.20)' : 'rgba(34,197,94,0.20)'}` }}>
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2 text-xs">
          <span style={{ color: INK, fontWeight: 600 }}>
            Overhead is <span style={{ color: overGoal ? RED : GREEN }}>{pct(ohPct)}</span> of revenue
            {goalPct != null && <span style={{ color: MUTED, fontWeight: 400 }}> · goal {pct(goalPct, 0)}</span>}
          </span>
          {priorPct != null && (
            <span style={{ color: MUTED }}>
              last year same window {pct(priorPct)}{' '}
              <b style={{ color: ohPct > priorPct ? RED : GREEN }}>
                ({ohPct > priorPct ? '+' : ''}{(ohPct - priorPct).toFixed(1)} pts)
              </b>
            </span>
          )}
        </div>
        <div style={{ position: 'relative', height: 10, background: '#eee7dc', borderRadius: 999 }}>
          <div style={{
            width: `${Math.min(100, (ohPct / Math.max(ohPct, goalPct || 0, 20)) * 100)}%`,
            height: '100%', borderRadius: 999, background: overGoal ? RED : GREEN, opacity: 0.75,
          }} />
          {goalPct != null && (
            <div title={`Goal ${pct(goalPct, 0)}`} style={{
              position: 'absolute', top: -3, height: 16, width: 2, background: INK,
              left: `${Math.min(100, (goalPct / Math.max(ohPct, goalPct, 20)) * 100)}%`,
            }} />
          )}
        </div>
      </div>

      {/* category bars */}
      <div className="space-y-1.5">
        {shown.map((c) => (
          <div key={c.label} className="flex items-center gap-2 text-xs">
            <span className="truncate" style={{ width: '38%', color: INK }} title={c.label}>{c.label}</span>
            <div className="flex-1" style={{ height: 14, background: '#f6f1e8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(c.amount / max) * 100}%`, height: '100%', background: 'rgba(161,98,7,0.55)' }} />
            </div>
            <span className="text-right" style={{ width: 76, color: INK, fontVariantNumeric: 'tabular-nums' }}>{moneyK(c.amount)}</span>
            <span className="text-right" style={{ width: 40, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
              {pct(ratioPct(c.amount, total), 0)}
            </span>
          </div>
        ))}
      </div>
      {sorted.length > 6 && (
        <button onClick={() => setOpen(!open)} className="text-xs hover:underline" style={{ color: GOLD_DK }}>
          {open ? 'Show top 6 only' : `Show all ${sorted.length} categories`}
        </button>
      )}
    </div>
  );
}

/** Cash, working capital, ratios, A/R and A/P. */
function PositionPanel({ position, receivables, payables }) {
  const p = position, pye = position.priorYearEnd || null;
  const items = [
    { label: 'Cash', value: money(p.cash), prior: pye?.cash, icon: <Wallet size={12} /> },
    { label: 'Working capital', value: money(p.workingCapital), prior: pye?.workingCapital },
    { label: 'Current ratio', value: p.currentRatio != null ? p.currentRatio.toFixed(2) : '—', prior: pye?.currentRatio, plain: true },
    { label: 'Accounts receivable', value: money(p.accountsReceivable), prior: pye?.accountsReceivable },
    { label: 'Accounts payable', value: money(p.accountsPayable) },
    { label: 'Billings in excess of costs', value: money(p.billingsInExcess), hint: 'Client money collected ahead of work performed — a liability, not profit.' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg p-3" style={{ background: '#fdfcfa', border: `1px solid ${LINE}` }}>
            <p className="text-[11px] mb-1 flex items-center gap-1" style={{ color: MUTED }} title={it.hint}>
              {it.icon}{it.label}
            </p>
            <p className="text-lg font-bold" style={{ color: INK }}>{it.value}</p>
            {it.prior != null && (
              <p className="text-[10px]" style={{ color: MUTED }}>
                year-end {it.plain ? Number(it.prior).toFixed(2) : moneyK(it.prior)}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* receivables / payables exposure */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {receivables && (
          <div className="rounded-lg p-3" style={{ background: '#fdfcfa', border: `1px solid ${LINE}` }}>
            <p className="text-xs font-semibold mb-1.5" style={{ color: INK }}>Receivables exposure</p>
            {receivables.over90 != null && (
              <p className="text-[11px] mb-1.5" style={{ color: receivables.over90 > 0 ? RED : GREEN }}>
                {money(receivables.over90)} sitting 91+ days
              </p>
            )}
            {(receivables.topCustomers || []).map((c) => (
              <div key={c.name} className="flex justify-between text-[11px]" style={{ color: '#3d3a36' }}>
                <span className="truncate">{c.name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(c.amount)}</span>
              </div>
            ))}
            {receivables.note && <p className="text-[10px] mt-1.5" style={{ color: MUTED }}>{receivables.note}</p>}
          </div>
        )}
        {payables && (
          <div className="rounded-lg p-3" style={{ background: '#fdfcfa', border: `1px solid ${LINE}` }}>
            <p className="text-xs font-semibold mb-1.5" style={{ color: INK }}>Payables</p>
            <p className="text-[11px] mb-1.5" style={{ color: MUTED }}>
              {money(payables.total)} owed{payables.over90 != null ? ` · ${money(payables.over90)} at 91+ days` : ''}
            </p>
            {(payables.topVendors || []).map((v) => (
              <div key={v.name} className="flex justify-between text-[11px]" style={{ color: '#3d3a36' }}>
                <span className="truncate">{v.name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Per-job table inside the drawer, grouped by stage. */
function JobTable({ groups, totals }) {
  const cols = '1.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.7fr';
  return (
    <div className="px-3 pb-3">
      <div className="grid gap-2 px-2 py-2 text-[11px] font-medium"
        style={{ gridTemplateColumns: cols, color: MUTED, borderBottom: `1px solid ${LINE}` }}>
        <div>Job</div>
        <div className="text-right">Contract</div>
        <div className="text-right">Received</div>
        <div className="text-right">Cost to date</div>
        <div className="text-right">Proj. profit</div>
        <div className="text-right">Margin</div>
      </div>
      {groups.map((g) => (
        <div key={g.stage}>
          <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ color: GOLD_DK, background: 'rgba(200,140,0,0.05)' }}>
            {g.stage} <span style={{ color: MUTED, fontWeight: 400 }}>({g.jobs.length})</span>
          </div>
          {g.jobs.map((j) => (
            <div key={j.jobId} className="grid gap-2 px-2 py-2 text-xs items-center"
              style={{ gridTemplateColumns: cols, borderBottom: `1px solid rgba(200,140,0,0.06)` }}>
              <div className="min-w-0">
                <div className="truncate" style={{ color: INK, fontWeight: 600 }}>
                  <span style={{ color: GOLD_DK, fontFamily: 'monospace', marginRight: 5 }}>#{j.jobNumber}</span>
                  {j.clientName || j.jobName}
                </div>
                <div className="truncate text-[10px]" style={{ color: MUTED }}>
                  {j.jobName}{j.isCostPlus ? ' · Cost+' : ''}
                </div>
              </div>
              <div className="text-right" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{moneyK(j.contract)}</div>
              <div className="text-right" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }} title={`Invoiced ${money(j.invoiced)}`}>
                {moneyK(j.collected)}
              </div>
              <div className="text-right" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{moneyK(j.costToDate)}</div>
              <div className="text-right" style={{ color: j.projectedProfit >= 0 ? GREEN : RED, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {moneyK(j.projectedProfit)}
              </div>
              <div className="text-right" style={{ color: j.projectedMarginPct >= 15 ? GREEN : j.projectedMarginPct >= 5 ? AMBER : RED, fontVariantNumeric: 'tabular-nums' }}>
                {pct(j.projectedMarginPct, 0)}
              </div>
            </div>
          ))}
        </div>
      ))}
      {/* totals */}
      <div className="grid gap-2 px-2 py-2 text-xs items-center"
        style={{ gridTemplateColumns: cols, borderTop: `2px solid ${LINE}`, fontWeight: 700, color: INK }}>
        <div>All jobs ({totals?.count || 0})</div>
        <div className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{moneyK(totals?.contract)}</div>
        <div className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{moneyK(totals?.collected)}</div>
        <div className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{moneyK(totals?.costToDate)}</div>
        <div className="text-right" style={{ color: (totals?.projectedProfit || 0) >= 0 ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>
          {moneyK(totals?.projectedProfit)}
        </div>
        <div className="text-right" style={{ color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
          {pct(ratioPct(totals?.projectedProfit || 0, totals?.contract || 0), 0)}
        </div>
      </div>
      <p className="text-[10px] mt-2" style={{ color: MUTED }}>
        Same figures as the Job Costing page: "Received" is cash collected, "Cost to date" is paid plus pending
        job costs, and "Proj. profit" is the contract less projected cost at completion.
      </p>
    </div>
  );
}
