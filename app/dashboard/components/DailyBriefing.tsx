'use client';

// ============================================================
// Daily Briefing — Nathan's Overview view.
// Reads the pre-computed payload from /api/dashboard/briefing (built at 3 AM by
// the cron). No analysis happens here; this is a fast read of stored data.
// ============================================================

import { useEffect, useState, useCallback } from 'react';

const MAROON = '#68050a';
const GOLD = '#e8c860';
const CREAM = '#f8f6f3';
const RED = '#b00020';
const AMBER = '#b8860b';
const GREEN = '#1a7f37';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}
function fmtPct(n: any) {
  if (n == null || isNaN(n)) return 'n/a';
  return `${Number(n).toFixed(1)}%`;
}
function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}
function shortFrom(from: string) {
  const m = (from || '').match(/^(.*?)</);
  return (m ? m[1].trim().replace(/"/g, '') : from) || from;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.06)', marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 18px', borderBottom: `2px solid ${GOLD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: MAROON, fontWeight: 700 }}>{title}</span>
        {count != null && <span style={{ fontSize: 12, color: '#8a8078', fontWeight: 600 }}>{count}</span>}
      </div>
      <div style={{ padding: '6px 18px 14px' }}>{children}</div>
    </div>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '9px 0', borderBottom: '1px solid #f0ece6', fontSize: 14, color: '#1a1a1a', lineHeight: 1.45 }}>{children}</div>;
}
function Empty({ text }: { text: string }) {
  return <div style={{ padding: '9px 0', color: '#8a8078', fontSize: 14 }}>{text}</div>;
}
function healthColor(h: string) {
  return h === 'over-budget' ? RED : h === 'watch' ? AMBER : GREEN;
}

export default function DailyBriefing({ firstName }: { firstName?: string }) {
  const [payload, setPayload] = useState<any>(null);
  const [meta, setMeta] = useState<{ generatedAt?: string; briefingDate?: string }>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/dashboard/briefing', { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load');
      setPayload(data.payload);
      setMeta({ generatedAt: data.generatedAt, briefingDate: data.briefingDate });
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      await fetch('/api/cron/daily-briefing?seed=true&noEmail=true', { headers: authHeaders() });
      await load();
    } catch { /* ignore */ } finally { setRunning(false); }
  };

  const dismissEmail = async (item: any) => {
    setDismissed((s) => new Set(s).add(item.threadId));
    try {
      await fetch('/api/dashboard/briefing/dismiss', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ threadId: item.threadId, subject: item.subject, messageDate: item.date }),
      });
    } catch { /* optimistic; will re-resolve next refresh */ }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#8a8078' }}>Loading your briefing…</div>;
  }

  if (!payload) {
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: MAROON }}>No briefing yet</div>
          <p style={{ color: '#6b6258', fontSize: 14 }}>
            The first briefing builds automatically at 3 AM. You can generate one now to preview it.
          </p>
          <button onClick={runNow} disabled={running} style={btnPrimary}>{running ? 'Generating…' : 'Generate now'}</button>
          {err && <div style={{ color: RED, marginTop: 12, fontSize: 13 }}>{err}</div>}
        </div>
      </div>
    );
  }

  const p = payload;
  const emailItems = (p.email?.items || []).filter((m: any) => !dismissed.has(m.threadId));
  const isCadenceSpecial = p.cadence === 'monday' || p.cadence === 'friday';

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '8px 16px 48px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', margin: '8px 0 18px', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, color: MAROON, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Daily Briefing{p.cadence === 'monday' ? ' • Week Planner' : p.cadence === 'friday' ? ' • Week in Review' : ''}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a' }}>
            Good morning{firstName ? `, ${firstName}` : ''}
          </div>
          <div style={{ fontSize: 13, color: '#8a8078' }}>{p.weekdayLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setShowSettings(true)} style={btnGhost}>Daily-log settings</button>
          <button onClick={runNow} disabled={running} style={btnGhost}>{running ? 'Refreshing…' : 'Refresh now'}</button>
        </div>
      </div>

      {/* Priorities */}
      <div style={{ background: MAROON, borderRadius: 12, padding: '16px 20px', marginBottom: 18, color: '#fff' }}>
        <div style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: GOLD, fontWeight: 700, marginBottom: 8 }}>Today’s Priorities</div>
        {(p.priorities || []).map((x: string, i: number) => (
          <div key={i} style={{ fontSize: 15, padding: '4px 0', display: 'flex', gap: 8 }}>
            <span style={{ color: GOLD }}>•</span><span>{x}</span>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <Section title="Calendar (Today)" count={(p.calendar?.events || []).length}>
        {(p.calendar?.events || []).length ? p.calendar.events.map((e: any) => (
          <Row key={e.id}>
            <b>{e.allDay ? 'All day' : fmtTime(e.start)}</b> &nbsp; {e.summary}
            {e.location ? <span style={{ color: '#8a8078' }}> ({e.location})</span> : null}
          </Row>
        )) : <Empty text="No events today." />}
      </Section>

      {/* Email needing reply */}
      <Section title="Email Needing Reply" count={emailItems.length}>
        {emailItems.length ? emailItems.map((m: any) => (
          <div key={m.id} style={{ padding: '9px 0', borderBottom: '1px solid #f0ece6', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 14, lineHeight: 1.4, minWidth: 0 }}>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {m.category && (
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#fff', background: m.category === 'client' ? GREEN : MAROON, borderRadius: 4, padding: '1px 6px' }}>{m.category}</span>
                )}
                <span>{shortFrom(m.from)}</span>
                {m.isUnread && <span style={{ color: MAROON, fontSize: 11 }}>• unread</span>}
              </div>
              <div>{m.subject} <span style={{ color: '#8a8078' }}>({m.ageDays}d)</span></div>
              <div style={{ color: '#8a8078', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.reason ? `${m.reason}: ${m.snippet}` : m.snippet}</div>
            </div>
            <button onClick={() => dismissEmail(m)} title="I replied to this elsewhere" style={btnDismiss}>Mark replied</button>
          </div>
        )) : <Empty text="Inbox clear of items needing a reply." />}
      </Section>

      {/* Project slip alerts */}
      <Section title="Project Slip Alerts">
        {(() => {
          const parts: React.ReactNode[] = [];
          for (const g of p.slip?.dailyLogGaps || []) parts.push(
            <Row key={`g-${g.jobId}`}><span style={{ color: RED, fontWeight: 600 }}>Daily-log gap</span> &nbsp; {g.jobName || g.jobId} {g.lastLogDate ? <span style={{ color: '#8a8078' }}>(last {g.lastLogDate}, {g.daysSinceLastLog}d ago)</span> : <span style={{ color: '#8a8078' }}>(no logs found)</span>}</Row>
          );
          for (const j of p.slip?.budgetBurn || []) parts.push(
            <Row key={`b-${j.jobId}`}><span style={{ color: healthColor(j.health), fontWeight: 600 }}>{j.health === 'over-budget' ? 'Over budget' : 'Watch'}</span> &nbsp; {j.jobName} <span style={{ color: '#8a8078' }}>(margin {fmtPct(j.marginPct)})</span></Row>
          );
          for (const j of (p.slip?.overdueScheduleJobs || []).slice(0, 15)) parts.push(
            <Row key={`s-${j.jobName}`}><span style={{ color: AMBER, fontWeight: 600 }}>{j.count} overdue schedule item{j.count === 1 ? '' : 's'}</span> &nbsp; {j.jobName || 'Unassigned'} <span style={{ color: '#8a8078' }}>(worst {j.maxDaysOverdue}d)</span></Row>
          );
          return parts.length ? parts : <Empty text="No projects slipping." />;
        })()}
      </Section>

      {/* JobTread messages */}
      <Section title="JobTread Messages" count={p.messages?.mentionCount || 0}>
        {(p.messages?.flagged || []).length ? p.messages.flagged.map((c: any) => (
          <Row key={c.id}><b>{c.jobName}</b> &nbsp; <span style={{ color: '#8a8078' }}>{c.author}</span>: {(c.message || '').slice(0, 220)}</Row>
        )) : <Empty text="No JobTread messages mention you." />}
      </Section>

      {/* My tasks */}
      <Section title="Your Tasks (next 7 days)" count={p.myTasks?.count || 0}>
        {(p.myTasks?.overdue || []).map((t: any) => (
          <Row key={t.id}><span style={{ color: RED, fontWeight: 600 }}>Overdue {Math.abs(t.daysUntilDue)}d</span> &nbsp; {t.name}{t.jobName ? <span style={{ color: '#8a8078' }}> ({t.jobName})</span> : null}</Row>
        ))}
        {(p.myTasks?.upcoming || []).map((t: any) => (
          <Row key={t.id}>Due {t.daysUntilDue}d &nbsp; {t.name}{t.jobName ? <span style={{ color: '#8a8078' }}> ({t.jobName})</span> : null}</Row>
        ))}
        {!(p.myTasks?.count) && <Empty text="No tasks due in the next 7 days." />}
      </Section>

      {/* Leads */}
      <Section title="New Leads" count={p.leads?.counts?.newUncontacted || 0}>
        {(p.leads?.newUncontacted || []).length ? p.leads.newUncontacted.map((l: any, i: number) => (
          <Row key={i}>{l.contactName || 'Lead'}{l.opportunityName ? <span style={{ color: '#8a8078' }}> ({l.opportunityName})</span> : null}</Row>
        )) : <Empty text="No new uncontacted leads." />}
      </Section>

      {/* Outstanding team tasks */}
      <Section title="Outstanding Team Tasks" count={p.teamTasks?.overdueCount || 0}>
        {(p.teamTasks?.overdueCount || 0) > 0 ? (
          <>
            <div style={{ fontSize: 13, color: '#6b6258', padding: '4px 0 8px' }}>{p.teamTasks.overdueCount} overdue of {p.teamTasks.totalOpen} open company-wide.</div>
            {(p.teamTasks.overdue || []).slice(0, isCadenceSpecial ? 40 : 12).map((t: any) => (
              <Row key={t.id}>
                <span style={{ color: RED }}>{t.daysOverdue}d</span> &nbsp; {t.name}{t.jobName ? <span style={{ color: '#8a8078' }}> ({t.jobName})</span> : null}
                <span style={{ display: 'inline-block', marginLeft: 6, fontSize: 12, fontWeight: 600, color: t.assignees && t.assignees.length ? MAROON : '#b3aaa0' }}>{t.assigneeLabel || 'Unassigned'}</span>
              </Row>
            ))}
          </>
        ) : <Empty text="No overdue team tasks." />}
      </Section>

      {/* Cadence special — Mon/Fri full job costing */}
      {isCadenceSpecial && (p.jobCosting?.all || []).length > 0 && (
        <Section title={`${p.cadence === 'monday' ? 'Week Planner' : 'Week in Review'}: Job Costing (all active jobs)`} count={p.jobCosting.jobCount}>
          {p.jobCosting.all.map((j: any) => {
            const pct = j.manualPercentComplete ?? j.costBasedPercent;
            return (
              <Row key={j.jobId}>
                <span style={{ color: healthColor(j.health), fontWeight: 700 }}>{fmtPct(j.marginPct)}</span> margin &nbsp; {j.jobName}
                {pct != null ? <span style={{ color: '#8a8078' }}> ({Math.round(pct)}% complete)</span> : null}
              </Row>
            );
          })}
        </Section>
      )}

      <div style={{ textAlign: 'center', color: '#b3aaa0', fontSize: 12, marginTop: 8 }}>
        Auto-refreshes weekdays at 3 AM. Last generated {meta.generatedAt ? new Date(meta.generatedAt).toLocaleString() : 'not yet'}.
      </div>

      {showSettings && <MonitoredJobsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// ---- Daily-log monitoring settings ----------------------------------------
function MonitoredJobsModal({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dashboard/briefing/monitored-jobs', { headers: authHeaders() });
        const data = await res.json();
        setJobs(data.jobs || []);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  const save = async (job: any, patch: any) => {
    const next = { ...job, ...patch };
    setJobs((arr) => arr.map((j) => (j.jobId === job.jobId ? next : j)));
    setSaving(job.jobId);
    try {
      await fetch('/api/dashboard/briefing/monitored-jobs', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          jobId: next.jobId, jobName: next.jobName, jobNumber: next.jobNumber,
          expectLogs: next.expectLogs, frequencyPerWeek: next.frequencyPerWeek,
        }),
      });
    } catch { /* ignore */ } finally { setSaving(null); }
  };

  const filtered = jobs.filter((j) => !q || (j.jobName || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 'min(640px,100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ background: MAROON, color: '#fff', padding: '14px 18px' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Daily-log monitoring</div>
          <div style={{ fontSize: 12, color: GOLD }}>Pick which active jobs must submit daily logs and how often. The briefing flags gaps on these jobs.</div>
        </div>
        <div style={{ padding: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jobs…" style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
        </div>
        <div style={{ overflowY: 'auto', padding: '0 12px 12px' }}>
          {loading ? <div style={{ padding: 20, color: '#8a8078' }}>Loading jobs…</div> : filtered.map((j) => (
            <div key={j.jobId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 4px', borderBottom: '1px solid #f0ece6' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', minWidth: 0 }}>
                <input type="checkbox" checked={!!j.expectLogs} onChange={(e) => save(j, { expectLogs: e.target.checked })} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.jobName}</span>
              </label>
              <select value={j.frequencyPerWeek} disabled={!j.expectLogs} onChange={(e) => save(j, { frequencyPerWeek: Number(e.target.value) })} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, opacity: j.expectLogs ? 1 : 0.5 }}>
                <option value={1}>1x / week</option>
                <option value={2}>2x / week</option>
                <option value={3}>3x / week</option>
                <option value={5}>Every weekday</option>
              </select>
            </div>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: '1px solid #eee', textAlign: 'right' }}>
          <button onClick={onClose} style={btnPrimary}>Done</button>
        </div>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = { background: MAROON, color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { background: '#fff', color: MAROON, border: `1px solid ${MAROON}`, padding: '7px 12px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const btnDismiss: React.CSSProperties = { background: CREAM, color: '#6b6258', border: '1px solid #e0d8ce', padding: '6px 10px', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', alignSelf: 'flex-start' };
