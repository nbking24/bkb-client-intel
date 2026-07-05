// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, ExternalLink, Save, Check, AlertTriangle, Clock } from 'lucide-react';

function getAuthToken() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
  return `Bearer ${token}`;
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined) return '-';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`;
}

function fmtPct(n: number | null | undefined, dec = 0) {
  if (n === null || n === undefined) return '-';
  return `${n.toFixed(dec)}%`;
}

type Job = {
  id: string;
  number: string;
  name: string;
  clientName: string;
  priceType: string;
  contractPrice: number;
  budgetedCost: number;
  actualCost: number;
  costPctBudget: number;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  daysInProd: number | null;
  daysToTarget: number | null;
  targetDuration: number | null;
  manualPercentComplete: number | null;
  progressSetBy: string | null;
  progressSetAt: string | null;
  progressNotes: string | null;
  jobCostingUrl: string;
};

export default function PmPortfolioPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pm, setPm] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    setError(null);
    try {
      const qs = typeof window !== 'undefined' ? window.location.search : '';
      const res = await fetch(`/api/dashboard/pm-portfolio${qs}`, {
        headers: { Authorization: getAuthToken() },
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setPm(data.pm);
      setJobs(data.jobs);
      const initialDrafts: Record<string, number> = {};
      for (const j of data.jobs) {
        initialDrafts[j.id] = j.manualPercentComplete ?? 0;
      }
      setDrafts(initialDrafts);
    } catch (e: any) {
      setError(e.message || 'Failed to load portfolio');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function saveProgress(jobId: string) {
    setSaving((s) => ({ ...s, [jobId]: true }));
    try {
      const res = await fetch('/api/dashboard/pm-portfolio', {
        method: 'PUT',
        headers: {
          Authorization: getAuthToken(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId, percentComplete: drafts[jobId] }),
      });
      if (!res.ok) throw new Error('save failed');
      setSavedAt((s) => ({ ...s, [jobId]: Date.now() }));
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? { ...j, manualPercentComplete: drafts[jobId], progressSetAt: new Date().toISOString() }
            : j
        )
      );
    } catch (e) {
      setError('Failed to save. Try again.');
    } finally {
      setSaving((s) => ({ ...s, [jobId]: false }));
    }
  }

  function targetBadge(days: number | null) {
    if (days === null) return { text: 'no schedule', color: '#999', bg: '#f3f0eb' };
    if (days < 0) return { text: `${Math.abs(days)} days over`, color: '#ffffff', bg: '#c0392b' };
    if (days < 14) return { text: `${days} days to target`, color: '#8a6d00', bg: '#fff8e6' };
    return { text: `${days} days to target`, color: '#065f2b', bg: '#e6f6ec' };
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif', color: '#1a1a1a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ color: '#68050a', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>My PM Portfolio</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 24, color: '#68050a', fontWeight: 700 }}>{pm || '...'}</h1>
          <div style={{ color: '#666', fontSize: 13, marginTop: 2 }}>{jobs.length} in-production jobs</div>
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

      <div style={{ background: '#faf8f5', border: '1px solid #eee5d8', borderRadius: 8, padding: 14, marginBottom: 20, fontSize: 13, color: '#666' }}>
        <b style={{ color: '#68050a' }}>How this works:</b> Set each job's overall % complete based on where you actually are on the project. Save each row. Your saved values feed the Mon and Thu report and the job costing dashboard. Rebalance whenever the field reality changes.
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#666' }}>
          <Loader2 size={16} className="spin" /> Loading your jobs...
        </div>
      )}

      {error && (
        <div style={{ background: '#fdecea', color: '#c0392b', padding: 12, borderRadius: 6, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {!loading && jobs.length === 0 && !error && (
        <div style={{ background: '#fff', border: '1px solid #eee5d8', borderRadius: 8, padding: 20, textAlign: 'center', color: '#666' }}>
          No in-production jobs found for {pm}. If this is wrong, check the JobTread Project Manager custom field on your jobs.
        </div>
      )}

      {jobs.map((j) => {
        const badge = targetBadge(j.daysToTarget);
        const isSaved = savedAt[j.id] && Date.now() - savedAt[j.id] < 3000;
        const setAt = j.progressSetAt ? new Date(j.progressSetAt) : null;
        const daysSinceUpdate = setAt ? Math.floor((Date.now() - setAt.getTime()) / 86400000) : null;
        const stale = daysSinceUpdate !== null && daysSinceUpdate > 7;
        const dirty = drafts[j.id] !== (j.manualPercentComplete ?? 0);
        const cost_color =
          j.costPctBudget > 100 ? '#c0392b'
            : j.costPctBudget > 90 ? '#d4a017'
              : '#0d7a3a';

        return (
          <div key={j.id} style={{ background: '#ffffff', border: '1px solid #eee5d8', borderRadius: 8, padding: 16, marginBottom: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#68050a' }}>{j.name}</div>
                <div style={{ fontSize: 12, color: '#666' }}>#{j.number} · {j.clientName} · {j.priceType === 'fixed' ? 'Fixed Price' : 'Cost Plus'}</div>
              </div>
              <div style={{ background: badge.bg, color: badge.color, padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
                {badge.text}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12, fontSize: 12 }}>
              <Kpi label="Contract" value={money(j.contractPrice)} />
              <Kpi label="Budget Cost" value={money(j.budgetedCost)} />
              <Kpi label="Actual Cost" value={money(j.actualCost)} valueColor={cost_color} />
              <Kpi label="% of Budget" value={fmtPct(j.costPctBudget, 0)} valueColor={cost_color} />
              <Kpi label="Days in production" value={j.daysInProd !== null ? `${j.daysInProd}` : '-'} />
              <Kpi label="Target duration" value={j.targetDuration !== null ? `${j.targetDuration} days` : '-'} />
            </div>

            <div style={{ borderTop: '1px dashed #eee5d8', paddingTop: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 6 }}>
                Overall % Complete
                {stale && (
                  <span style={{ marginLeft: 8, color: '#c0392b', fontWeight: 500, fontSize: 11 }}>
                    <Clock size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                    last updated {daysSinceUpdate}d ago - please refresh
                  </span>
                )}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={drafts[j.id] ?? 0}
                  onChange={(e) => setDrafts((s) => ({ ...s, [j.id]: Number(e.target.value) }))}
                  style={{ flex: '1 1 300px', accentColor: '#68050a' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={drafts[j.id] ?? 0}
                    onChange={(e) => setDrafts((s) => ({ ...s, [j.id]: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                    style={{ width: 60, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}
                  />
                  <span style={{ fontSize: 13, color: '#666' }}>%</span>
                </div>
                <button
                  onClick={() => saveProgress(j.id)}
                  disabled={saving[j.id] || !dirty}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: dirty ? '#68050a' : '#ccc',
                    color: '#ffffff', border: 'none',
                    padding: '8px 14px', borderRadius: 4, cursor: dirty ? 'pointer' : 'not-allowed',
                    fontSize: 13, fontWeight: 600
                  }}
                >
                  {saving[j.id] ? <Loader2 size={14} className="spin" /> : isSaved ? <Check size={14} /> : <Save size={14} />}
                  {saving[j.id] ? 'Saving...' : isSaved ? 'Saved' : 'Save'}
                </button>
              </div>
              {j.progressSetAt && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>
                  Currently saved: <b>{j.manualPercentComplete}%</b> - set by {j.progressSetBy || 'unknown'} on {setAt?.toLocaleDateString()}
                </div>
              )}
            </div>

            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px dashed #eee5d8' }}>
              <a href={j.jobCostingUrl} style={{ color: '#0d5a7a', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ExternalLink size={12} /> View cost breakdown by division
              </a>
            </div>
          </div>
        );
      })}

      <style jsx>{`
        .spin {
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function Kpi({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ background: '#faf8f5', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ color: '#8a8078', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ color: valueColor || '#1a1a1a', fontSize: 15, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
