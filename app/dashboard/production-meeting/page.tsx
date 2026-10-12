// @ts-nocheck
'use client';

/**
 * Production Meeting (Monday). Design agreed with Nathan 2026-10-12, see the
 * JobTread Assistant project doc claude/BKB-Production-Meeting-Design-2026-10-12.md
 *
 *   Production Brief  flags from JobTread and the money caches; "Bring to meeting" or "Handled"
 *   Meeting           1 Opening, 2 Last week's commitments, 3 Next 2 weeks, 4 Production jobs,
 *                     5 Subs and materials (6 weeks), 6 Punch list jobs, 7 Close
 *   Review            everything queued for JobTread; Confirm writes it
 *   History           past meetings with plus and delta
 *   Money             dollar detail per job, owners only (the API strips it for everyone else)
 *
 * Everything typed is autosaved to the open meeting (Supabase). Nothing is
 * written to JobTread until Confirm.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

const C = {
  maroon: '#68050a', gold: '#c88c00', bg: '#faf8f5', card: '#ffffff', ink: '#1f1a17', muted: '#7a716b', line: '#e8e2da',
  soft: '#f3efe9', red: '#b42318', redSoft: '#fdeceb', amber: '#a54a06', amberSoft: '#fdf0dc', green: '#2c7a3a', greenSoft: '#e3f2e6',
  house: '#55598f', houseSoft: '#ebecf6', blue: '#1d5c87', blueSoft: '#e2edf6',
};
const REASONS = ['Waiting on the client', 'Waiting on a sub or supplier', 'Waiting on an inspection', 'Weather', 'Too much on one person', 'Not a real task', 'Other'];
const STEPS = ['Opening', "Last week's commitments", 'Next 2 weeks', 'Production jobs', 'Subs and materials', 'Punch list jobs', 'Close'];
const MAKE_READY = ['Selections decided', 'Material ordered and arriving', 'Sub confirmed, pre-install booked', 'Details in hand', 'Inspections scheduled', 'Prior trade finishing on time', 'Client informed', 'Access and protection ready'];
const CLOSEOUT = ['Walkthrough with the client booked', 'Punch list written (one task per item)', 'Punch list complete, client confirmed', 'Final costs in (every bill entered)', 'Final invoice sent', 'Final invoice paid', 'Ready to close the job'];
const QLABELS = { q1: 'Are we on schedule for the next milestone?', q2: 'What is in the way?', q3: 'Is everything for the next 6 weeks ready?', q4: 'Who owes what, by when?' };
const TRACK = { on: 'On schedule', risk: 'At risk', off: 'Behind' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pd(s) { if (!s) return null; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(s, n) { const d = pd(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
function daysBetween(a, b) { return Math.round((pd(b) - pd(a)) / 86400000); }
function fd(s, dow = false) {
  const d = pd(s); if (!d) return '';
  const y = new Date().getFullYear();
  return (dow ? DOW[d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + (d.getUTCFullYear() !== y ? ' ' + d.getUTCFullYear() : '');
}
function token() { try { return `Bearer ${localStorage.getItem('bkb-token') || ''}`; } catch { return ''; } }
const JT = (id) => `https://app.jobtread.com/jobs/${id}`;
const money = (n) => (n == null ? '-' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString());
const pctf = (n) => (n == null ? '-' : `${n}%`);
/** Margin points lost or gained against the bid, in words. Null when unknown. */
const slip = (p) => (p == null ? null : Math.abs(p) < 0.05 ? 'on bid' : `${p > 0 ? 'down' : 'up'} ${Math.abs(p)} pts against the bid`);
/** Mirrors productionNotesText() in app/lib/production-meeting/constants.ts */
function notesText(js) {
  if (!js) return '';
  const q = js.q || {}, parts = [];
  for (const k of ['q1', 'q2', 'q3', 'q4']) {
    const a = q[k] || {};
    const t = k === 'q1' && a.track ? TRACK[a.track] : '';
    const n = String(a.note || '').trim();
    let r = '';
    if (k === 'q3' && js.ready && Object.keys(js.ready).length) {
      const yes = MAKE_READY.filter((_, i) => js.ready[i] === 'yes'), no = MAKE_READY.filter((_, i) => js.ready[i] === 'no');
      r = [yes.length ? `Ready: ${yes.join(', ')}` : '', no.length ? `Not ready: ${no.join(', ')}` : ''].filter(Boolean).join('. ');
    }
    if (t || n || r) parts.push(`${QLABELS[k]}\n${[t, r, n].filter(Boolean).join('. ')}`);
  }
  if (js.closeout != null && js.closeout !== '') parts.push(`Next closeout step\n${CLOSEOUT[Number(js.closeout)] || js.closeout}`);
  const other = String(js.notes || '').trim(); if (other) parts.push(`Other notes and decisions\n${other}`);
  return parts.join('\n\n');
}
let uidN = 0;
const uid = () => `${Date.now().toString(36)}${(uidN++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isWorkday = (s) => { const d = pd(s).getUTCDay(); return d !== 0 && d !== 6; };

/* ------------------------------------------------------------------ styles */
const CSS = `
.pm{color:${C.ink};font-size:14.5px;line-height:1.45}
.pm *{box-sizing:border-box}
.pm h2{font-size:20px;margin:18px 0 6px;font-weight:700}
.pm h3{font-size:15px;margin:0 0 8px;font-weight:700}
.pm h4{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:${C.muted};margin:16px 0 6px;font-weight:700}
.pm .lead{color:${C.muted};margin:0 0 12px;max-width:780px}
.pm .card{background:${C.card};border:1px solid ${C.line};border-radius:10px}
.pm .pad{padding:14px 16px}
.pm .tabs{display:flex;gap:4px;border-bottom:1px solid ${C.line};overflow-x:auto;margin-top:6px}
.pm .tabs button{background:none;border:0;border-bottom:3px solid transparent;padding:8px 12px;cursor:pointer;color:${C.muted};font-weight:600;white-space:nowrap}
.pm .tabs button.on{color:${C.ink};border-bottom-color:${C.maroon}}
.pm .btn{border:1px solid ${C.line};background:#fff;border-radius:8px;padding:7px 13px;cursor:pointer;font-weight:600;color:${C.ink}}
.pm .btn.pri{background:${C.maroon};border-color:${C.maroon};color:#fff}
.pm .btn.sm{padding:4px 10px;font-size:13px}
.pm .btn:disabled{opacity:.45;cursor:default}
.pm input[type=text],.pm input[type=date],.pm select,.pm textarea{border:1px solid ${C.line};background:#fff;border-radius:8px;padding:6px 9px;font:inherit;color:inherit;max-width:100%}
.pm textarea{width:100%;min-height:72px;resize:vertical}
.pm .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.pm .grow{flex:1 1 200px}
.pm .chip{border:1px solid ${C.line};background:#fff;border-radius:999px;padding:3px 11px;font-size:13px;cursor:pointer}
.pm .chip.on{background:${C.maroon};border-color:${C.maroon};color:#fff}
.pm .tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border-radius:4px;padding:2px 6px;display:inline-block}
.pm .t-red{background:${C.redSoft};color:${C.red}}.pm .t-amber{background:${C.amberSoft};color:${C.amber}}.pm .t-house{background:${C.houseSoft};color:${C.house}}.pm .t-green{background:${C.greenSoft};color:${C.green}}.pm .t-blue{background:${C.blueSoft};color:${C.blue}}
.pm .flag{display:grid;grid-template-columns:5px 1fr;border:1px solid ${C.line};border-radius:10px;background:#fff;margin-bottom:8px;overflow:hidden}
.pm .flag .bar{background:${C.muted}}
.pm .flag.red .bar{background:${C.red}}.pm .flag.amber .bar{background:${C.amber}}.pm .flag.house .bar{background:${C.house}}
.pm .flag.done{opacity:.55}
.pm .flag .body{padding:10px 14px}
.pm .meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:13px;color:${C.muted};margin-bottom:3px}
.pm .seg{display:inline-flex;border:1px solid ${C.line};border-radius:8px;overflow:hidden;flex:0 0 auto}
.pm .seg button{border:0;background:#fff;padding:4px 10px;font-size:13px;cursor:pointer;color:${C.muted}}
.pm .seg button+button{border-left:1px solid ${C.line}}
.pm .seg button.on{background:${C.blueSoft};color:${C.blue};font-weight:700}
.pm .small{font-size:13px;color:${C.muted}}
.pm .empty{color:${C.muted};font-style:italic;font-size:14px}
.pm .note{border-left:3px solid ${C.gold};background:#fbf5e6;padding:8px 12px;border-radius:0 8px 8px 0;font-size:14px;margin:10px 0}
.pm .tlist{list-style:none;margin:0;padding:0}
.pm .tlist li{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px dashed ${C.line}}
.pm .tlist li:last-child{border-bottom:0}
.pm .dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:0 0 8px;background:${C.muted}}
.pm .d-red{background:${C.red}}.pm .d-amber{background:${C.amber}}.pm .d-green{background:${C.green}}.pm .d-house{background:${C.house}}.pm .d-blue{background:${C.blue}}
.pm .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}
.pm .stat .n{font-size:24px;font-weight:700}
.pm .job{margin-bottom:10px}
.pm .job .head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 12px;padding:12px 16px;cursor:pointer;align-items:center}
.pm .job .bd{border-top:1px solid ${C.line};padding:4px 16px 16px}
.pm .added{background:${C.blueSoft};border-radius:8px;padding:6px 10px;margin:4px 0;display:flex;gap:8px;align-items:flex-start}
.pm .added .x{margin-left:auto;cursor:pointer;border:0;background:none;color:${C.muted};font-size:18px;line-height:1}
.pm .steps{display:flex;gap:6px;overflow-x:auto;padding:10px 0 4px}
.pm .steps button{flex:0 0 auto;border:1px solid ${C.line};background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;font-weight:700;color:${C.ink}}
.pm .steps button.on{border-color:${C.maroon};background:#f7ecec;color:${C.maroon}}
.pm .nav{display:flex;justify-content:space-between;gap:8px;margin-top:16px}
.pm table{width:100%;border-collapse:collapse;font-size:14px}
.pm th{text-align:left;font-size:12px;color:${C.muted};font-weight:600;padding:8px;border-bottom:1px solid ${C.line};white-space:nowrap}
.pm td{padding:8px;border-bottom:1px solid ${C.line};vertical-align:top}
.pm td.num,.pm th.num{text-align:right;white-space:nowrap}
.pm table.money{font-size:13px}
.pm table.money th,.pm table.money td{padding:6px 5px}
.pm .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
.pm .facts>div{background:${C.soft};border-radius:8px;padding:7px 10px;display:flex;flex-direction:column;gap:2px;font-size:13.5px}
.pm .qbox{border:1px solid ${C.line};border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#fff}
.pm .qhead{font-weight:700;margin-bottom:4px}
.pm .ms{display:grid;grid-template-columns:1fr 150px 70px 90px;gap:4px 10px;align-items:center;font-size:13.5px;padding:4px 0;border-bottom:1px dashed ${C.line}}
.pm .ms:last-child{border-bottom:0}
.pm .pbar{height:8px;border-radius:4px;background:${C.soft};overflow:hidden}
.pm .pbar i{display:block;height:100%;background:${C.green}}
.pm .ready{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center;font-size:13.5px}
.pm .day{display:grid;grid-template-columns:110px 1fr;gap:8px;padding:6px 0;border-bottom:1px dashed ${C.line};font-size:13.5px}
.pm .day:last-child{border-bottom:0}
.pm .msg{margin-top:10px;padding:10px 12px;border-radius:8px;font-size:14px}
.pm .ok{background:${C.greenSoft};color:${C.green}}.pm .err{background:${C.redSoft};color:${C.red}}
@media (max-width:760px){.pm .facts{grid-template-columns:1fr 1fr}.pm .grid4{grid-template-columns:1fr 1fr}.pm .ms{grid-template-columns:1fr 1fr}.pm .day{grid-template-columns:1fr}}
`;

/* ------------------------------------------------------------------ small parts */
function NewItem({ members, onAdd, kind, label }) {
  const [what, setWhat] = useState('');
  const [whoId, setWhoId] = useState('');
  const [due, setDue] = useState('');
  const [details, setDetails] = useState('');
  const addIt = () => {
    if (!what.trim()) return;
    const whoName = members.find((m) => m.id === whoId)?.name || '';
    onAdd({ uid: uid(), kind, what: what.trim(), whoId: whoId || null, whoName, due: due || null, details: details.trim() });
    setWhat(''); setWhoId(''); setDue(''); setDetails('');
  };
  return (
    <div style={{ marginTop: 6 }}>
      <div className="row">
        <input type="text" className="grow" placeholder={label} value={what} onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIt(); } }} />
        <select value={whoId} onChange={(e) => setWhoId(e.target.value)}><option value="">Who</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn sm" onClick={addIt}>Add {kind}</button>
      </div>
      {what.trim() ? <textarea style={{ minHeight: 46, marginTop: 6 }} placeholder="Description (optional): the detail someone needs to do it without asking. Saved as the task description." value={details} onChange={(e) => setDetails(e.target.value)} /> : null}
    </div>
  );
}

/** Text box with its own state; saves while typing (debounced) and on leaving the box. */
function NoteBox({ value, onSave, placeholder, minHeight = 60 }) {
  const [v, setV] = useState(value || '');
  const last = useRef(value || '');
  useEffect(() => {
    if (v === last.current) return;
    const t = setTimeout(() => { last.current = v; onSave(v); }, 800);
    return () => clearTimeout(t);
  }, [v]);
  return <textarea style={{ minHeight }} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== last.current) { last.current = v; onSave(v); } }} />;
}

function Milestones({ j, today }) {
  if (!j.milestones?.length) return <p className="empty">No 🤖 PRODUCTION MILESTONES on this job yet.</p>;
  return (
    <div className="card pad" style={{ padding: '8px 12px' }}>
      {j.milestones.map((m) => {
        const late = !m.done && m.end && m.end < today;
        const cur = !m.done && m.start <= today;
        return (
          <div key={m.id} className="ms">
            <div><span className={`dot ${m.done ? 'd-green' : late ? 'd-red' : cur ? 'd-blue' : ''}`} style={{ display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} />{m.name}{cur && !late ? <span className="tag t-blue" style={{ marginLeft: 6 }}>now</span> : null}{late ? <span className="tag t-red" style={{ marginLeft: 6 }}>late</span> : null}</div>
            <div className="small">{fd(m.start)} to {fd(m.end)}</div>
            <div className="pbar" title={`${m.progress}% done`}><i style={{ width: `${m.progress}%` }} /></div>
            <div className="small" style={{ color: m.slip >= 5 ? C.red : m.slip <= -1 ? C.green : C.muted }}>{m.slip == null ? 'no baseline' : m.slip === 0 ? 'on baseline' : m.slip > 0 ? `+${m.slip} days` : `${m.slip} days`}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================== page */
export default function ProductionMeetingPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [S, setS] = useState({ flags: {}, jobs: {}, triage: {}, rb: {}, opening: '' });
  const [plus, setPlus] = useState('');
  const [delta, setDelta] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [saveState, setSaveState] = useState('');
  const [view, setView] = useState('brief');
  const [step, setStep] = useState(1);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('all');
  const [confirming, setConfirming] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState(null);
  const dirty = useRef(false);
  const loaded = useRef(false);

  async function load(refresh = false) {
    refresh ? setRefreshing(true) : setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/dashboard/production-meeting${refresh ? '?refresh=1' : ''}`, { headers: { Authorization: token() }, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      setData(json);
      if (!loaded.current || !refresh) {
        const st = json.meeting.state || {};
        setS({ flags: st.flags || {}, jobs: st.jobs || {}, triage: st.triage || {}, rb: st.rb || {}, opening: st.opening || '' });
        setPlus(json.meeting.plus || '');
        setDelta(json.meeting.delta || '');
        setMeetingDate(json.meeting.meeting_date);
      }
      loaded.current = true;
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }
  useEffect(() => { load(false); }, []);

  // autosave
  useEffect(() => {
    if (!loaded.current || !data || !dirty.current) return;
    setSaveState('Saving...');
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/dashboard/production-meeting', {
          method: 'PUT', headers: { Authorization: token(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetingId: data.meeting.id, state: S, plus, delta, meetingDate }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Save failed');
        dirty.current = false;
        setSaveState('Saved');
      } catch (e) { setSaveState('Not saved: ' + (e.message || e)); }
    }, 700);
    return () => clearTimeout(t);
  }, [S, plus, delta, meetingDate]);

  const touch = (fn) => { dirty.current = true; setS((prev) => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next; }); };
  const blank = () => ({ notes: '', items: [], q: {}, ready: {} });
  const jsOf = (st, jid) => (st.jobs[jid] = st.jobs[jid] || blank());
  const JS = (jid) => S.jobs[jid] || blank();

  const meeting = data?.meeting;
  const brief = meeting?.brief || { jobs: [], members: [] };
  const jobs = brief.jobs || [];
  const members = brief.members || [];
  const last = data?.lastMeeting;
  const isOwner = !!data?.user?.isOwner;
  const today = brief.asOf || iso(new Date());
  const md = meetingDate || today;
  const prodJobs = jobs.filter((j) => j.kind === 'production');
  const punchAll = jobs.filter((j) => j.kind === 'punch');
  const handled = (fid) => !!S.flags?.[fid]?.handled;
  const liveFlags = (j) => (j.flags || []).filter((f) => !handled(f.id));
  // ongoing service jobs only come to the meeting when something non-housekeeping is flagged
  const punchJobs = punchAll.filter((j) => !j.ongoing || liveFlags(j).some((f) => f.sev !== 'house'));
  const inMeeting = (j) => j.kind === 'production' || punchJobs.includes(j);
  const allFlags = useMemo(() => jobs.flatMap((j) => (j.flags || []).map((f) => ({ ...f, jid: j.id, ongoing: j.ongoing }))), [jobs]);
  const msById = (j) => Object.fromEntries((j.milestones || []).map((m) => [m.id, m]));

  /* ------------------------------------------------ queued changes (mirrors writeback.ts) */
  const changes = useMemo(() => {
    const out = {};
    const add = (jid, kind, text) => (out[jid] = out[jid] || []).push({ kind, text });
    for (const j of jobs) for (const it of S.jobs[j.id]?.items || []) add(j.id, it.kind === 'roadblock' ? 'Roadblock' : 'Commitment', `New task in 🔵 ACTIVE: ${it.what} · ${it.whoName || 'no owner'} · ${it.due ? 'due ' + fd(it.due) : 'no date'}${it.details ? ' · description: ' + it.details : ''}`);
    for (const [fid, r] of Object.entries(S.rb || {})) if (r?.act === 'rb' && r.what?.trim()) add(fid.split('|')[1], 'Roadblock', `New task in 🔵 ACTIVE: ${r.what} · ${r.whoName || 'no owner'} · ${r.due ? 'due ' + fd(r.due) : 'no date'}${r.details ? ' · description: ' + r.details : ''}`);
    for (const [, t] of Object.entries(S.triage || {})) {
      if (!t?.act) continue;
      if (t.act === 'done') add(t.jobId, 'Update', `Tick complete: ${t.name}`);
      const why = t.why === 'Other' && t.whyText?.trim() ? t.whyText.trim() : t.why;
      if (t.act === 'date' && t.date) add(t.jobId, 'Update', `Move due date to ${fd(t.date)}: ${t.name}${why ? ' · reason: ' + why : ''}`);
      if (t.act === 'drop') add(t.jobId, 'Update', `Drop: tick complete and add "Dropped at the ${fd(md)} production meeting${why ? ': ' + why : ''}" to its description. Not deleted: ${t.name}`);
    }
    for (const j of jobs) {
      const nt = notesText(S.jobs[j.id]);
      if (out[j.id] || nt) add(j.id, 'Daily log', `One internal daily log dated ${fd(md)}, "Production meeting ${fd(md, true)}", with the answers and notes${nt ? ` (${nt.split(/\s+/).length} words)` : ''} and the changes above`);
    }
    return out;
  }, [S, jobs, md]);
  const changeCount = Object.values(changes).reduce((n, a) => n + a.length, 0);

  if (loading) return <div className="pm" style={{ padding: 24 }}><style>{CSS}</style><p className="empty">Reading JobTread for the Production Brief. The first load of the week takes up to a minute.</p></div>;
  if (err && !data) return <div className="pm" style={{ padding: 24 }}><style>{CSS}</style><div className="msg err">{err}</div><button className="btn" onClick={() => load(false)}>Try again</button></div>;

  /* ------------------------------------------------ shared task triage row */
  function taskRow(t, jobId) {
    const tr = S.triage[t.id] || {};
    const opts = [['done', 'Done'], ['date', 'New date'], ['drop', 'Drop']];
    return (
      <li key={t.id} style={{ flexWrap: 'wrap' }}>
        <span className={`dot ${t.overdue ? 'd-amber' : t.doneLike ? 'd-house' : 'd-green'}`} />
        <div className="grow">{t.name}{t.fromLast ? <span className="tag t-blue" style={{ marginLeft: 6 }}>from last meeting</span> : null}{t.roadblock ? <span className="tag t-red" style={{ marginLeft: 6 }}>roadblock</span> : null}{t.group ? <span className="small"> ({t.group})</span> : null}
          <div className="small">{(t.who || []).join(', ') || 'no owner'} · {t.due ? 'due ' + fd(t.due) : 'no date'}{t.overdue ? <b style={{ color: C.amber }}> · late</b> : null}{t.type ? ' · type ' + t.type : ''}</div></div>
        <div className="seg">{opts.map(([k, l]) => <button key={k} className={tr.act === k ? 'on' : ''} onClick={() => touch((s) => { s.triage[t.id] = s.triage[t.id]?.act === k ? {} : { ...(s.triage[t.id] || {}), act: k, jobId, name: t.name }; })}>{l}</button>)}</div>
        {(tr.act === 'date' || tr.act === 'drop') && <div className="row" style={{ flex: '1 1 100%', margin: '6px 0 0 16px' }}>
          {tr.act === 'date' && <input type="date" value={tr.date || ''} onChange={(e) => touch((s) => { s.triage[t.id].date = e.target.value; })} />}
          <select value={tr.why || ''} onChange={(e) => touch((s) => { s.triage[t.id].why = e.target.value; })}><option value="">{tr.act === 'drop' ? 'Why drop it?' : 'Why did it slip?'}</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
          {tr.why === 'Other' && <input type="text" className="grow" placeholder="Say why, in a few words" defaultValue={tr.whyText || ''} onBlur={(e) => touch((s) => { s.triage[t.id].whyText = e.target.value; })} />}
        </div>}
      </li>
    );
  }

  function flagActions(f) {
    const r = S.rb[f.id] || {};
    return (
      <div key={f.id} className={`flag ${f.sev}`}><div className="bar" /><div className="body">
        <div className="meta"><span className={`tag t-${f.sev}`}>{f.kind}</span><span>Owner: {f.owner || '?'}</span></div>
        <div>{f.text}</div>
        <div className="row" style={{ marginTop: 8 }}><div className="seg">
          <button className={r.act === 'rb' ? 'on' : ''} onClick={() => touch((s) => { s.rb[f.id] = s.rb[f.id]?.act === 'rb' ? {} : { ...(s.rb[f.id] || {}), act: 'rb' }; })}>Make it a roadblock</button>
          <button className={r.act === 'clear' ? 'on' : ''} onClick={() => touch((s) => { s.rb[f.id] = s.rb[f.id]?.act === 'clear' ? {} : { act: 'clear' }; })}>No action needed</button>
        </div></div>
        {r.act === 'rb' && <>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="text" className="grow" placeholder="Roadblock: what is in the way" defaultValue={r.what || ''} onBlur={(e) => touch((s) => { s.rb[f.id].what = e.target.value; })} />
            <select value={r.whoId || ''} onChange={(e) => touch((s) => { s.rb[f.id].whoId = e.target.value; s.rb[f.id].whoName = members.find((m) => m.id === e.target.value)?.name || ''; })}><option value="">Who</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <input type="date" value={r.due || ''} onChange={(e) => touch((s) => { s.rb[f.id].due = e.target.value; })} />
          </div>
          <textarea style={{ minHeight: 52, marginTop: 6 }} placeholder="Description: what needs to happen to clear it, who to call" defaultValue={r.details || ''} onBlur={(e) => touch((s) => { s.rb[f.id].details = e.target.value; })} />
        </>}
      </div></div>
    );
  }

  const itemRow = (j) => ([it, i]) => <div key={it.uid} className="added"><span><span className={`tag ${it.kind === 'roadblock' ? 't-red' : 't-blue'}`} style={{ marginRight: 6 }}>{it.kind}</span>{it.what} · <b>{it.whoName || 'no owner'}</b> · {it.due ? fd(it.due, true) : 'no date'}{it.details ? <><br /><span className="small" style={{ whiteSpace: 'pre-wrap' }}>{it.details}</span></> : null}</span><button className="x" aria-label="Remove" onClick={() => touch((s) => { jsOf(s, j.id).items.splice(i, 1); })}>×</button></div>;

  /* ================================================================ BRIEF */
  function Brief() {
    const shownFlags = allFlags.filter((f) => !f.ongoing || f.sev !== 'house').filter((f) => filter === 'all' || f.sev === filter || (filter === 'open' && !handled(f.id)));
    const sev = (s) => allFlags.filter((f) => f.sev === s && (!f.ongoing || f.sev !== 'house')).length;
    const noMs = prodJobs.filter((j) => !j.milestones?.length);
    return (
      <div>
        <h2>Production Brief</h2>
        <p className="lead">Read from JobTread {brief.builtAt ? 'at ' + new Date(brief.builtAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}. Money flags come from the Job Costing and Invoicing pages (refreshed nightly) and never show dollar amounts. Every flag starts as <b>Bring to meeting</b>. Anything fixed before the meeting, mark <b>Handled</b>.</p>
        <div className="row"><button className="btn sm" disabled={refreshing} onClick={() => load(true)}>{refreshing ? 'Reading JobTread...' : 'Refresh from JobTread'}</button>{brief.errors?.length ? <span className="small" style={{ color: C.red }}>Could not read: {brief.errors.join('; ')}</span> : null}</div>
        <div className="grid4">
          <div className="card pad stat"><div className="n" style={{ color: C.red }}>{sev('red')}</div><div className="small">Red: late, behind, cost over</div></div>
          <div className="card pad stat"><div className="n" style={{ color: C.amber }}>{sev('amber')}</div><div className="small">Amber: billing, decisions, logs, tasks</div></div>
          <div className="card pad stat"><div className="n" style={{ color: C.house }}>{sev('house')}</div><div className="small">Housekeeping</div></div>
          <div className="card pad stat"><div className="n">{allFlags.filter((f) => handled(f.id)).length}</div><div className="small">Handled so far</div></div>
        </div>
        {brief.moneyAsOf?.costingStale || brief.moneyAsOf?.invoicingStale ? <div className="note"><b>Money flags partly off:</b> {[brief.moneyAsOf.costingStale && 'the Job Costing numbers have not refreshed in over 3 days, so Cost running over is switched off', brief.moneyAsOf.invoicingStale && 'the Invoicing report has not refreshed in over 3 days, so billing flags are switched off'].filter(Boolean).join('; ')}. Refresh those pages, then Refresh from JobTread here.</div> : null}
        {noMs.length ? <div className="note"><b>No production milestones on {noMs.length} of {prodJobs.length} jobs in production:</b> {noMs.map((j) => j.short).join(', ')}. Until they have milestones, question 1 and the look ahead are answered from the field tasks and the room. Ask Claude to build them with the production schedule skill, or move a nearly finished job to 6.5.</div> : null}
        <div className="row" style={{ margin: '10px 0' }}>{[['all', 'All'], ['red', 'Red'], ['amber', 'Amber'], ['house', 'Housekeeping'], ['open', 'Not handled yet']].map(([k, l]) => <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        {shownFlags.length ? shownFlags.map((f) => (
          <div key={f.id} className={`flag ${f.sev} ${handled(f.id) ? 'done' : ''}`}><div className="bar" /><div className="body">
            <div className="meta"><span className={`tag t-${f.sev}`}>{f.kind}</span><b style={{ color: C.ink }}>{f.job}</b><span>Owner: {f.owner || '?'}</span><a href={JT(f.jid)} target="_blank" rel="noreferrer">Open in JobTread</a></div>
            <div>{f.text}</div>
            <div className="row" style={{ marginTop: 8 }}><div className="seg">
              <button className={!handled(f.id) ? 'on' : ''} onClick={() => touch((s) => { s.flags[f.id] = { handled: false }; })}>Bring to meeting</button>
              <button className={handled(f.id) ? 'on' : ''} onClick={() => touch((s) => { s.flags[f.id] = { handled: true }; })}>Handled</button>
            </div></div>
          </div></div>
        )) : <p className="empty">Nothing in this filter.</p>}
        <h2>Every job at a glance</h2>
        <p className="lead">Jobs in production first, red flags first. Finish is the last production milestone; the number after it is days later (+) or earlier (-) than its baseline.</p>
        <div className="card" style={{ overflowX: 'auto' }}><table><thead><tr><th>Job</th><th>Status</th><th>PM</th><th>Now</th><th>Finish</th><th>Last daily log</th><th>Roadblocks</th><th>Flags</th></tr></thead><tbody>
          {jobs.map((j) => { const ms = msById(j); const now = (j.currentMs || []).map((id) => ms[id]?.name).filter(Boolean); const red = liveFlags(j).filter((f) => f.sev === 'red').length, amb = liveFlags(j).filter((f) => f.sev === 'amber').length; const bd = j.finish && j.baselineFinish ? daysBetween(j.baselineFinish, j.finish) : null; return (
            <tr key={j.id} style={{ opacity: inMeeting(j) ? 1 : 0.55 }}><td><a href={JT(j.id)} target="_blank" rel="noreferrer">{j.short}</a>{j.ongoing ? <span className="tag t-house" style={{ marginLeft: 6 }}>ongoing</span> : null}</td><td className="small">{j.kind === 'production' ? '6 Production' : '6.5 Punch'}</td><td className="small">{j.pm || ''}</td><td className="small">{now.length ? now.join(', ') : j.nextMs ? `next: ${ms[j.nextMs]?.name} ${fd(ms[j.nextMs]?.start)}` : ''}</td><td className="small">{j.finish ? fd(j.finish) : ''}{bd ? <b style={{ color: bd > 0 ? C.red : C.green }}> {bd > 0 ? '+' : ''}{bd}</b> : null}</td><td className="small">{j.lastLog ? fd(j.lastLog) : 'none'}</td><td>{j.roadblocks?.length || ''}</td><td>{red ? <span className="tag t-red">{red}</span> : null} {amb ? <span className="tag t-amber">{amb}</span> : null}</td></tr>); })}
        </tbody></table></div>
        <p className="small">Faded rows are ongoing service jobs with nothing flagged; they skip the meeting. Admin Project and Evan Project are left out.</p>
        <div className="nav"><span /><button className="btn pri" onClick={() => { setView('meet'); setStep(1); window.scrollTo(0, 0); }}>Start the meeting</button></div>
      </div>
    );
  }

  /* ================================================================ PRODUCTION JOB CARD */
  function ProdCard({ j, pos, list }) {
    const js = JS(j.id);
    const isOpen = open === j.id;
    const live = liveFlags(j).filter((f) => f.kind !== 'Overdue task' && f.kind !== 'Aging ask');
    const rf = live.filter((f) => f.sev !== 'house'), hk = live.filter((f) => f.sev === 'house');
    const red = liveFlags(j).filter((f) => f.sev === 'red').length, amb = liveFlags(j).filter((f) => f.sev === 'amber').length;
    const ms = msById(j);
    const now = (j.currentMs || []).map((id) => ms[id]).filter(Boolean);
    const nxt = j.nextMs ? ms[j.nextMs] : null;
    const q = js.q || {};
    const setQ = (key, field, val) => touch((s) => { const x = jsOf(s, j.id); x.q = x.q || {}; x.q[key] = { ...(x.q[key] || {}), [field]: val }; });
    const lm = last?.jobs?.[j.id];
    const end6 = addDays(md, 42), wk6 = addDays(md, 35);
    const ahead = (j.milestones || []).filter((m) => !m.done && m.start <= end6 && m.end >= md);
    const week6 = ahead.filter((m) => m.start > wk6);
    const decDue = (j.decisions?.undecided || []).filter((x) => !x.decideBy || x.decideBy <= end6);
    const bd = j.finish && j.baselineFinish ? daysBetween(j.baselineFinish, j.finish) : null;
    const commitments = (js.items || []).map((it, i) => [it, i]).filter(([it]) => it.kind !== 'roadblock');
    const roadblocksNew = (js.items || []).map((it, i) => [it, i]).filter(([it]) => it.kind === 'roadblock');
    return (
      <div className="card job">
        <div className="head" onClick={() => setOpen(isOpen ? null : j.id)}>
          <div>
            <div style={{ fontWeight: 700 }}>{j.short} <span className="small" style={{ fontWeight: 400 }}>{j.name}{j.pm ? ` · PM ${j.pm}` : ''}</span></div>
            <div className="small">{now.length ? `Now: ${now.map((m) => m.name).join(', ')}` : nxt ? `Next: ${nxt.name} ${fd(nxt.start)}` : j.milestones?.length ? 'All milestones done' : 'No production milestones'}{j.finish ? ` · finish ${fd(j.finish)}` : ''}{bd ? ` (${bd > 0 ? '+' : ''}${bd} vs baseline)` : ''}</div>
          </div>
          <div className="row">{red ? <span className="tag t-red">{red} red</span> : null}{amb ? <span className="tag t-amber">{amb} amber</span> : null}{j.roadblocks?.length ? <span className="tag t-red">{j.roadblocks.length} roadblock{j.roadblocks.length > 1 ? 's' : ''}</span> : null}{!red && !amb && !j.roadblocks?.length ? <span className="tag t-green">no flags</span> : null}<span className="small">{isOpen ? 'Close' : 'Open'}</span></div>
        </div>
        {isOpen && (
          <div className="bd">
            <h4>1. Where it stands</h4>
            <div className="facts">
              <div><span className="small">Milestones done</span><b>{j.msProgress != null ? `${j.msProgress}%` : 'no milestones'}</b></div>
              <div><span className="small">Finish (baseline)</span><b>{j.finish ? fd(j.finish, true) : 'not set'}{j.baselineFinish ? ` (${fd(j.baselineFinish)})` : ''}</b></div>
              <div><span className="small">Last daily log</span><b>{j.lastLog ? fd(j.lastLog) : 'none'}</b></div>
              <div><span className="small">Last activity</span><b>{j.lastActivity ? `${fd(j.lastActivity.date)} (${j.lastActivity.what})` : 'none'}</b></div>
            </div>
            <Milestones j={j} today={today} />
            {isOwner && j.money ? <div className="small" style={{ marginTop: 6 }}>Nathan only: projected margin {pctf(j.money.marginPct)}{slip(j.money.slippagePoints) ? `, ${slip(j.money.slippagePoints)}` : ''} · invoiced {money(j.money.invoiced)} of {money(j.money.contract)}{j.money.pctSource ? ` · ${j.money.pctComplete}% complete (${j.money.pctSource})` : ''}{brief.moneyAsOf?.costingStale ? <b style={{ color: C.amber }}> · cost numbers as of {brief.moneyAsOf?.costing ? fd(String(brief.moneyAsOf.costing).slice(0, 10)) : 'an old date'}</b> : null}</div> : null}
            <div className="small" style={{ marginTop: 6 }}><a href={JT(j.id)} target="_blank" rel="noreferrer">Open in JobTread</a></div>

            <h4>2. Since last meeting</h4>
            {last ? (lm?.notes ? <div className="note" style={{ whiteSpace: 'pre-wrap' }}><b>Notes from {fd(last.meeting_date)}:</b>{'\n'}{lm.notes}</div> : <p className="empty" style={{ margin: '0 0 6px' }}>No notes for this job at the {fd(last.meeting_date)} meeting.</p>) : <p className="empty" style={{ margin: '0 0 6px' }}>First production meeting, so nothing from last week yet.</p>}
            {j.tasks.length ? <ul className="tlist">{j.tasks.map((t) => taskRow(t, j.id))}</ul> : <p className="empty">No open tasks in 🔵 ACTIVE.</p>}

            <h4>3. Roadblocks and flags</h4>
            {j.roadblocks?.length ? <ul className="tlist" style={{ marginBottom: 8 }}>{j.roadblocks.map((r) => <li key={r.id}><span className="dot d-red" /><span><b>{r.name}</b> · {r.who.join(', ') || 'no owner'} · open {r.daysOpen} days{r.due ? ' · due ' + fd(r.due) : ''}</span></li>)}</ul> : <p className="empty" style={{ margin: '0 0 6px' }}>No open roadblocks.</p>}
            {rf.map((f) => flagActions(f))}
            {!rf.length && <p className="empty">No red or amber flags on this job.</p>}
            {hk.length > 0 && <><div className="small" style={{ marginTop: 6 }}><b>Housekeeping ({hk.length}):</b></div><ul className="tlist">{hk.map((f) => <li key={f.id}><span className="dot d-house" /><span className="small">{f.text} <b>{f.owner}</b></span></li>)}</ul></>}

            <h4>4. The four questions</h4>
            <div className="qbox"><div className="qhead">1. Are we on schedule for the next milestone?</div>
              <div className="small" style={{ marginBottom: 6 }}>{now.length ? `In progress: ${now.map((m) => `${m.name} (${m.progress}%, due ${fd(m.end)})`).join('; ')}. ` : ''}{nxt ? `Next: ${nxt.name}, starts ${fd(nxt.start)}.` : now.length ? '' : 'No milestone dates on this job. Answer from the field.'}</div>
              <div className="seg" style={{ marginBottom: 6 }}>{[['on', 'On schedule'], ['risk', 'At risk'], ['off', 'Behind']].map(([k, l]) => <button key={k} className={q.q1?.track === k ? 'on' : ''} onClick={() => setQ('q1', 'track', q.q1?.track === k ? '' : k)}>{l}</button>)}</div>
              <NoteBox value={q.q1?.note} placeholder="Why, and does the client know?" minHeight={46} onSave={(v) => setQ('q1', 'note', v)} />
            </div>
            <div className="qbox"><div className="qhead">2. What is in the way?</div>
              <div className="small" style={{ marginBottom: 6 }}>Each blocker becomes a red Roadblock task in 🔵 ACTIVE and stays on this card until it is cleared.</div>
              {roadblocksNew.map(itemRow(j))}
              <NewItem members={members} kind="roadblock" label="Roadblock: what is in the way" onAdd={(it) => touch((s) => { jsOf(s, j.id).items.push(it); })} />
            </div>
            <div className="qbox"><div className="qhead">3. Is everything for the next 6 weeks ready?</div>
              {ahead.length ? <ul className="tlist" style={{ marginBottom: 6 }}>{ahead.map((m) => <li key={m.id}><span className={`dot ${week6.includes(m) ? 'd-amber' : 'd-house'}`} /><span className="small"><b>{fd(m.start, true)}</b> · {m.name}{week6.includes(m) ? <b> · entering week 6: make-ready check</b> : ''}</span></li>)}</ul> : <div className="small" style={{ marginBottom: 6 }}>No production milestones in the next 6 weeks{j.milestones?.length ? '' : ' (none on this job)'}.</div>}
              {decDue.length || j.decisions?.toOrder?.length || j.decisions?.onOrder?.length ? <div className="small" style={{ marginBottom: 6 }}>
                {decDue.length ? <div><b>Not decided:</b> {decDue.slice(0, 6).map((x) => `${x.name}${x.tag ? ' (' + x.tag + ')' : ''}${x.decideBy ? ' by ' + fd(x.decideBy) : ''}`).join('; ')}{decDue.length > 6 ? `; and ${decDue.length - 6} more` : ''}</div> : null}
                {j.decisions?.toOrder?.length ? <div><b>Decided, not ordered (Status 4):</b> {j.decisions.toOrder.slice(0, 6).map((x) => x.name).join('; ')}{j.decisions.toOrder.length > 6 ? `; and ${j.decisions.toOrder.length - 6} more` : ''}</div> : null}
                {j.decisions?.onOrder?.length ? <div><b>Ordered, not delivered (Status 5 and 6):</b> {j.decisions.onOrder.slice(0, 6).map((x) => x.name).join('; ')}{j.decisions.onOrder.length > 6 ? `; and ${j.decisions.onOrder.length - 6} more` : ''}</div> : null}
              </div> : null}
              <div className="small" style={{ margin: '6px 0 4px' }}><b>Make-ready check</b> for the work entering week 6{week6.length ? ` (${week6.map((m) => m.name).join(', ')})` : ''}. Every "No" should become a roadblock above.</div>
              <div className="ready">{MAKE_READY.map((r, i) => [
                <div key={'l' + i}>{r}</div>,
                <div key={'s' + i} className="seg">{[['yes', 'Yes'], ['no', 'No']].map(([k, l]) => <button key={k} className={js.ready?.[i] === k ? 'on' : ''} onClick={() => touch((s) => { const x = jsOf(s, j.id); x.ready = x.ready || {}; if (x.ready[i] === k) delete x.ready[i]; else x.ready[i] = k; })}>{l}</button>)}</div>,
              ])}</div>
              <div style={{ marginTop: 6 }}><NoteBox value={q.q3?.note} placeholder="Deliveries, subs, inspections, anything missing from the list above" minHeight={46} onSave={(v) => setQ('q3', 'note', v)} /></div>
            </div>
            <div className="qbox"><div className="qhead">4. Who owes what, by when?</div>
              <div className="small" style={{ marginBottom: 6 }}>Each commitment becomes its own task in 🔵 ACTIVE after Confirm, assigned to that person.</div>
              {commitments.map(itemRow(j))}
              <NewItem members={members} kind="commitment" label="Commitment: what will be done" onAdd={(it) => touch((s) => { jsOf(s, j.id).items.push(it); })} />
            </div>

            <h4>5. Other notes and decisions</h4>
            <NoteBox value={js.notes} placeholder={`Anything else decided about ${j.short}, including anything the client needs to hear. All answers and these notes go into one internal daily log on the job.`} onSave={(v) => touch((s) => { jsOf(s, j.id).notes = v; })} />
            <div className="nav"><span />{pos < list.length - 1 ? <button className="btn" onClick={() => setOpen(list[pos + 1].id)}>Next job: {list[pos + 1].short}</button> : <button className="btn" onClick={() => { setStep(5); setOpen(null); window.scrollTo(0, 0); }}>Done with production jobs</button>}</div>
          </div>
        )}
      </div>
    );
  }

  /* ================================================================ PUNCH JOB CARD */
  function PunchCard({ j }) {
    const js = JS(j.id);
    const isOpen = open === j.id;
    const live = liveFlags(j).filter((f) => f.kind !== 'Overdue task' && f.kind !== 'Aging ask' && f.sev !== 'house');
    const items = [...j.punchItems, ...j.tasks.filter((t) => !j.punchItems.some((p) => p.id === t.id))];
    const commitments = (js.items || []).map((it, i) => [it, i]);
    return (
      <div className="card job">
        <div className="head" onClick={() => setOpen(isOpen ? null : j.id)}>
          <div>
            <div style={{ fontWeight: 700 }}>{j.short} <span className="small" style={{ fontWeight: 400 }}>{j.name}{j.ongoing ? ' · ongoing service job' : ''}</span></div>
            <div className="small">{items.length} open item{items.length === 1 ? '' : 's'} · last activity {j.lastActivity ? `${fd(j.lastActivity.date)} (${j.lastActivity.what})` : 'none'}{js.closeout != null && js.closeout !== '' ? ` · next step: ${CLOSEOUT[js.closeout]}` : ''}</div>
          </div>
          <div className="row">{live.map((f) => <span key={f.id} className={`tag t-${f.sev}`}>{f.kind}</span>)}<span className="small">{isOpen ? 'Close' : 'Open'}</span></div>
        </div>
        {isOpen && (
          <div className="bd">
            <h4>Open items</h4>
            {items.length ? <ul className="tlist">{items.map((t) => taskRow(t, j.id))}</ul> : <p className="empty">No open items in JobTread.</p>}
            {live.length ? <><h4>Flags</h4>{live.map((f) => flagActions(f))}</> : null}
            {isOwner && j.money ? <div className="small">Nathan only: invoiced {money(j.money.invoiced)} of {money(j.money.contract)}{j.money.invoicedPct != null ? ` (${j.money.invoicedPct}%)` : ''} · collected {money(j.money.collected)} · projected margin {pctf(j.money.marginPct)}</div> : null}
            <h4>Next closeout step</h4>
            <select value={js.closeout ?? ''} onChange={(e) => touch((s) => { const x = jsOf(s, j.id); if (e.target.value === '') delete x.closeout; else x.closeout = Number(e.target.value); })}><option value="">Pick the next step</option>{CLOSEOUT.map((c, i) => <option key={i} value={i}>{c}</option>)}</select>
            <h4>Who owes what, by when?</h4>
            {commitments.map(itemRow(j))}
            <NewItem members={members} kind="commitment" label="Commitment: the next closeout step, or one punch item" onAdd={(it) => touch((s) => { jsOf(s, j.id).items.push(it); })} />
            <h4>Notes</h4>
            <NoteBox value={js.notes} placeholder="Anything else decided. Goes into one internal daily log on the job." minHeight={46} onSave={(v) => touch((s) => { jsOf(s, j.id).notes = v; })} />
            <div className="small" style={{ marginTop: 6 }}><a href={JT(j.id)} target="_blank" rel="noreferrer">Open in JobTread</a></div>
          </div>
        )}
      </div>
    );
  }

  /* ================================================================ MEETING STEPS */
  function Opening() {
    return (
      <div>
        <h2>1. Opening</h2>
        <p className="lead">Two minutes. Wins and shout-outs from last week, then who is out this week and who covers. Saved with the meeting in the Hub, not written to JobTread.</p>
        <NoteBox value={S.opening} placeholder="Wins, who is out, who covers" onSave={(v) => touch((s) => { s.opening = v; })} />
      </div>
    );
  }

  function Commitments() {
    const rows = jobs.flatMap((j) => (j.lastMeeting || []).map((t) => ({ ...t, j })));
    const kept = rows.filter((t) => t.status === 'done').length;
    const open = rows.filter((t) => t.status !== 'done');
    return (
      <div>
        <h2>2. Last week's commitments</h2>
        {last ? <p className="lead">From the {fd(last.meeting_date, true)} meeting: <b>kept {kept} of {rows.length}</b>. Each open one: Done, New date (with the reason), or Drop.</p> : <p className="lead">This is the first production meeting, so there is nothing from last week. From next week this shows every commitment made here and how many were kept.</p>}
        {open.length ? <div className="card pad"><ul className="tlist">{open.map((t) => taskRow({ id: t.id, name: `${t.j.short}: ${t.name}`, due: t.due, who: t.who ? [t.who] : [], overdue: t.status === 'late', roadblock: t.kind === 'roadblock' }, t.j.id))}</ul></div> : last ? <p className="empty">Every commitment from last week is done.</p> : null}
        {rows.filter((t) => t.status === 'done').length ? <div className="small" style={{ marginTop: 8 }}>{rows.filter((t) => t.status === 'done').map((t) => <div key={t.id}>✓ {t.j.short}: {t.name} ({t.who || 'no owner'})</div>)}</div> : null}
      </div>
    );
  }

  function NextTwoWeeks() {
    const end = addDays(md, 13);
    const days = [];
    for (let d = md; d <= end; d = addDays(d, 1)) if (isWorkday(d)) days.push(d);
    const lines = (d) => {
      const out = [];
      for (const j of prodJobs) {
        for (const m of j.milestones || []) if (!m.done && m.start <= d && m.end >= d) out.push({ k: 'ms', t: `${j.short}: ${m.name}`, start: m.start === d });
        for (const f of j.fieldTasks || []) { const s = f.start || f.end, e = f.end || f.start; if (s && s <= d && e >= d) out.push({ k: 'field', t: `${j.short}: ${f.name}${f.who.length ? ' (' + f.who.join(', ') + ')' : ''}`, start: s === d }); }
      }
      return out;
    };
    const lateField = prodJobs.flatMap((j) => (j.fieldTasks || []).filter((f) => f.overdue).map((f) => ({ j, f })));
    const undated = prodJobs.flatMap((j) => (j.fieldTasks || []).filter((f) => !f.start && !f.end).map((f) => ({ j, f })));
    return (
      <div>
        <h2>3. Next 2 weeks</h2>
        <p className="lead">Josh walks who is where each day. Milestones in progress (🤖 PRODUCTION MILESTONES) and 📋 FIELD TASKS by day, {fd(md, true)} to {fd(end, true)}. New work starting that day is in bold. Changes to field tasks go on the board as usual.</p>
        <div className="card pad">{days.map((d) => { const ls = lines(d); return (
          <div key={d} className="day"><b>{fd(d, true)}</b><div>{ls.length ? ls.map((l, i) => <div key={i} style={{ fontWeight: l.start ? 700 : 400 }}><span className={`dot ${l.k === 'ms' ? 'd-blue' : 'd-green'}`} style={{ display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} />{l.t}</div>) : <span className="small">Nothing on the schedule</span>}</div></div>); })}</div>
        {lateField.length ? <><h4>Field tasks past their date ({lateField.length})</h4><ul className="tlist">{lateField.map(({ j, f }) => <li key={f.id}><span className="dot d-amber" /><span className="small">{j.short}: {f.name} · {f.who.join(', ') || 'no owner'} · {fd(f.end || f.start)}</span></li>)}</ul></> : null}
        {undated.length ? <p className="small" style={{ marginTop: 8 }}>{undated.length} open field task{undated.length === 1 ? ' has' : 's have'} no date, so {undated.length === 1 ? 'it is' : 'they are'} not in the days above.</p> : null}
        <p className="small" style={{ marginTop: 8 }}>Blue: production milestone. Green: field task.</p>
      </div>
    );
  }

  function SubsMaterials() {
    const end = addDays(md, 42);
    const wk = (d) => Math.min(6, Math.max(1, Math.floor(daysBetween(md, d) / 7) + 1));
    const starts = prodJobs.flatMap((j) => (j.milestones || []).filter((m) => !m.done && m.start >= md && m.start <= end).map((m) => ({ j, m, w: wk(m.start) }))).sort((a, b) => (a.m.start < b.m.start ? -1 : 1));
    const dec = jobs.filter(inMeeting).flatMap((j) => (j.decisions?.undecided || []).filter((x) => x.decideBy && x.decideBy <= end).map((x) => ({ j, x })));
    const order = jobs.filter(inMeeting).flatMap((j) => (j.decisions?.toOrder || []).map((x) => ({ j, x })));
    const onOrder = jobs.filter(inMeeting).flatMap((j) => (j.decisions?.onOrder || []).map((x) => ({ j, x })));
    return (
      <div>
        <h2>5. Subs and materials, next 6 weeks</h2>
        <p className="lead">{fd(md, true)} to {fd(end, true)}. What starts, so each sub is confirmed and booked for a pre-install meeting 2 to 3 weeks ahead; what still has to be decided or ordered; and what is ordered but not here yet. Anything not ready becomes a roadblock on its job card.</p>
        <h4>Work starting</h4>
        <div className="card pad">{starts.length ? <ul className="tlist">{starts.map(({ j, m, w }) => <li key={m.id}><span className={`dot ${w >= 6 ? 'd-amber' : w <= 3 ? 'd-red' : 'd-house'}`} /><span><b>Week {w}</b> · {fd(m.start, true)} · {j.short}: {m.name}{w <= 3 ? <span className="small"> · pre-install meeting should already be booked</span> : w >= 6 ? <span className="small"> · entering the window: make-ready check</span> : null}</span></li>)}</ul> : <p className="empty">No production milestones start in the next 6 weeks.</p>}</div>
        <h4>Decisions due in the window or past due ({dec.length})</h4>
        <div className="card pad">{dec.length ? <ul className="tlist">{dec.map(({ j, x }) => <li key={x.id}><span className={`dot ${x.decideBy < today ? 'd-red' : 'd-amber'}`} /><span className="small"><b>{fd(x.decideBy)}</b> · {j.short}: {x.name}{x.tag ? ` (${x.tag})` : ''} · {x.status || 'no status'}</span></li>)}</ul> : <p className="empty">Nothing due.</p>}</div>
        <h4>Decided, not ordered yet: Status 4 ({order.length})</h4>
        <div className="card pad">{order.length ? <ul className="tlist">{order.map(({ j, x }) => <li key={x.id}><span className="dot d-amber" /><span className="small">{j.short}: {x.name}{x.tag ? ` (${x.tag})` : ''}</span></li>)}</ul> : <p className="empty">Nothing waiting to be ordered.</p>}</div>
        <h4>Ordered, not delivered: Status 5 and 6 ({onOrder.length})</h4>
        <div className="card pad">{onOrder.length ? <ul className="tlist">{onOrder.map(({ j, x }) => <li key={x.id}><span className="dot d-house" /><span className="small">{j.short}: {x.name} · {x.status}</span></li>)}</ul> : <p className="empty">Nothing on order.</p>}</div>
      </div>
    );
  }

  function Close() {
    const lines = [];
    for (const j of jobs) {
      for (const it of S.jobs[j.id]?.items || []) lines.push([j.short, it]);
      for (const [fid, r] of Object.entries(S.rb || {})) if (r?.act === 'rb' && r.what?.trim() && fid.split('|')[1] === j.id) lines.push([j.short, { kind: 'roadblock', what: r.what, whoName: r.whoName, due: r.due }]);
    }
    const byWho = {};
    for (const [job, it] of lines) (byWho[it.whoName || 'No owner'] = byWho[it.whoName || 'No owner'] || []).push([job, it]);
    return (
      <div>
        <h2>7. Close</h2>
        <p className="lead">Heather reads back every new commitment and roadblock, person by person. Each person says yes or corrects it. Then one plus and one delta.</p>
        <div className="card pad"><h3>Read back</h3>{lines.length ? Object.entries(byWho).map(([who, arr]) => <div key={who} style={{ marginBottom: 8 }}><b>{who}</b><ul className="tlist">{arr.map(([job, it], i) => <li key={i}><span className={`dot ${it.kind === 'roadblock' ? 'd-red' : 'd-green'}`} /><span>{job} · {it.kind === 'roadblock' ? 'Roadblock: ' : ''}{it.what} · {it.due ? fd(it.due, true) : 'no date'}</span></li>)}</ul></div>) : <p className="empty">No new commitments or roadblocks yet.</p>}</div>
        <div className="row" style={{ marginTop: 12, alignItems: 'stretch' }}>
          <div className="card pad grow"><h3>Plus: what worked</h3><textarea defaultValue={plus} onBlur={(e) => { if (e.target.value !== plus) { dirty.current = true; setPlus(e.target.value); } }} /></div>
          <div className="card pad grow"><h3>Delta: change next time</h3><p className="small" style={{ margin: '0 0 6px' }}>Shows at the top of next week's meeting.</p><textarea defaultValue={delta} onBlur={(e) => { if (e.target.value !== delta) { dirty.current = true; setDelta(e.target.value); } }} /></div>
        </div>
      </div>
    );
  }

  function Meet() {
    const list = prodJobs;
    return (
      <div>
        <div className="note" style={{ marginTop: 14 }}><b>Last week we said we would change:</b> {last?.delta ? last.delta : <span className="empty">{last ? 'No delta was written last week.' : 'Nothing yet. This is the first production meeting.'}</span>}</div>
        <div className="steps">{STEPS.map((s, i) => <button key={s} className={step === i + 1 ? 'on' : ''} onClick={() => { setStep(i + 1); window.scrollTo(0, 0); }}>{i + 1}. {s}</button>)}</div>
        {step === 1 && Opening()}
        {step === 2 && Commitments()}
        {step === 3 && NextTwoWeeks()}
        {step === 4 && <div>
          <h2>4. Production jobs</h2>
          <p className="lead">Jobs at 6. In Production, red flags first. A job with no flags gets 30 seconds: "anything new?" Each card runs top to bottom: where it stands, since last meeting, roadblocks and flags, the four questions, notes.</p>
          {list.map((j, pos) => <div key={j.id}>{ProdCard({ j, pos, list })}</div>)}
        </div>}
        {step === 5 && SubsMaterials()}
        {step === 6 && <div>
          <h2>6. Punch list jobs</h2>
          <p className="lead">Jobs at 6.5. Each one leaves with its next closeout step, an owner and a date. Ongoing service jobs only show up here when something is flagged.</p>
          {punchJobs.length ? punchJobs.map((j) => <div key={j.id}>{PunchCard({ j })}</div>) : <p className="empty">No punch list jobs to review.</p>}
          {punchAll.length > punchJobs.length ? <p className="small">Not shown (ongoing, nothing flagged): {punchAll.filter((j) => !punchJobs.includes(j)).map((j) => j.short).join(', ')}.</p> : null}
        </div>}
        {step === 7 && Close()}
        <div className="nav">
          <button className="btn" disabled={step === 1} onClick={() => { setStep(step - 1); window.scrollTo(0, 0); }}>Back</button>
          {step < STEPS.length ? <button className="btn pri" onClick={() => { setStep(step + 1); window.scrollTo(0, 0); }}>Next: {STEPS[step]}</button> : <button className="btn pri" onClick={() => { setView('review'); window.scrollTo(0, 0); }}>Close meeting and review changes</button>}
        </div>
      </div>
    );
  }

  /* ================================================================ REVIEW */
  async function confirm() {
    setConfirming(true); setConfirmMsg(null);
    try {
      await fetch('/api/dashboard/production-meeting', { method: 'PUT', headers: { Authorization: token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId: meeting.id, state: S, plus, delta, meetingDate }) });
      dirty.current = false;
      const res = await fetch('/api/dashboard/production-meeting/confirm', { method: 'POST', headers: { Authorization: token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId: meeting.id }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Confirm failed');
      if (j.ok) {
        setConfirmMsg({ ok: true, text: `Written to JobTread: ${j.written} change${j.written === 1 ? '' : 's'}, ${j.created} new task${j.created === 1 ? '' : 's'}. Next Monday's meeting is open now.` });
        loaded.current = false;
        await load(false);
        setView('review');
      } else {
        setConfirmMsg({ ok: false, text: `${j.written} change${j.written === 1 ? '' : 's'} written, ${j.failed} failed. Press Confirm again to retry only the failed ones. ${j.errors.map((e) => e.key + ': ' + e.error).join(' | ')}` });
      }
    } catch (e) { setConfirmMsg({ ok: false, text: String(e.message || e) }); }
    setConfirming(false);
  }

  function Review() {
    return (
      <div>
        <h2>Review changes</h2>
        <p className="lead">Everything this meeting will write to JobTread, by job. Nothing is written until you confirm. If something fails, press Confirm again; finished writes are never repeated.</p>
        {jobs.filter((j) => changes[j.id]).map((j) => <div key={j.id} className="card pad" style={{ marginBottom: 10 }}><h3>{j.short}</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{changes[j.id].map((x, i) => <li key={i} style={{ margin: '3px 0' }}><span className="tag t-blue" style={{ marginRight: 6 }}>{x.kind}</span>{x.text}</li>)}</ul></div>)}
        {!changeCount && <p className="empty">Nothing queued yet. Add a commitment, decide a task, or type notes on a job card, then come back.</p>}
        {(plus || delta || S.opening) ? <p className="small">Saved with the meeting in the Hub (not JobTread): {[S.opening && 'Opening', plus && 'Plus', delta && 'Delta'].filter(Boolean).join(', ')}.</p> : null}
        <div className="row" style={{ marginTop: 8 }}><button className="btn pri" disabled={!changeCount || confirming} onClick={confirm}>{confirming ? 'Writing to JobTread...' : `Confirm and write ${changeCount} change${changeCount === 1 ? '' : 's'} to JobTread`}</button></div>
        {confirmMsg && <div className={`msg ${confirmMsg.ok ? 'ok' : 'err'}`}>{confirmMsg.text}</div>}
      </div>
    );
  }

  function History() {
    const h = data?.history || [];
    return (
      <div>
        <h2>Meeting history</h2>
        {h.length ? <div className="card" style={{ overflowX: 'auto' }}><table><thead><tr><th>Meeting</th><th>Tasks created</th><th>Plus</th><th>Delta</th></tr></thead><tbody>{h.map((m) => <tr key={m.id}><td>{fd(m.meeting_date, true)}</td><td>{m.tasks}</td><td>{m.plus || ''}</td><td>{m.delta || ''}</td></tr>)}</tbody></table></div> : <p className="empty">No confirmed production meetings yet.</p>}
      </div>
    );
  }

  /* ================================================================ MONEY (owners only) */
  function Money() {
    const rows = jobs.filter((j) => j.money);
    const at = brief.moneyAsOf || {};
    const healthTag = (h) => (h === 'over-budget' ? <span className="tag t-red">over budget</span> : h === 'watch' ? <span className="tag t-amber">watch</span> : h === 'on-track' ? <span className="tag t-green">on track</span> : null);
    const billTag = (h) => (h === 'critical' || h === 'overdue' ? <span className="tag t-red">{h}</span> : h === 'warning' ? <span className="tag t-amber">warning</span> : h === 'healthy' ? <span className="tag t-green">ok</span> : null);
    return (
      <div>
        <h2>Money (only you see this)</h2>
        <p className="lead">The same numbers as the Job Costing page{at.costing ? ` (computed ${new Date(at.costing).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})` : ''} and the Invoicing page{at.invoicing ? ` (${new Date(at.invoicing).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})` : ''}. Review before the meeting. The room only sees the plain flags: Cost running over, Billing behind, Change order not invoiced, Under-billed, Final invoice. Slippage needs the PM's % complete on the PM Portfolio page; without it the projection just repeats the budget.</p>
        {at.costingStale ? <div className="msg err">The Job Costing numbers are more than 3 days old{at.costing ? ` (last computed ${new Date(at.costing).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : ''}. The nightly refresh is not landing. Press Refresh on the Job Costing page before relying on cost, margin or slippage here.</div> : null}
        <div className="card" style={{ overflowX: 'auto' }}><table className="money"><thead><tr><th>Job</th><th>Type</th><th className="num">Contract</th><th className="num">Cost to date</th><th className="num">Invoiced</th><th className="num">Collected</th><th className="num">% complete</th><th className="num">Proj. margin</th><th className="num">Slippage</th><th className="num">Over / under billed</th><th className="num">Unbilled CO</th><th>Cost</th><th>Billing</th></tr></thead><tbody>
          {rows.map((j) => { const m = j.money; return (
            <tr key={j.id}><td><a href={`/dashboard/job-costing?job=${j.id}`}>{j.short}</a><div className="small">{j.kind === 'production' ? '6' : '6.5'}</div></td><td className="small">{m.priceType}</td><td className="num">{money(m.contract)}</td><td className="num">{money(m.costToDate)}</td><td className="num">{money(m.invoiced)}{m.invoicedPct != null ? <div className="small">{m.invoicedPct}%</div> : null}</td><td className="num">{money(m.collected)}</td><td className="num">{m.pctComplete != null ? `${m.pctComplete}%` : '-'}{m.pctSource ? <div className="small">{m.pctSource}</div> : null}</td><td className="num">{pctf(m.marginPct)}</td><td className="num" style={{ color: m.slippageStatus === 'slipping' ? C.red : m.slippageStatus === 'gained' ? C.green : C.ink }}>{m.slippagePoints == null ? '-' : Math.abs(m.slippagePoints) < 0.05 ? 'on bid' : `${m.slippagePoints > 0 ? '-' : '+'}${Math.abs(m.slippagePoints)} pts`}</td><td className="num" style={{ color: m.wipStatus === 'behind' ? C.amber : C.ink }}>{m.overUnderBilled != null && m.wipStatus !== 'na' ? money(m.overUnderBilled) : '-'}</td><td className="num">{m.unbilledCO ? money(m.unbilledCO) : '-'}</td><td>{healthTag(m.health)}</td><td>{billTag(m.billingHealth)}</td></tr>); })}
        </tbody></table></div>
        {rows.some((j) => j.money.costAlerts?.length || j.money.billingAlerts?.length) ? <><h4>Alerts from those pages</h4><ul className="tlist">{rows.filter((j) => j.money.costAlerts?.length || j.money.billingAlerts?.length).map((j) => <li key={j.id}><span className="dot d-amber" /><span className="small"><b>{j.short}:</b> {[...j.money.costAlerts, ...j.money.billingAlerts].join('; ')}</span></li>)}</ul></> : null}
        <p className="small">Over / under billed: positive means invoiced ahead of the work, negative means behind. Slippage: margin points lost (-) or gained (+) against the bid.</p>
      </div>
    );
  }

  /* ================================================================ shell */
  const tabs = [['brief', 'Production Brief'], ['meet', 'Meeting'], ['review', 'Review'], ['history', 'History'], ...(isOwner ? [['money', 'Money (Nathan)']] : [])];
  return (
    <div className="pm" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 16px 64px' }}>
      <style>{CSS}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.maroon }}>Production Meeting</div>
          <div className="small">Meeting date <input type="date" value={meetingDate} onChange={(e) => { dirty.current = true; setMeetingDate(e.target.value); }} style={{ padding: '2px 6px' }} /> · {prodJobs.length} in production · {punchJobs.length} punch list{saveState ? ` · ${saveState}` : ''}</div>
        </div>
        <div className="small"><b style={{ color: C.ink }}>{changeCount}</b> JobTread change{changeCount === 1 ? '' : 's'} queued</div>
      </div>
      {err && <div className="msg err">{err}</div>}
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => { setView(k); window.scrollTo(0, 0); }}>{l}</button>)}</div>
      {view === 'brief' && Brief()}
      {view === 'meet' && Meet()}
      {view === 'review' && Review()}
      {view === 'history' && History()}
      {view === 'money' && isOwner && Money()}
    </div>
  );
}
