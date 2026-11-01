// @ts-nocheck
'use client';

/**
 * Personal & Investments: Nathan-only dashboard.
 *
 * Reads the snapshot the monthly close writes from Stessa (rentals, Seth
 * Bryan note interest, personal spending, BKB bill-backs). Nothing here is
 * live: every figure is as of the last closed month, shown at the top.
 * The API refuses anyone but Nathan (user id + PIN check).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Lock, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';

const GOLD = '#c88c00';
const INK = '#1a1a1a';
const MUTED = '#8a8078';
const LINE = 'rgba(200,140,0,0.12)';
const GREEN = '#15803d';
const RED = '#b91c1c';
const BLUE = '#1d4ed8';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}
const money = (n) =>
  n == null || isNaN(n) ? '-' : (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const money2 = (n) =>
  n == null || isNaN(n) ? '-' : (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m) => {
  const [y, mo] = (m || '').split('-').map(Number);
  if (!y) return m;
  return new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'short' });
};
const longMonth = (m) => {
  const [y, mo] = (m || '').split('-').map(Number);
  if (!y) return m;
  return new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};

const card = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 18 };
const h2 = { fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 12px' };

function Tile({ label, value, sub, color = INK }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/** Paired income / expense bars per month (inline SVG). */
function IncomeExpenseChart({ months }) {
  if (!months?.length) return null;
  const W = 760, H = 220, PADL = 52, PADB = 28, PADT = 10, PADR = 10;
  const plotW = W - PADL - PADR, plotH = H - PADT - PADB;
  const max = Math.max(...months.map((m) => Math.max(m.i, m.e)), 1);
  const step = max > 20000 ? 10000 : 5000;
  const yMax = Math.ceil(max / step) * step;
  const y = (v) => PADT + plotH - (v / yMax) * plotH;
  const bw = plotW / months.length;
  const bar = Math.min(18, bw * 0.32);
  const ticks = [];
  for (let v = 0; v <= yMax; v += step) ticks.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Monthly rental income and expenses">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} stroke="#eee" />
          <text x={PADL - 6} y={y(v) + 4} fontSize="10" fill={MUTED} textAnchor="end">{'$' + Math.round(v / 1000) + 'K'}</text>
        </g>
      ))}
      {months.map((m, idx) => {
        const cx = PADL + bw * idx + bw / 2;
        return (
          <g key={m.m}>
            <rect x={cx - bar - 1} y={y(m.i)} width={bar} height={PADT + plotH - y(m.i)} fill={GREEN} rx="2">
              <title>{`${longMonth(m.m)} income ${money(m.i)}`}</title>
            </rect>
            <rect x={cx + 1} y={y(m.e)} width={bar} height={PADT + plotH - y(m.e)} fill={GOLD} rx="2">
              <title>{`${longMonth(m.m)} expenses ${money(m.e)}`}</title>
            </rect>
            <text x={cx} y={H - 10} fontSize="10" fill={MUTED} textAnchor="middle">{monthLabel(m.m)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function HBar({ label, amount, max, color = GOLD }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 200px) 1fr 80px', gap: 10, alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
      <div style={{ color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ background: '#f5f1ea', borderRadius: 4, height: 10 }}>
        <div style={{ width: `${Math.max(1, (amount / max) * 100)}%`, background: color, height: 10, borderRadius: 4 }} />
      </div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(amount)}</div>
    </div>
  );
}

function PropertyRow({ p }) {
  const [open, setOpen] = useState(false);
  const margin = p.income > 0 ? (p.net / p.income) * 100 : null;
  return (
    <>
      <tr onClick={() => setOpen(!open)} style={{ cursor: 'pointer', borderTop: `1px solid ${LINE}` }}>
        <td style={{ padding: '10px 6px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{p.name}
          </span>
          <div style={{ fontSize: 11, color: MUTED, marginLeft: 20 }}>{p.type}, {p.status}</div>
        </td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(p.income)}</td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(p.expenses)}</td>
        <td style={{ textAlign: 'right', fontWeight: 700, color: p.net >= 0 ? GREEN : RED, fontVariantNumeric: 'tabular-nums' }}>{money(p.net)}</td>
        <td style={{ textAlign: 'right', color: MUTED }}>{margin == null ? '-' : margin.toFixed(0) + '%'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ padding: '4px 6px 14px 26px' }}>
            <div style={{ fontSize: 12, color: MUTED, margin: '4px 0 6px' }}>Largest expenses this year</div>
            {(p.topExpenses || []).map((e) => (
              <HBar key={e.label} label={e.label} amount={e.amount} max={p.topExpenses[0]?.amount || 1} />
            ))}
            {p.capex > 0 && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>Capital improvements (not in expenses): {money(p.capex)}</div>}
            <IncomeExpenseChart months={p.months} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Category by month grid. Rows are categories (largest YTD first), columns are
 * months, plus an average and a YTD column, and a totals row.
 *
 * The close sums in cents and divides only at the end, so every row here adds
 * to the same YTD figure the category list shows and every column adds to the
 * same month figure. If those ever disagree on screen, the close is at fault,
 * not this table.
 *
 * A cell is tinted when it runs 25% or more above that category's own monthly
 * average, so the months that drove a category stand out without reading every
 * number.
 */
function SpendingGrid({ cm }) {
  const months = cm?.months || [];
  const cats = cm?.categories || [];
  if (!months.length || !cats.length) return null;

  const rows = cats.map((c) => {
    const amounts = c.amounts || [];
    const ytd = amounts.reduce((a, v) => a + (Number(v) || 0), 0);
    return { label: c.label, amounts, ytd, avg: ytd / months.length };
  });
  const colTotals = months.map((_, i) => rows.reduce((a, r) => a + (Number(r.amounts[i]) || 0), 0));
  const grand = rows.reduce((a, r) => a + r.ytd, 0);

  const th = { padding: '6px 8px', textAlign: 'right', fontSize: 10, color: MUTED, textTransform: 'uppercase', whiteSpace: 'nowrap' };
  const td = { padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  const stickyL = { position: 'sticky', left: 0, background: '#fff', zIndex: 1 };

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${LINE}` }}>
            <th style={{ ...th, textAlign: 'left', ...stickyL }}>Category</th>
            {months.map((m) => <th key={m} style={th}>{monthLabel(m)}</th>)}
            <th style={{ ...th, color: BLUE }}>Avg/mo</th>
            <th style={{ ...th, color: INK }}>YTD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} style={{ borderTop: `1px solid ${LINE}` }}>
              <td style={{ ...td, textAlign: 'left', ...stickyL }}>{r.label}</td>
              {r.amounts.map((v, i) => {
                const n = Number(v) || 0;
                const hot = r.avg > 0 && n >= r.avg * 1.25;
                return (
                  <td key={i} style={{ ...td, background: hot ? 'rgba(200,140,0,0.11)' : undefined, color: n === 0 ? '#c9c2b6' : INK }}>
                    {n === 0 ? '-' : money(n)}
                  </td>
                );
              })}
              <td style={{ ...td, color: BLUE, fontWeight: 600 }}>{money(r.avg)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{money(r.ytd)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${LINE}`, fontWeight: 700 }}>
            <td style={{ ...td, textAlign: 'left', ...stickyL }}>Total</td>
            {colTotals.map((t, i) => <td key={i} style={td}>{money(t)}</td>)}
            <td style={{ ...td, color: BLUE }}>{money(grand / months.length)}</td>
            <td style={td}>{money(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function PersonalInvestmentsPage() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    fetch('/api/dashboard/personal-investments', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
        return j;
      })
      .then((data) => setState({ loading: false, error: null, data }))
      .catch((e) => setState({ loading: false, error: e.message, data: null }));
  }, []);

  if (state.loading) {
    return <div style={{ padding: 40, color: MUTED, display: 'flex', gap: 8 }}><Loader2 className="animate-spin" size={18} /> Loading</div>;
  }
  if (state.error) {
    return (
      <div style={{ padding: 40, color: INK, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Lock size={18} color={MUTED} /> {state.error}
      </div>
    );
  }
  const d = state.data;
  if (!d?.hasSnapshot) {
    return <div style={{ padding: 40, color: MUTED }}>No monthly close has run yet. The first one writes this page.</div>;
  }
  const s = d.snapshot;
  const props = s.properties || [];
  const rentalNet = props.reduce((a, p) => a + (p.net || 0), 0);
  const rentalIncome = props.reduce((a, p) => a + (p.income || 0), 0);
  const noteInterest = (s.notes || []).reduce((a, n) => a + (n.interest || 0), 0);
  const unbilled = (s.bkbReimbursable?.unbilled || []).reduce((a, i) => a + (i.amount || 0), 0);

  // Combined rental months for the portfolio chart.
  const monthKeys = props[0]?.months?.map((m) => m.m) || [];
  const combined = monthKeys.map((m) => ({
    m,
    i: props.reduce((a, p) => a + (p.months.find((x) => x.m === m)?.i || 0), 0),
    e: props.reduce((a, p) => a + (p.months.find((x) => x.m === m)?.e || 0), 0),
  }));

  const pers = s.personal || {};
  const completeMonths = (pers.months || []).filter((m) => !pers.completeFrom || m.m >= pers.completeFrom);
  const avgMonthly = completeMonths.length ? completeMonths.reduce((a, m) => a + m.amount, 0) / completeMonths.length : null;
  const maxCat = pers.categories?.[0]?.amount || 1;
  const maxPersMonth = Math.max(...(pers.months || []).map((m) => m.amount), 1);
  // The grid only exists on closes from 2026-11-03 onward (and the backfilled
  // October row). Older snapshots fall back to the two bar lists.
  const hasGrid = !!(pers.categoryMonths?.months?.length && pers.categoryMonths?.categories?.length);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 60px', color: INK }}>
      <Link href="/dashboard" style={{ color: MUTED, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
        <ArrowLeft size={14} /> Dashboard
      </Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8, margin: '10px 0 18px' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Personal &amp; Investments</h1>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
            <Lock size={12} style={{ verticalAlign: '-1px' }} /> Only visible to you. Year to date through {longMonth(s.period)}, from Stessa.
          </div>
        </div>
        <div style={{ fontSize: 12, color: MUTED }}>
          Last close: {d.computedAt ? new Date(d.computedAt).toLocaleDateString('en-US') : '-'}
          {s.health?.openQuestions ? ` · ${s.health.openQuestions} open bookkeeping question${s.health.openQuestions > 1 ? 's' : ''}` : ''}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Tile label="Rental net income YTD" value={money(rentalNet)} sub={`${money(rentalIncome)} collected`} color={rentalNet >= 0 ? GREEN : RED} />
        <Tile label="Note interest YTD" value={money(noteInterest)} sub="Seth Bryan notes" color={BLUE} />
        <Tile label="Personal spending" value={avgMonthly == null ? '-' : money(avgMonthly) + '/mo'} sub={pers.completeFrom ? `average since ${longMonth(pers.completeFrom)}` : 'monthly average'} />
        <Tile label="Owed back by BKB" value={money2(unbilled)} sub={unbilled ? 'not billed yet' : `all billed through ${s.bkbReimbursable?.billedThrough || '-'}`} />
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <h2 style={h2}>Rental properties</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: 6 }}>Property</th>
                <th style={{ textAlign: 'right' }}>Income</th>
                <th style={{ textAlign: 'right' }}>Expenses</th>
                <th style={{ textAlign: 'right' }}>Net</th>
                <th style={{ textAlign: 'right' }}>Margin</th>
              </tr>
            </thead>
            <tbody>{props.map((p) => <PropertyRow key={p.id} p={p} />)}</tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: MUTED, margin: '14px 0 4px' }}>
          All rentals by month <span style={{ color: GREEN }}>■</span> income <span style={{ color: GOLD }}>■</span> expenses
        </div>
        <IncomeExpenseChart months={combined} />
        <div style={{ fontSize: 11, color: MUTED }}>48 S 6th St is not shown while it is held in the 1031 exchange; BKB is carrying its renovation costs.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div style={card}>
          <h2 style={h2}>Seth Bryan notes</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: 6 }}>Property</th>
                <th style={{ textAlign: 'right' }}>Interest YTD</th>
                <th style={{ textAlign: 'right' }}>Last payment</th>
              </tr>
            </thead>
            <tbody>
              {(s.notes || []).map((n) => (
                <tr key={n.id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={{ padding: '8px 6px' }}>{n.name}<div style={{ fontSize: 11, color: MUTED }}>{n.status}</div></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(n.interest)}</td>
                  <td style={{ textAlign: 'right', color: MUTED }}>{n.lastPayment ? new Date(n.lastPayment + 'T12:00:00').toLocaleDateString('en-US') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={card}>
          <h2 style={h2}>BKB bill-backs</h2>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            Billed through {s.bkbReimbursable?.billedThrough}: <b>{money2(s.bkbReimbursable?.billedTotal)}</b>
            <div style={{ fontSize: 12, color: MUTED }}>{s.bkbReimbursable?.billedNote}</div>
          </div>
          {(s.bkbReimbursable?.unbilled || []).length === 0 ? (
            <div style={{ fontSize: 13, color: GREEN }}>Nothing new to bill back.</div>
          ) : (
            (s.bkbReimbursable.unbilled || []).map((i, k) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderTop: `1px solid ${LINE}` }}>
                <span>{i.date} {i.vendor}</span><span>{money2(i.amount)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>Personal spending</h2>
        {pers.coverageNote && (
          <div style={{ fontSize: 12, color: '#7c5a00', background: '#fdf6e3', borderRadius: 8, padding: '8px 10px', marginBottom: 12, display: 'flex', gap: 6 }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {pers.coverageNote}
          </div>
        )}
        {hasGrid ? (
          <>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
              Every category by month, with its own monthly average. Shaded cells ran 25% or more above
              that category's average. Totals: {money(pers.total)} year to date,
              {' '}{avgMonthly == null ? '-' : money(avgMonthly)} a month.
            </div>
            <SpendingGrid cm={pers.categoryMonths} />
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
            <div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>By category, year to date ({money(pers.total)})</div>
              {(pers.categories || []).map((c) => <HBar key={c.label} label={c.label} amount={c.amount} max={maxCat} />)}
            </div>
            <div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>By month</div>
              {(pers.months || []).map((m) => (
                <HBar
                  key={m.m}
                  label={longMonth(m.m)}
                  amount={m.amount}
                  max={maxPersMonth}
                  color={pers.completeFrom && m.m < pers.completeFrom ? '#d9d3c7' : BLUE}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
