// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import { Loader2, ArrowLeft, RefreshCw, AlertTriangle, TrendingDown, TrendingUp, Minus, Save, Check } from 'lucide-react';
import { useParams } from 'next/navigation';

function getAuthToken() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
  return `Bearer ${token}`;
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined) return '-';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`;
}

function pct(n: number | null | undefined, dec = 0) {
  if (n === null || n === undefined) return '-';
  return `${n.toFixed(dec)}%`;
}

type Division = {
  name: string;
  budgetedCost: number;
  actualCost: number;
  variance: number;
  variancePct: number;
  pctOfBudget: number;
  itemCount: number;
};

type Detail = {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  priceType: string;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  manualPercentComplete: number | null;
  progressSetBy: string | null;
  progressSetAt: string | null;
  totals: {
    budgetedCost: number;
    actualCost: number;
    variance: number;
    variancePct: number;
    pctOfBudget: number;
  };
  divisions: Division[];
  generatedAt: string;
};

export default function PmJobDetailPage() {
  const params = useParams();
  const jobId = params.jobId as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pctDraft, setPctDraft] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function loadData() {
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/pm-portfolio/${jobId}`, {
        headers: { Authorization: getAuthToken() },
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDetail(data);
      setPctDraft(data.manualPercentComplete ?? 0);
    } catch (e: any) {
      setError(e.message || 'Failed to load job detail');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function saveProgress() {
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/pm-portfolio/${jobId}`, {
        method: 'PUT',
        headers: { Authorization: getAuthToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ percentComplete: pctDraft }),
      });
      if (!res.ok) throw new Error('save failed');
      setSavedAt(Date.now());
      if (detail) {
        setDetail({ ...detail, manualPercentComplete: pctDraft, progressSetAt: new Date().toISOString() });
      }
    } catch {
      setError('Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { loadData(); }, [jobId]);

  function varianceColor(v: number, base: number) {
    if (base === 0) return '#666';
    const ratio = v / base;
    if (ratio > 0.05) return '#c0392b';
    if (ratio < -0.05) return '#0d7a3a';
    return '#666';
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif', color: '#1a1a1a' }}>
      <a href="/dashboard/pm-portfolio" style={{ color: '#68050a', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Portfolio
      </a>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#666' }}>
          <Loader2 size={16} className="spin" /> Loading job cost detail...
        </div>
      )}

      {error && (
        <div style={{ background: '#fdecea', color: '#c0392b', padding: 12, borderRadius: 6, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {detail && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ color: '#68050a', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>Cost Detail</div>
              <h1 style={{ margin: '4px 0 0', fontSize: 24, color: '#68050a', fontWeight: 700 }}>{detail.jobName}</h1>
              <div style={{ color: '#666', fontSize: 13, marginTop: 2 }}>
                #{detail.jobNumber} · {detail.clientName} · {detail.priceType === 'fixed' ? 'Fixed Price' : 'Cost Plus'}
              </div>
              {detail.scheduleStart && detail.scheduleEnd && (
                <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                  Schedule: {detail.scheduleStart} to {detail.scheduleEnd}
                </div>
              )}
            </div>
            <button
              onClick={() => { setRefreshing(true); loadData(); }}
              disabled={refreshing}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#68050a', color: '#e8c860', padding: '8px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              {refreshing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              Refresh
            </button>
          </div>

          {/* Overall % Complete edit row */}
          <div style={{ background: '#ffffff', border: '1px solid #eee5d8', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#68050a', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Overall % Complete
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={pctDraft}
                onChange={(e) => setPctDraft(Number(e.target.value))}
                style={{ flex: '1 1 320px', accentColor: '#68050a' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={pctDraft}
                  onChange={(e) => setPctDraft(Math.max(0, Math.min(100, Number(e.target.value))))}
                  style={{ width: 60, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}
                />
                <span style={{ fontSize: 13, color: '#666' }}>%</span>
              </div>
              <button
                onClick={saveProgress}
                disabled={saving || pctDraft === (detail.manualPercentComplete ?? 0)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: pctDraft !== (detail.manualPercentComplete ?? 0) ? '#68050a' : '#ccc',
                  color: '#ffffff', border: 'none',
                  padding: '8px 14px', borderRadius: 4,
                  cursor: pctDraft !== (detail.manualPercentComplete ?? 0) ? 'pointer' : 'not-allowed',
                  fontSize: 13, fontWeight: 600,
                }}
              >
                {saving ? <Loader2 size={14} className="spin" /> : savedAt && Date.now() - savedAt < 3000 ? <Check size={14} /> : <Save size={14} />}
                {saving ? 'Saving...' : savedAt && Date.now() - savedAt < 3000 ? 'Saved' : 'Save'}
              </button>
            </div>
            {detail.progressSetAt && (
              <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
                Currently saved: <b>{detail.manualPercentComplete}%</b> - set by {detail.progressSetBy || 'unknown'} on {new Date(detail.progressSetAt).toLocaleDateString()}. This same value shows on your PM Portfolio, the Mon/Thu report, and the job costing dashboard.
              </div>
            )}
          </div>

          {/* Overall totals row */}
          <div style={{ background: '#faf8f5', border: '1px solid #eee5d8', borderRadius: 8, padding: 16, marginBottom: 20 }}>
            <div style={{ color: '#68050a', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Overall Cost Position</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <Kpi label="Total Budget" value={money(detail.totals.budgetedCost)} />
              <Kpi label="Total Actual" value={money(detail.totals.actualCost)} />
              <Kpi
                label="Variance"
                value={money(detail.totals.variance)}
                valueColor={detail.totals.variance > 0 ? '#c0392b' : detail.totals.variance < 0 ? '#0d7a3a' : '#666'}
              />
              <Kpi
                label="% of Budget Spent"
                value={pct(detail.totals.pctOfBudget)}
                valueColor={detail.totals.pctOfBudget > 100 ? '#c0392b' : detail.totals.pctOfBudget > 90 ? '#d4a017' : '#0d7a3a'}
              />
            </div>
            <p style={{ margin: '10px 4px 0', fontSize: 12, color: '#666', fontStyle: 'italic' }}>
              This view shows cost discipline only. To see how this job is performing against schedule and against your other jobs, use the main PM Portfolio.
            </p>
          </div>

          {/* Per-division table */}
          <h3 style={{ fontSize: 15, color: '#68050a', borderBottom: '2px solid #e8c860', paddingBottom: 6, margin: '0 0 12px' }}>Budget vs Actual by Division</h3>

          {detail.divisions.length === 0 && (
            <div style={{ background: '#ffffff', border: '1px solid #eee5d8', borderRadius: 8, padding: 20, color: '#666', textAlign: 'center' }}>
              No budgeted cost items found for this job. If this looks wrong, check that an approved customer order exists in JobTread.
            </div>
          )}

          {detail.divisions.length > 0 && (
            <table width="100%" cellPadding={0} cellSpacing={0} style={{ fontSize: 13, background: '#ffffff', border: '1px solid #eee5d8', borderRadius: 8, overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: '#68050a', color: '#e8c860' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Division</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>Budget</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>Actual</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>Variance</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>% Spent</th>
                </tr>
              </thead>
              <tbody>
                {detail.divisions.map((d, i) => (
                  <tr key={d.name} style={{ background: i % 2 === 0 ? '#ffffff' : '#faf8f5', borderTop: '1px solid #eee5d8' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{d.name}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{money(d.budgetedCost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{money(d.actualCost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: varianceColor(d.variance, d.budgetedCost), fontWeight: 600 }}>
                      {d.variance > 0 ? <TrendingUp size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> :
                       d.variance < 0 ? <TrendingDown size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} /> :
                       <Minus size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />}
                      {money(d.variance)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: d.pctOfBudget > 100 ? '#c0392b' : d.pctOfBudget > 90 ? '#d4a017' : d.pctOfBudget < 50 ? '#0d7a3a' : '#666' }}>
                      {pct(d.pctOfBudget)}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr style={{ background: '#f0e9e0', fontWeight: 700, borderTop: '2px solid #68050a' }}>
                  <td style={{ padding: '10px 12px' }}>TOTAL</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{money(detail.totals.budgetedCost)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{money(detail.totals.actualCost)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: varianceColor(detail.totals.variance, detail.totals.budgetedCost) }}>
                    {money(detail.totals.variance)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: detail.totals.pctOfBudget > 100 ? '#c0392b' : detail.totals.pctOfBudget > 90 ? '#d4a017' : '#0d7a3a' }}>
                    {pct(detail.totals.pctOfBudget)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          <p style={{ marginTop: 24, fontSize: 12, color: '#8a8078' }}>
            Data as of {new Date(detail.generatedAt).toLocaleString()}. Click Refresh to pull the latest from JobTread.
          </p>
        </>
      )}

      <style jsx>{`
        .spin { animation: spin 0.8s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Kpi({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ background: '#ffffff', borderRadius: 6, padding: '10px 12px', border: '1px solid #eee5d8' }}>
      <div style={{ color: '#8a8078', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ color: valueColor || '#1a1a1a', fontSize: 17, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
