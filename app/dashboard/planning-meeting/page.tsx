// @ts-nocheck
'use client';

/**
 * Planning Meeting (Tuesday). Design agreed with Nathan 2026-10-10, see the
 * JobTread Assistant project doc claude/BKB-Meetings-and-Job-Setup-Game-Plan-2026-10-10.md
 *
 *   Prep Brief   flags from JobTread; each is "Bring to meeting" or "Handled"
 *   Meeting      1 Job by job, 2 On-hold jobs, 3 Six-week look ahead, 4 Close
 *   Review       everything queued for JobTread, Confirm writes it; transcript step
 *   History      past meetings with plus and delta
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
const WEEKS = [20, 16, 14, 12, 8, 4, 1];
const REASONS = ['Waiting on the client', 'Waiting on engineer or designer', 'Waiting on a sub or supplier', 'Too much on one person', 'Not a real task', 'Other'];
const STEPS = ['Job by job', 'On-hold jobs', '6-week look ahead', 'Close'];
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
/** JobTread's limit on a to-do description (the 📄 JOB PLAN). */
const PLAN_MAX = 4096;
const QLABELS = { q1: 'Are we on track for the next gate date?', q2: 'What is in the way?', q3: 'What has to be decided, ordered or ready in the next 3 weeks?', q4: 'Who owes what, by when?' };
const TRACK = { on: 'On track', risk: 'At risk', off: 'Off track' };
/** Mirrors meetingNotesText() in app/lib/planning-meeting/constants.ts */
function notesText(js) {
  if (!js) return '';
  const q = js.q || {}, parts = [];
  for (const k of ['q1', 'q2', 'q3', 'q4']) { const a = q[k] || {}; const t = k === 'q1' && a.track ? TRACK[a.track] : ''; const n = String(a.note || '').trim(); if (t || n) parts.push(`${QLABELS[k]}\n${[t, n].filter(Boolean).join('. ')}`); }
  const other = String(js.notes || '').trim(); if (other) parts.push(`Other notes and decisions\n${other}`);
  return parts.join('\n\n');
}
const first = (n) => String(n || '').split(' ')[0];
let uidN = 0;
const uid = () => `${Date.now().toString(36)}${(uidN++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
.pm .d-red{background:${C.red}}.pm .d-amber{background:${C.amber}}.pm .d-green{background:${C.green}}.pm .d-house{background:${C.house}}
.pm .gbar{display:flex;gap:2px;width:150px;max-width:100%}
.pm .gbar span{flex:1;height:8px;border-radius:2px;background:${C.soft};position:relative;overflow:hidden}
.pm .gbar span i{position:absolute;left:0;top:0;bottom:0;background:${C.green}}
.pm .gbar span.cur{outline:1.5px solid ${C.maroon};outline-offset:1px}
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
.pm .mk{display:grid;grid-template-columns:1fr 160px 80px;gap:6px 10px;align-items:center}
.pm .track{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin:4px 0}
.pm .tstep{border:1.5px solid;border-radius:8px;padding:6px 7px;min-width:0}
.pm .tnum{font-weight:800;font-size:13px}
.pm .tname{font-size:11.5px;font-weight:600;line-height:1.2;margin:2px 0;min-height:28px}
.pm .tmeta{font-size:11px;opacity:.9}
.pm .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
.pm .facts>div{background:${C.soft};border-radius:8px;padding:7px 10px;display:flex;flex-direction:column;gap:2px;font-size:13.5px}
.pm .review{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.pm .rcol{border:1px solid ${C.line};border-radius:8px;padding:9px 11px;font-size:13.5px}
.pm .rcol ul{margin:4px 0 0;padding-left:17px}
.pm .rhead{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:${C.maroon};margin-bottom:4px}
.pm .read{margin-top:10px;border-left:3px solid ${C.blue};background:${C.blueSoft};border-radius:0 8px 8px 0;padding:9px 12px;font-size:14px}
.pm .qbox{border:1px solid ${C.line};border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#fff}
.pm .qhead{font-weight:700;margin-bottom:4px}
.pm .nr{border:0;background:none;color:${C.muted};font-size:12px;text-decoration:underline;cursor:pointer;padding:0 0 0 6px}
.pm .nr:hover{color:${C.red}}
.pm .plan{margin-top:8px;border:1px solid ${C.line};border-radius:8px;padding:8px 11px;font-size:13.5px;background:#fff}
.pm .plan pre{white-space:pre-wrap;font:inherit;margin:4px 0 0;max-height:260px;overflow:auto;background:${C.soft};border-radius:6px;padding:8px 10px}
.pm .ctx{margin-top:8px;border:1px dashed ${C.line};border-radius:8px;padding:8px 11px;font-size:13.5px;background:#fff}
.pm .ctx ul{margin:4px 0 6px;padding-left:17px}
.pm .msg{margin-top:10px;padding:10px 12px;border-radius:8px;font-size:14px}
.pm .ok{background:${C.greenSoft};color:${C.green}}.pm .err{background:${C.redSoft};color:${C.red}}
@media (max-width:760px){.pm .track{grid-template-columns:repeat(4,1fr)}.pm .facts{grid-template-columns:1fr 1fr}.pm .review{grid-template-columns:1fr}.pm .grid4{grid-template-columns:1fr 1fr}.pm .mk{grid-template-columns:1fr 1fr}.pm .mk .lab{grid-column:1/-1}}
`;

/* ------------------------------------------------------------------ helpers on a job */
const gateDone = (g) => g.items.filter((i) => i[1]).length;
function tickVal(js, j, g, i) { const k = `${g}_${i}`; return js.ticks && k in js.ticks ? js.ticks[k] : !!j.gates[g].items[i][1]; }
function gateDoneLive(js, j, g) { return j.gates[g].items.reduce((n, _, i) => n + (tickVal(js, j, g, i) ? 1 : 0), 0); }
function curGateLive(js, j) { for (let g = 0; g < j.gates.length; g++) if (gateDoneLive(js, j, g) < j.gates[g].items.length) return g; return Math.max(0, j.gates.length - 1); }
function defaults(j) { return j.start ? WEEKS.map((w) => addDays(j.start, -7 * w)) : null; }

function GateBar({ j, js }) {
  const c = curGateLive(js, j);
  return (
    <div className="gbar" title={`Gate ${c + 1} is the current gate`}>
      {j.gates.map((g, i) => <span key={i} className={i === c ? 'cur' : ''}><i style={{ width: `${Math.round((100 * gateDoneLive(js, j, i)) / g.items.length)}%` }} /></span>)}
    </div>
  );
}

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

/** Put a job on hold: wake-up date and reason, saved with a button. */
function HoldForm({ initialDate, initialReason = '', onSave, onCancel, saveLabel = 'Put on hold' }) {
  const [date, setDate] = useState(initialDate || '');
  const [reason, setReason] = useState(initialReason || '');
  const [busy, setBusy] = useState(false);
  return (
    <div className="row" style={{ marginTop: 6 }}>
      <label className="small">Wake-up date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <input type="text" className="grow" placeholder="Why it is on hold" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn sm pri" disabled={busy || !date} onClick={async () => { setBusy(true); await onSave(date, reason.trim()); setBusy(false); }}>{busy ? 'Saving...' : saveLabel}</button>
      {onCancel ? <button className="btn sm" onClick={onCancel}>Cancel</button> : null}
    </div>
  );
}

/** One row on the On-hold list, editable. */
function HoldRow({ job, hold, meetingDate, onSave, onWake }) {
  const [edit, setEdit] = useState(false);
  const due = hold.next_touch && hold.next_touch <= meetingDate;
  return (
    <div className="card pad" style={{ marginBottom: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><b>{job.short}</b> <span className="small">{job.name}</span>
          <div className="small">Wake-up date: <b style={{ color: due ? C.red : C.ink }}>{hold.next_touch ? fd(hold.next_touch, true) : 'none set'}</b>{due ? ' (arrived, back in Job by job)' : ''} · Reason: <b style={{ color: C.ink }}>{hold.reason || 'none given'}</b>{hold.set_by ? ` · set by ${hold.set_by}` : ''}</div>
        </div>
        <div className="row"><button className="btn sm" onClick={() => setEdit(!edit)}>{edit ? 'Close' : 'Edit'}</button><button className="btn sm" onClick={onWake}>Wake up now</button></div>
      </div>
      {edit ? <HoldForm initialDate={hold.next_touch} initialReason={hold.reason} saveLabel="Save" onSave={async (d, r) => { await onSave(d, r); setEdit(false); }} onCancel={() => setEdit(false)} /> : null}
      {job.start ? <div className="small" style={{ color: C.red, marginTop: 4 }}>{job.startName} is still on the schedule for {fd(job.start)}. Move the start or take it off hold.</div> : null}
    </div>
  );
}

/**
 * One line of Claude's read with a "Not right" button. Saving a correction hides
 * the line and tells Claude, on every later read, not to raise it again.
 */
function ReadLine({ text, onDismiss, as = 'li', label = null }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await onDismiss(text, why.trim()); setOpen(false); setWhy(''); } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };
  const body = (
    <>
      {label ? <b>{label} </b> : null}{text}<button className="nr" onClick={() => setOpen(!open)}>{open ? 'cancel' : 'Not right'}</button>
      {open ? (
        <div className="row" style={{ margin: '4px 0 6px' }}>
          <input type="text" className="grow" autoFocus placeholder="What is actually true (optional), e.g. received from Village 30 Sep" value={why} onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
          <button className="btn sm pri" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save correction'}</button>
          {err ? <span className="small" style={{ color: C.red }}>{err}</span> : null}
        </div>
      ) : null}
    </>
  );
  return as === 'li' ? <li>{body}</li> : <div style={{ marginTop: 4 }}>{body}</div>;
}

/** What the team has told Claude about one job: corrections, standing context, and a redo button. */
function ContextPanel({ rows, onAdd, onRemove, onRedo, redoing, redoErr }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => { if (!note.trim()) return; setBusy(true); try { await onAdd(note.trim()); setNote(''); } finally { setBusy(false); } };
  return (
    <div className="ctx">
      <div className="rhead" style={{ color: C.blue }}>What the team has told Claude</div>
      {rows.length ? (
        <ul>{rows.map((r) => (
          <li key={r.id}>
            {r.kind === 'dismiss' ? <>Not right: "{r.target}"{r.note ? <>. <b>{r.note}</b></> : null}</> : <>Context: <b>{r.note}</b></>}
            <span className="small"> · {r.created_by_name || 'someone'}, {fd(String(r.created_at).slice(0, 10))}</span>
            <button className="nr" onClick={() => onRemove(r.id)}>remove</button>
          </li>
        ))}</ul>
      ) : <div className="small" style={{ margin: '2px 0 6px' }}>Nothing yet. Click Not right on any line Claude got wrong, or add context it cannot see in JobTread.</div>}
      <div className="row">
        <input type="text" className="grow" placeholder="Add context Claude cannot see in JobTread, e.g. client decides by email only" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button className="btn sm" disabled={busy || !note.trim()} onClick={add}>{busy ? 'Saving...' : 'Add context'}</button>
        <button className="btn sm" disabled={!!redoing} onClick={onRedo}>{redoing ? 'Claude is rereading...' : "Redo Claude's read"}</button>
      </div>
      {redoErr ? <div className="small" style={{ color: C.red, marginTop: 4 }}>{redoErr}</div> : null}
      <div className="small" style={{ marginTop: 4 }}>These carry forward every week until removed. Ones added in this meeting also go into the job's meeting daily log at Confirm.</div>
    </div>
  );
}

/**
 * The job's 📄 JOB PLAN, shown on the card and editable in the meeting.
 * Saving keeps the edit with the meeting; Confirm writes it to JobTread
 * (only if nobody changed the Job Plan in JobTread in the meantime).
 */
function JobPlanBox({ planText, hasTodo, edited, base, onSave, onUndo }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const shown = edited ?? planText ?? '';
  const stale = edited != null && base != null && String(base).trim() !== String(planText || '').trim();
  if (!hasTodo) return <div className="plan small">No 📄 JOB PLAN on this job. Add it from the Set up a job tab.</div>;
  return (
    <div className="plan">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="rhead" style={{ margin: 0 }}>Job Plan {edited != null ? <span className="tag t-blue" style={{ marginLeft: 6 }}>edited, saves to JobTread at Confirm</span> : null}</div>
        <div className="row">
          {!editing ? <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button> : null}
          {!editing ? <button className="btn sm" onClick={() => { setText(shown); setEditing(true); setOpen(true); }}>Edit</button> : null}
          {edited != null && !editing ? <button className="btn sm" onClick={onUndo}>Undo edit</button> : null}
        </div>
      </div>
      {stale ? <div className="small" style={{ color: C.red, marginTop: 4 }}>The Job Plan was changed in JobTread after this edit was started. Undo edit, then edit again from the new version, or Confirm will stop on this job.</div> : null}
      {edited != null && edited.length > PLAN_MAX ? <div className="small" style={{ color: C.red, marginTop: 4 }}>This edit is {edited.length.toLocaleString()} characters. JobTread allows {PLAN_MAX.toLocaleString()}, so Confirm will stop on this job. Edit it shorter.</div> : null}
      {editing ? (
        <>
          <textarea style={{ minHeight: 320, marginTop: 6, fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="small" style={{ marginTop: 4, color: text.length > PLAN_MAX ? C.red : undefined }}>
            {text.length.toLocaleString()} of {PLAN_MAX.toLocaleString()} characters{text.length > PLAN_MAX ? `. JobTread will not save more than ${PLAN_MAX.toLocaleString()}; cut ${(text.length - PLAN_MAX).toLocaleString()} to save this edit.` : ''}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn sm pri" disabled={text.length > PLAN_MAX} onClick={() => { onSave(text); setEditing(false); }}>Save edit</button>
            <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
            <span className="small">Facts only. Anything someone has to do or answer by a date is a task above, not a line here.</span>
          </div>
        </>
      ) : open ? <pre>{shown || 'Empty'}</pre> : null}
    </div>
  );
}

/** Projected build block for one job: start date + rough weeks -> one bar in 🤖 PRODUCTION MILESTONES. */
function BuildBlock({ check, post, onDone }) {
  const b = check.block || {};
  const [start, setStart] = useState(b.suggest?.start || '');
  const [weeks, setWeeks] = useState(b.suggest?.weeks ? String(b.suggest.weeks) : '');
  const [markers, setMarkers] = useState(true);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const w = Number(weeks);
  const end = start && w > 0 ? (() => { const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + Math.round(w * 7) - 1); const dow = d.getUTCDay(); if (dow === 6) d.setUTCDate(d.getUTCDate() - 1); if (dow === 0) d.setUTCDate(d.getUTCDate() - 2); return iso(d); })() : null;
  const add = async () => {
    setBusy(true); setMsg(null);
    try { const j = await post({ jobId: check.job.id, action: 'block', start, weeks: w, dateMarkers: markers }); setMsg({ ok: true, text: `Added: ${j.done.join('; ')}.` }); onDone(j.block); }
    catch (e) { setMsg({ ok: false, text: String(e.message || e) }); }
    setBusy(false);
  };
  const dateMarkers = async () => {
    if (replace && !confirm('Replace every gate marker date with the default count back from the build start?')) return;
    setBusy(true); setMsg(null);
    try { const j = await post({ jobId: check.job.id, action: 'markers', replace }); setMsg({ ok: true, text: `${j.done.join('; ')}.` }); setReplace(false); onDone(j.block); }
    catch (e) { setMsg({ ok: false, text: String(e.message || e) }); }
    setBusy(false);
  };
  return (
    <div className="card pad" style={{ marginTop: 10 }}>
      <h3>Projected build block (Gate 1)</h3>
      {b.bars > 0 ? (
        <>
          <div className="small">{b.isProjected ? 'Projected build block' : `Production milestones (${b.bars})`} on the schedule: <b style={{ color: C.ink }}>{fd(b.start, true)} to {fd(b.end, true)}</b>. To move it, use the Production Schedule page.</div>
          {b.markers ? (
            <div style={{ marginTop: 8 }}>
              <div className="small">Gate markers: {b.markersUndated ? <b style={{ color: C.ink }}>{b.markersUndated} of {b.markers} undated</b> : `all ${b.markers} dated`}. The button dates them 20, 16, 14, 12, 8, 4 and 1 weeks before {fd(b.start, true)} (Gates 2 to 8). Edit any date in JobTread after.</div>
              <div className="row" style={{ marginTop: 6 }}>
                <label className="small"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Also replace dates already set</label>
                <button className="btn sm" disabled={busy || (!b.markersUndated && !replace)} onClick={dateMarkers}>{busy ? 'Dating...' : 'Date the gate markers'}</button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="small" style={{ margin: '0 0 8px' }}>One bar in 🤖 PRODUCTION MILESTONES from the target start for the rough build length. It puts the job on the Production Schedule (start marked tentative) and lets the gate dates count back from it. The real milestones replace it at Gate 5.</p>
          {b.planStart || b.planWeeks ? <div className="small" style={{ marginBottom: 6 }}>Job Plan says: target start <b style={{ color: C.ink }}>{b.planStart || 'blank'}</b>, rough build length <b style={{ color: C.ink }}>{b.planWeeks || 'blank'}</b>.</div> : null}
          <div className="row">
            <label className="small">Start date <input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="small">Weeks <input type="text" inputMode="decimal" value={weeks} onChange={(e) => setWeeks(e.target.value.replace(/[^0-9.]/g, ''))} style={{ width: 70 }} /></label>
            {b.markersUndated ? <label className="small"><input type="checkbox" checked={markers} onChange={(e) => setMarkers(e.target.checked)} /> Also date the {b.markersUndated} gate markers (20, 16, 14, 12, 8, 4 and 1 weeks before start)</label> : null}
          </div>
          {end ? <div className="small" style={{ marginTop: 6 }}>Bar: {fd(start, true)} to {fd(end, true)}.</div> : null}
          <button className="btn pri sm" style={{ marginTop: 8 }} disabled={busy || !start || !(w > 0)} onClick={add}>{busy ? 'Adding...' : 'Add projected build block'}</button>
        </>
      )}
      {msg ? <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div> : null}
    </div>
  );
}

/** Set up a job from the A-TEST master copy. */
function SetupPanel({ jobs }) {
  const [num, setNum] = useState('');
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const post = async (body) => {
    const res = await fetch('/api/dashboard/planning-meeting/setup', { method: 'POST', headers: { Authorization: token(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Failed');
    return j;
  };
  const look = async (body) => { setBusy('Checking JobTread...'); setMsg(null); setCheck(null); try { setCheck(await post({ ...body, dryRun: true })); } catch (e) { setMsg({ ok: false, text: String(e.message || e) }); } setBusy(''); };
  const run = async () => { setBusy('Setting up in JobTread. This takes about a minute...'); setMsg(null); try { const j = await post({ jobId: check.job.id }); setMsg({ ok: true, text: j.done.length ? `${j.job.name}: added ${j.done.join('; ')}.` : `${j.job.name} already had everything. Nothing added.` }); setCheck(await post({ jobId: check.job.id, dryRun: true })); } catch (e) { setMsg({ ok: false, text: String(e.message || e) }); } setBusy(''); };
  const needs = jobs.filter((j) => j.setup?.noStructure);
  const noBlock = jobs.filter((j) => !j.setup?.noStructure && !j.start);
  return (
    <div>
      <h2>Set up a job</h2>
      <p className="lead">Two steps. <b>1. Structure:</b> the Job Plan to-do, the 8 Project Gates with their checklists (unticked) and the 7 Planning Milestones (undated), copied from A-TEST PROJECT (#100). Only missing pieces are added, so it is safe to run twice. <b>2. Projected build block:</b> once you know a target start and a rough build length, add the bar that puts the job on the schedule.</p>
      {needs.length ? <div className="note"><b>Design jobs missing the structure:</b> {needs.map((j) => <button key={j.id} className="chip" style={{ marginLeft: 6 }} onClick={() => look({ jobId: j.id })}>{j.short}</button>)}</div> : <p className="small">Every job at 5. Design Phase already has the structure.</p>}
      {noBlock.length ? <div className="note"><b>Design jobs with nothing on the production schedule yet:</b> {noBlock.map((j) => <button key={j.id} className="chip" style={{ marginLeft: 6 }} onClick={() => look({ jobId: j.id })}>{j.short}</button>)}</div> : null}
      <div className="card pad">
        <div className="row"><span className="small">Job number</span><input type="text" value={num} onChange={(e) => setNum(e.target.value)} placeholder="e.g. 261" style={{ width: 120 }} onKeyDown={(e) => { if (e.key === 'Enter') look({ jobNumber: num }); }} /><button className="btn sm" disabled={!num.trim() || !!busy} onClick={() => look({ jobNumber: num })}>Check</button>{busy ? <span className="small">{busy}</span> : null}</div>
        {check ? <div style={{ marginTop: 10 }}>
          <div><b>{check.job.name}</b> (#{check.job.number}) <a href={JT(check.job.id)} target="_blank" rel="noreferrer" className="small">Open in JobTread</a></div>
          <h3 style={{ marginTop: 8 }}>1. Structure</h3>
          {check.missing.length ? <><div className="small" style={{ margin: '4px 0 8px' }}>Will add: {check.missing.join(', ')}.{check.oldGates?.length ? ` It also has an old gates group (${check.oldGates.join(', ')}); delete that in JobTread once you are happy.` : ''}</div><button className="btn pri sm" disabled={!!busy} onClick={run}>Set up {check.job.name}</button></> : <div className="small" style={{ marginTop: 4 }}>Done: the job has the Job Plan, Project Gates and Planning Milestones.</div>}
        </div> : null}
        {msg ? <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div> : null}
      </div>
      {check && !check.missing.length ? <BuildBlock key={check.job.id + (check.block?.bars || 0)} check={check} post={post} onDone={(block) => setCheck({ ...check, block })} /> : null}
      <p className="small" style={{ marginTop: 10 }}>After both steps: fill in the Job Plan, and check the gate dates on the job card in the next meeting.</p>
    </div>
  );
}

const STEP_STYLE = (state) => ({
  done: { background: C.greenSoft, borderColor: C.green, color: C.green },
  current: { background: C.blueSoft, borderColor: C.blue, color: C.blue },
  late: { background: C.redSoft, borderColor: C.red, color: C.red },
  todo: { background: '#fff', borderColor: C.line, color: C.muted },
}[state]);

/** The 8 gates as a horizontal track with due dates. */
function GateTrack({ j, js, today }) {
  const c = curGateLive(js, j);
  const dfl = defaults(j);
  return (
    <div className="track">
      {j.gates.map((g, i) => {
        const done = gateDoneLive(js, j, i), n = g.items.length;
        const m = i > 0 ? j.markers.find((x) => x.gate === i + 1) : null;
        const set = i > 0 ? (js.markers?.[m?.id] || m?.date) : null;
        const due = set || (i > 0 && dfl ? dfl[i - 1] : null);
        const state = done >= n ? 'done' : due && due < today ? 'late' : i === c ? 'current' : 'todo';
        return (
          <div key={g.id} className="tstep" style={STEP_STYLE(state)}>
            <div className="tnum">{i + 1}</div>
            <div className="tname">{g.name.replace(/^\d+\.\s*/, '')}</div>
            <div className="tmeta">{done}/{n}{due ? ` · ${fd(due)}${set ? '' : '*'}` : i === 0 ? '' : ' · no date'}</div>
          </div>
        );
      })}
    </div>
  );
}


function Transcript({ last }) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState('');
    const [result, setResult] = useState(last?.transcript_result || null);
    const [msg, setMsg] = useState(null);
    if (!last) return <><h2>Add the recording transcript</h2><p className="empty">After the first meeting is confirmed, paste its transcript here.</p></>;
    const post = async (body) => {
      const res = await fetch('/api/dashboard/planning-meeting/transcript', { method: 'POST', headers: { Authorization: token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId: last.id, ...body }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed');
      return j;
    };
    const analyze = async () => { setBusy('Claude is reading the transcript...'); setMsg(null); try { const j = await post({ action: 'analyze', transcript: text }); setResult(j.result); } catch (e) { setMsg({ ok: false, text: String(e.message || e) }); } setBusy(''); };
    const toggle = (ji, kind, id, v) => { const r = JSON.parse(JSON.stringify(result)); const it = r.jobs[ji][kind].find((x) => x.id === id); it.approved = v; setResult(r); post({ action: 'save', result: r }).catch(() => {}); };
    const nApproved = result ? result.jobs.reduce((n, j) => n + j.notes.filter((x) => x.approved).length + j.tasks.filter((x) => x.approved).length, 0) : 0;
    const apply = async () => { setBusy('Writing to JobTread...'); setMsg(null); try { const j = await post({ action: 'apply', result }); setMsg({ ok: j.ok, text: j.ok ? `Written: ${j.written} change${j.written === 1 ? '' : 's'}.` : `${j.failed} failed. Press again to retry. ${j.errors.map((e) => e.error).join(' | ')}` }); if (j.ok) setResult({ ...result, appliedAt: new Date().toISOString() }); } catch (e) { setMsg({ ok: false, text: String(e.message || e) }); } setBusy(''); };
    return (
      <div>
        <h2>Add the recording transcript</h2>
        <p className="lead">For the meeting on {fd(last.meeting_date, true)}. Paste the text when the recording is ready. Claude splits it by job and suggests anything said but not captured. Nothing is written until you approve each suggestion.</p>
        {!result && <div className="card pad">
          <textarea style={{ minHeight: 140 }} placeholder="Paste the transcript text here" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}><button className="btn sm" disabled={!!busy || text.trim().length < 200} onClick={analyze}>Split by job and suggest</button>{busy && <span className="small">{busy}</span>}</div>
        </div>}
        {result && <div>
          {result.appliedAt ? <div className="msg ok">Approved suggestions were written to JobTread {new Date(result.appliedAt).toLocaleString()}.</div> : null}
          {result.jobs.length ? result.jobs.map((j, ji) => <div key={j.jobId} className="card pad" style={{ marginBottom: 10 }}>
            <h3>{last.jobNames?.[j.jobId] || j.jobId}</h3>
            {j.tasks.map((t) => <label key={t.id} style={{ display: 'flex', gap: 8, padding: '4px 0', cursor: 'pointer' }}><input type="checkbox" checked={!!t.approved} disabled={!!result.appliedAt} onChange={(e) => toggle(ji, 'tasks', t.id, e.target.checked)} /><span><span className={`tag ${t.kind === 'roadblock' ? 't-red' : 't-blue'}`} style={{ marginRight: 6 }}>missed {t.kind}</span>{t.what} · <b>{t.who || 'no owner'}</b>{t.due ? ' · ' + fd(t.due) : ''}{t.details ? <div className="small">{t.details}</div> : null}{t.quote ? <div className="small">"{t.quote}"</div> : null}</span></label>)}
            {j.notes.map((n) => <label key={n.id} style={{ display: 'flex', gap: 8, padding: '4px 0', cursor: 'pointer' }}><input type="checkbox" checked={!!n.approved} disabled={!!result.appliedAt} onChange={(e) => toggle(ji, 'notes', n.id, e.target.checked)} /><span><span className="tag t-green" style={{ marginRight: 6 }}>add to notes</span>{n.text}</span></label>)}
            {j.mismatches.map((m) => <div key={m.id} className="small" style={{ padding: '4px 0' }}><span className="tag t-amber" style={{ marginRight: 6 }}>check</span>{m.text}{m.quote ? ` ("${m.quote}")` : ''}</div>)}
          </div>) : <p className="empty">Claude found nothing missing.</p>}
          {result.general?.length ? <div className="card pad"><h3>Not about a listed job</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{result.general.map((g, i) => <li key={i}>{g}</li>)}</ul></div> : null}
          {!result.appliedAt && <div className="row" style={{ marginTop: 8 }}><button className="btn pri" disabled={!nApproved || !!busy} onClick={apply}>Write {nApproved} approved suggestion{nApproved === 1 ? '' : 's'} to JobTread</button><button className="btn sm" onClick={() => setResult(null)}>Paste a different transcript</button>{busy && <span className="small">{busy}</span>}</div>}
          {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
        </div>}
      </div>
    );
  }


/* ================================================================== page */
export default function PlanningMeetingPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [S, setS] = useState({ flags: {}, jobs: {}, triage: {}, rb: {} });
  const [plus, setPlus] = useState('');
  const [delta, setDelta] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [saveState, setSaveState] = useState('');
  const [view, setView] = useState('brief');
  const [step, setStep] = useState(1);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('all');
  const [holds, setHolds] = useState([]);
  const [allHoldRows, setAllHoldRows] = useState([]);
  const [holdFormFor, setHoldFormFor] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState(null);
  const [ctxRows, setCtxRows] = useState([]);
  const [redoing, setRedoing] = useState(null);
  const [redoErr, setRedoErr] = useState({});
  const dirty = useRef(false);
  const loaded = useRef(false);

  async function load(refresh = false) {
    refresh ? setRefreshing(true) : setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/dashboard/planning-meeting${refresh ? '?refresh=1' : ''}`, { headers: { Authorization: token() }, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      setData(json);
      if (!loaded.current || !refresh) {
        const st = json.meeting.state || {};
        setS({ flags: st.flags || {}, jobs: st.jobs || {}, triage: st.triage || {}, rb: st.rb || {} });
        setPlus(json.meeting.plus || '');
        setDelta(json.meeting.delta || '');
        setMeetingDate(json.meeting.meeting_date);
      }
      setHolds(json.holds || []);
      setAllHoldRows(json.holdsAll || json.holds || []);
      setCtxRows(json.context || []);
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
    if (!loaded.current || !data) return;
    if (!dirty.current) return;
    setSaveState('Saving...');
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/dashboard/planning-meeting', {
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
  const jsOf = (st, jid) => (st.jobs[jid] = st.jobs[jid] || { notes: '', items: [], ticks: {}, markers: {}, agenda: {}, draft: { kind: 'commitment', what: '', whoId: '', due: '', details: '' } });
  const JS = (jid) => S.jobs[jid] || { notes: '', items: [], ticks: {}, markers: {}, agenda: {}, draft: { kind: 'commitment', what: '', whoId: '', due: '', details: '' } };

  const meeting = data?.meeting;
  const brief = meeting?.brief || { jobs: [], members: [] };
  const jobs = brief.jobs || [];
  const members = brief.members || [];
  const last = data?.lastMeeting;
  const today = brief.asOf || iso(new Date());
  const holdOf = (jid) => holds.find((h) => h.job_id === jid && h.on_hold);
  const isHeld = (jid) => { const h = holdOf(jid); return !!h && (!h.next_touch || h.next_touch > meetingDate); };
  const allFlags = useMemo(() => jobs.flatMap((j) => (j.flags || []).map((f) => ({ ...f, jid: j.id }))), [jobs]);
  const handled = (fid) => !!S.flags?.[fid]?.handled;

  async function setHold(job, onHold, nextTouch, reason) {
    const res = await fetch('/api/dashboard/planning-meeting', {
      method: 'POST', headers: { Authorization: token(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'hold', jobId: job.id, jobName: job.short, onHold, nextTouch, reason }),
    });
    const j = await res.json();
    if (res.ok) { setHolds(j.holds || []); setAllHoldRows(j.holdsAll || j.holds || []); }
  }

  /* ------------------------------------------------ corrections and context for Claude's read */
  async function ctxPost(body) {
    const res = await fetch('/api/dashboard/planning-meeting', { method: 'POST', headers: { Authorization: token(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Not saved');
    return j;
  }
  const addCtx = async (jobId, kind, target, note) => { const j = await ctxPost({ action: 'context-add', jobId, kind, target, note, meetingId: meeting?.id }); setCtxRows(j.context || []); };
  const removeCtx = async (id) => { const j = await ctxPost({ action: 'context-remove', id }); setCtxRows(j.context || []); };
  async function redoRead(jobId) {
    setRedoing(jobId); setRedoErr((e) => ({ ...e, [jobId]: '' }));
    try {
      const j = await ctxPost({ action: 'redo', meetingId: meeting.id, jobId });
      setData((d) => ({ ...d, meeting: { ...d.meeting, brief: { ...d.meeting.brief, jobs: d.meeting.brief.jobs.map((x) => (x.id === jobId ? { ...x, insight: j.insight } : x)) } } }));
    } catch (e) { setRedoErr((x) => ({ ...x, [jobId]: 'Could not redo the read: ' + (e.message || e) })); }
    setRedoing(null);
  }
  const ctxFor = (jid) => ctxRows.filter((r) => r.job_id === jid);
  const dismissedFor = (jid) => new Set(ctxFor(jid).filter((r) => r.kind === 'dismiss').map((r) => r.target));

  /* ------------------------------------------------ queued changes (mirrors writeback.ts) */
  const changes = useMemo(() => {
    const out = {};
    const add = (jid, kind, text) => (out[jid] = out[jid] || []).push({ kind, text });
    for (const j of jobs) {
      const js = S.jobs[j.id];
      if (!js) continue;
      for (const [k, v] of Object.entries(js.ticks || {})) {
        const [g, i] = k.split('_').map(Number);
        if (j.gates[g] && !!v !== !!j.gates[g].items[i]?.[1]) add(j.id, v ? 'Tick' : 'Untick', `${j.gates[g].name}: ${j.gates[g].items[i][0]}`);
      }
      for (const [mid, d] of Object.entries(js.markers || {})) {
        const m = j.markers.find((x) => x.id === mid);
        if (d && m && m.date !== d) add(j.id, 'Gate date', `${m.name.split(' (')[0]} set to ${fd(d, true)}`);
      }
      if (typeof js.plan === 'string') add(j.id, 'Job Plan', `Update the 📄 JOB PLAN in JobTread with the text edited in this meeting${js.planBase != null && String(js.planBase).trim() !== String(j.planText || '').trim() ? '. Warning: it was changed in JobTread since, so this will stop until the edit is redone' : ''}${js.plan.length > PLAN_MAX ? `. Warning: it is ${js.plan.length.toLocaleString()} characters and JobTread allows ${PLAN_MAX.toLocaleString()}, so this will stop until it is shortened` : ''}`);
      for (const it of js.items || []) add(j.id, it.kind === 'roadblock' ? 'Roadblock' : 'Commitment', `New task in 🔵 ACTIVE: ${it.what} · ${it.whoName || 'no owner'} · ${it.due ? 'due ' + fd(it.due) : 'no date'}${it.details ? ' · description: ' + it.details : ''}`);
    }
    for (const [fid, r] of Object.entries(S.rb || {})) {
      if (r?.act === 'rb' && r.what?.trim()) add(fid.split('|')[1], 'Roadblock', `New task in 🔵 ACTIVE: ${r.what} · ${r.whoName || 'no owner'} · ${r.due ? 'due ' + fd(r.due) : 'no date'}${r.details ? ' · description: ' + r.details : ''}`);
    }
    for (const [tid, t] of Object.entries(S.triage || {})) {
      if (!t?.act) continue;
      if (t.act === 'done') add(t.jobId, 'Update', `Tick complete: ${t.name}`);
      if (t.act === 'move') add(t.jobId, 'Update', `Move into 🔵 ACTIVE: ${t.name}`);
      if (t.act === 'date' && t.date) add(t.jobId, 'Update', `Move due date to ${fd(t.date)}: ${t.name}${t.why ? ' · reason: ' + t.why : ''}`);
      if (t.act === 'drop') add(t.jobId, 'Update', `Drop: tick complete and add "Dropped at the ${fd(meetingDate)} meeting${t.why ? ': ' + t.why : ''}" to its description. Not deleted: ${t.name}`);
    }
    for (const h of allHoldRows) {
      if (!meeting?.created_at || !h.set_at || h.set_at < meeting.created_at || !jobs.some((j) => j.id === h.job_id)) continue;
      const since = h.held_since ? new Date(h.held_since).getTime() : null, start = new Date(meeting.created_at).getTime();
      const det = `${h.next_touch ? ', wake-up ' + fd(h.next_touch) : ''}${h.reason ? ' · reason: ' + h.reason : ''}`;
      const line = h.on_hold && since !== null && since >= start ? `Put on hold${det}.` : h.on_hold && since !== null ? `Still on hold${det}.` : !h.on_hold && since !== null && since < start ? 'Taken off hold.' : null;
      if (line) add(h.job_id, 'Hub only', line + ' Noted in the daily log.');
    }
    for (const r of ctxRows) {
      if (!meeting?.created_at || !r.created_at || r.created_at < meeting.created_at || !jobs.some((j) => j.id === r.job_id)) continue;
      const dot = (t) => String(t || '').trim().replace(/[.\s]+$/, '');
      add(r.job_id, 'Claude', r.kind === 'dismiss' ? `Correction to Claude's read: not right, "${dot(r.target)}"${r.note ? '. ' + dot(r.note) : ''}. Noted in the daily log.` : `Context for Claude: ${dot(r.note)}. Noted in the daily log.`);
    }
    for (const j of jobs) {
      const js = S.jobs[j.id];
      const nt = notesText(js);
      if (out[j.id] || nt) add(j.id, 'Daily log', `One internal daily log dated ${fd(meetingDate)}, "Planning meeting ${fd(meetingDate, true)}", with the four answers and notes${nt ? ` (${nt.split(/\s+/).length} words)` : ''} and the changes above`);
    }
    return out;
  }, [S, jobs, meetingDate, allHoldRows, ctxRows]);
  const changeCount = Object.values(changes).reduce((n, a) => n + a.filter((x) => x.kind !== 'Hub only' && x.kind !== 'Claude').length, 0);

  if (loading) return <div className="pm" style={{ padding: 24 }}><style>{CSS}</style><p className="empty">Reading JobTread for the Prep Brief. The first load of the week takes up to a minute.</p></div>;
  if (err && !data) return <div className="pm" style={{ padding: 24 }}><style>{CSS}</style><div className="msg err">{err}</div><button className="btn" onClick={() => load(false)}>Try again</button></div>;

  /* ================================================================ PREP BRIEF */
  function Brief() {
    const sev = (s) => allFlags.filter((f) => f.sev === s && !isHeld(f.jid)).length;
    const shown = allFlags.filter((f) => !isHeld(f.jid)).filter((f) => filter === 'all' || f.sev === filter || (filter === 'open' && !handled(f.id)));
    const held = jobs.filter((j) => holdOf(j.id));
    const setup = jobs.filter((j) => !isHeld(j.id));
    const nPlan = setup.filter((j) => j.setup?.jobPlanBlank).length, nLead = setup.filter((j) => j.setup?.leadNotNamed).length, nMk = setup.filter((j) => j.setup?.markersUndated).length;
    return (
      <div>
        <h2>Prep Brief</h2>
        <p className="lead">Read from JobTread {brief.builtAt ? 'at ' + new Date(brief.builtAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}. Every flag starts as <b>Bring to meeting</b> and shows on that job's card. Anything fixed in JobTread before the meeting, mark <b>Handled</b> and it drops off the card. Next week the Hub checks JobTread again, so a flag comes back if the problem is still there.</p>
        <div className="row"><button className="btn sm" disabled={refreshing} onClick={() => load(true)}>{refreshing ? 'Reading JobTread...' : 'Refresh from JobTread'}</button>{brief.errors?.length ? <span className="small" style={{ color: C.red }}>Could not read: {brief.errors.join('; ')}</span> : null}</div>
        <div className="grid4">
          <div className="card pad stat"><div className="n" style={{ color: C.red }}>{sev('red')}</div><div className="small">Red: start or status at risk</div></div>
          <div className="card pad stat"><div className="n" style={{ color: C.amber }}>{sev('amber')}</div><div className="small">Amber: overdue, waiting, unsigned</div></div>
          <div className="card pad stat"><div className="n" style={{ color: C.house }}>{sev('house')}</div><div className="small">Housekeeping</div></div>
          <div className="card pad stat"><div className="n">{allFlags.filter((f) => handled(f.id)).length}</div><div className="small">Handled so far</div></div>
        </div>
        <div className="note"><b>Setup gaps</b> (shown once, not as flags): Job Plan blank on {nPlan} of {setup.length} jobs · design lead and PM not named on {nLead} · planning markers undated on {nMk}. These show as talking points on each job's card.</div>
        {held.length > 0 && (
          <div className="card pad" style={{ marginBottom: 10 }}>
            <h3>On hold ({held.length})</h3>
            <p className="small" style={{ margin: '0 0 6px' }}>No flags for these jobs until their wake-up date, except a start still on the schedule.</p>
            <ul className="tlist">{held.map((j) => { const h = holdOf(j.id); const due = h.next_touch && h.next_touch <= meetingDate; return (
              <li key={j.id}><span className={`dot ${due || j.start ? 'd-red' : 'd-house'}`} /><span><b>{j.short}</b> · wake-up {h.next_touch ? fd(h.next_touch) : 'not set'} · reason: {h.reason || 'none given'}{due ? <b> · wake-up date has arrived: it is back in Job by job</b> : null}{j.start ? <b style={{ color: C.red }}> · {j.startName} is still on the schedule for {fd(j.start)}. Move the start or take it off hold.</b> : null}</span></li>); })}</ul>
          </div>
        )}
        <div className="row" style={{ margin: '10px 0' }}>{[['all', 'All'], ['red', 'Red'], ['amber', 'Amber'], ['house', 'Housekeeping'], ['open', 'Not handled yet']].map(([k, l]) => <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>
        {shown.length ? shown.map((f) => (
          <div key={f.id} className={`flag ${f.sev} ${handled(f.id) ? 'done' : ''}`}><div className="bar" /><div className="body">
            <div className="meta"><span className={`tag t-${f.sev}`}>{f.kind}</span><b style={{ color: C.ink }}>{f.job}</b><span>Owner: {f.owner || '?'}</span><a href={JT(f.jid)} target="_blank" rel="noreferrer">Open in JobTread</a></div>
            <div>{f.text}</div>
            <div className="row" style={{ marginTop: 8 }}><div className="seg">
              <button className={!handled(f.id) ? 'on' : ''} onClick={() => touch((s) => { s.flags[f.id] = { handled: false }; })}>Bring to meeting</button>
              <button className={handled(f.id) ? 'on' : ''} onClick={() => touch((s) => { s.flags[f.id] = { handled: true }; })}>Handled</button>
            </div></div>
          </div></div>
        )) : <p className="empty">Nothing in this filter.</p>}
        <h2>Every design job at a glance</h2>
        <p className="lead">Soonest start first. Start is the first bar in 🤖 PRODUCTION MILESTONES. The gate bar has 8 segments; the outlined one is the current gate.</p>
        <div className="card" style={{ overflowX: 'auto' }}><table><thead><tr><th>Job</th><th>Start</th><th>Gates</th><th>Items</th><th>Late tasks</th><th>Client selections</th><th>Last activity</th></tr></thead><tbody>
          {jobs.map((j) => <tr key={j.id}><td><a href={JT(j.id)} target="_blank" rel="noreferrer">{j.short}</a>{holdOf(j.id) ? <span className="tag t-house" style={{ marginLeft: 6 }}>on hold</span> : null}</td><td>{j.start ? fd(j.start) : <span className="small">none</span>}</td><td><GateBar j={j} js={JS(j.id)} /></td><td>{j.done} / {j.total}</td><td>{j.tasks.filter((t) => t.overdue).length || 0}</td><td>{j.sel?.['1. Client Selection Needed'] || 0}</td><td>{j.lastActivity ? fd(j.lastActivity.date) : ''}</td></tr>)}
        </tbody></table></div>
        <div className="nav"><span /><button className="btn pri" onClick={() => { setView('meet'); setStep(1); window.scrollTo(0, 0); }}>Start the meeting</button></div>
      </div>
    );
  }

  /* ================================================================ JOB CARD */
  function JobCard({ j, pos, list }) {
    const js = JS(j.id);
    const isOpen = open === j.id;
    const live = (j.flags || []).filter((f) => !handled(f.id) && f.kind !== 'Overdue task' && f.kind !== 'Aging ask');
    const rf = live.filter((f) => f.sev !== 'house'), hk = live.filter((f) => f.sev === 'house');
    const red = (j.flags || []).filter((f) => f.sev === 'red' && !handled(f.id)).length, amb = (j.flags || []).filter((f) => f.sev === 'amber' && !handled(f.id)).length;
    const c = curGateLive(js, j);
    const gv = js.gateView ?? c;
    const dfl = defaults(j);
    const lm = last?.jobs?.[j.id];
    const q = js.q || {};
    const setQ = (key, field, val) => touch((s) => { const x = jsOf(s, j.id); x.q = x.q || {}; x.q[key] = { ...(x.q[key] || {}), [field]: val }; });
    // gate due dates (marker if set, else default from the start)
    const gateDue = (i) => { if (i === 0) return null; const m = j.markers.find((x) => x.gate === i + 1); return js.markers?.[m?.id] || m?.date || (dfl ? dfl[i - 1] : null); };
    const nextGate = j.gates.findIndex((g, i) => i >= 1 && gateDoneLive(js, j, i) < g.items.length);
    const cur = j.gates[c];
    const openItems = cur ? cur.items.map((it, i) => [it[0], tickVal(js, j, c, i)]).filter((x) => !x[1]).map((x) => x[0]) : [];
    const daysToStart = j.start ? daysBetween(today, j.start) : null;
    // Claude's lines the team has marked Not right are hidden right away.
    const gone = dismissedFor(j.id);
    const vis = (a) => (Array.isArray(a) ? a.filter((x) => x && !gone.has(x)) : []);
    const dismiss = (text, why) => addCtx(j.id, 'dismiss', text, why);
    // waiting on (from JobTread facts)
    const waiting = [
      ...j.tasks.filter((t) => t.type === 'Pending').map((t) => `${t.name} (${t.who.join(', ') || 'no owner'}${t.due ? ', since ' + fd(t.due) : ''})`),
      ...j.roadblocks.map((r) => `Roadblock: ${r.name} (${r.who.join(', ') || 'no owner'}, open ${r.daysOpen} days)`),
      ...((j.sel?.['1. Client Selection Needed'] || 0) ? [`Client: ${j.sel['1. Client Selection Needed']} selection${j.sel['1. Client Selection Needed'] > 1 ? 's' : ''} to decide`] : []),
      ...((j.sel?.['2. Internal Selection Needed'] || 0) ? [`Us: ${j.sel['2. Internal Selection Needed']} internal selection${j.sel['2. Internal Selection Needed'] > 1 ? 's' : ''}`] : []),
      ...(j.flags || []).filter((f) => f.kind === 'Unsigned contract').map((f) => f.text),
    ];
    // next 3 weeks (for question 3)
    const soonEnd = addDays(meetingDate, 21);
    const soon = [
      ...j.tasks.filter((t) => t.due && t.due <= soonEnd).map((t) => ({ d: t.due, t: `${t.name} (${t.who.join(', ') || 'no owner'})`, late: t.overdue })),
      ...j.gates.map((g, i) => ({ d: gateDue(i), t: `Gate ${i + 1} due: ${g.name.replace(/^\d+\.\s*/, '')}`, late: false, done: gateDoneLive(js, j, i) >= g.items.length })).filter((x) => x.d && x.d >= today && x.d <= soonEnd && !x.done),
      ...(j.start && j.start >= today && j.start <= soonEnd ? [{ d: j.start, t: `Production start: ${j.startName}`, late: false }] : []),
      ...(j.decisions?.list || []).filter((x) => x.decideBy && x.decideBy <= soonEnd).map((x) => ({ d: x.decideBy, t: `Decide: ${x.name}${x.tag ? ' (' + x.tag + ')' : ''}, ${x.status || 'no status'}`, late: x.decideBy < today })),
    ].sort((a, b) => (a.d < b.d ? -1 : 1));
    const commitments = (js.items || []).map((it, i) => [it, i]).filter(([it]) => it.kind !== 'roadblock');
    const roadblocksNew = (js.items || []).map((it, i) => [it, i]).filter(([it]) => it.kind === 'roadblock');
    const itemRow = ([it, i]) => <div key={it.uid} className="added"><span><span className={`tag ${it.kind === 'roadblock' ? 't-red' : 't-blue'}`} style={{ marginRight: 6 }}>{it.kind}</span>{it.what} · <b>{it.whoName || 'no owner'}</b> · {it.due ? fd(it.due, true) : 'no date'}{it.details ? <><br /><span className="small" style={{ whiteSpace: 'pre-wrap' }}>{it.details}</span></> : null}</span><button className="x" aria-label="Remove" onClick={() => touch((s) => { jsOf(s, j.id).items.splice(i, 1); })}>×</button></div>;
    const holdOpen = holdFormFor === j.id;
    return (
      <div className="card job">
        <div className="head" onClick={() => setOpen(isOpen ? null : j.id)}>
          <div>
            <div style={{ fontWeight: 700 }}>{j.short} <span className="small" style={{ fontWeight: 400 }}>{j.name}</span></div>
            <div className="small">Gate {c + 1} {cur?.name.replace(/^\d+\.\s*/, '')} · {gateDoneLive(js, j, c)} of {cur?.items.length || 0}{j.start ? ` · ${j.startName} ${fd(j.start)}` : ' · no start date'}</div>
          </div>
          <div className="row"><GateBar j={j} js={js} />{red ? <span className="tag t-red">{red} red</span> : null}{amb ? <span className="tag t-amber">{amb} amber</span> : null}{j.roadblocks?.length ? <span className="tag t-red">{j.roadblocks.length} roadblock{j.roadblocks.length > 1 ? 's' : ''}</span> : null}<span className="small">{isOpen ? 'Close' : 'Open'}</span></div>
        </div>
        {isOpen && (
          <div className="bd">
            {/* 1. PROJECT REVIEW */}
            <h4>1. Project review: where it stands</h4>
            {j.gates.length ? <GateTrack j={j} js={js} today={today} /> : <p className="empty">No ✅ PROJECT GATES on this job. Set it up from the Set up a job tab.</p>}
            <div className="small" style={{ margin: '4px 0 10px' }}>Green is done, blue is the current gate, red means the gate date has passed with items still open. * date counted back from the production start (not set yet).</div>
            <div className="facts">
              <div><span className="small">Production start</span><b>{j.start ? `${fd(j.start, true)} (${daysToStart >= 0 ? daysToStart + ' days' : 'started'})` : 'Not on the schedule'}</b></div>
              <div><span className="small">Design lead / PM</span><b>{j.plan?.designLead || 'not named'} / {j.plan?.pm || 'not named'}</b></div>
              <div><span className="small">Client target window</span><b>{j.plan?.clientWindow || 'not in Job Plan'}</b></div>
              <div><span className="small">Last activity</span><b>{j.lastActivity ? `${fd(j.lastActivity.date)} (${j.lastActivity.what})` : 'none'}</b></div>
            </div>
            <div className="review">
              <div className="rcol"><div className="rhead">Where we are</div>
                <div>Gate {c + 1}: <b>{cur?.name.replace(/^\d+\.\s*/, '')}</b>, {gateDoneLive(js, j, c)} of {cur?.items.length || 0} done.</div>
                {openItems.length ? <ul>{openItems.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}{openItems.length > 4 ? <li className="small">and {openItems.length - 4} more</li> : null}</ul> : null}
                {nextGate > 0 && gateDue(nextGate) ? <div className="small">Gate {nextGate + 1} due {fd(gateDue(nextGate))}{gateDue(nextGate) < today ? <b style={{ color: C.red }}> (past)</b> : ''}</div> : null}
              </div>
              <div className="rcol"><div className="rhead">Waiting on</div>{waiting.length ? <ul>{waiting.slice(0, 5).map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="small">Nothing recorded as waiting in JobTread.</div>}</div>
              <div className="rcol"><div className="rhead">Focus next</div>{vis(j.insight?.focus).length ? <ul>{vis(j.insight.focus).map((x) => <ReadLine key={x} text={x} onDismiss={dismiss} />)}</ul> : openItems.length ? <ul>{openItems.slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="small">Current gate is complete.</div>}</div>
            </div>
            {j.insight ? <div className="read"><div className="rhead">Claude's read from JobTread <span className="small" style={{ fontWeight: 400 }}>(check it, built {fd(String(j.insight.at || '').slice(0, 10))}{j.insight.read ? `, read ${j.insight.read.messages} message${j.insight.read.messages === 1 ? '' : 's'} and ${j.insight.read.logs} daily log${j.insight.read.logs === 1 ? '' : 's'} from the last ${j.insight.read.days} days` : ''}{j.insight.read?.corrections || j.insight.read?.context ? `, plus ${(j.insight.read.corrections || 0) + (j.insight.read.context || 0)} from the team` : ''}{j.insight.read?.lastMeeting ? ' and last meeting\'s notes' : ''})</span></div>
              {vis([j.insight.stand]).length ? <ReadLine as="div" text={j.insight.stand} onDismiss={dismiss} /> : null}
              {vis(j.insight.waiting).length ? <div style={{ marginTop: 4 }}><b>Waiting on:</b><ul style={{ margin: '2px 0 0', paddingLeft: 17 }}>{vis(j.insight.waiting).map((x) => <ReadLine key={x} text={x} onDismiss={dismiss} />)}</ul></div> : null}
              {vis([j.insight.goal]).length ? <ReadLine as="div" label="Goals and start date:" text={j.insight.goal} onDismiss={dismiss} /> : null}
              {vis(j.insight.gaps).length ? <div style={{ marginTop: 4 }} className="small"><b>Missing from JobTread:</b><ul style={{ margin: '2px 0 0', paddingLeft: 17 }}>{vis(j.insight.gaps).map((x) => <ReadLine key={x} text={x} onDismiss={dismiss} />)}</ul></div> : null}
            </div> : <div className="small" style={{ marginBottom: 6 }}>Claude's written review appears here after the next Refresh from JobTread.</div>}
            <JobPlanBox planText={j.planText} hasTodo={!!j.planTodoId} edited={typeof js.plan === 'string' ? js.plan : null} base={js.planBase ?? null}
              onSave={(t) => touch((s) => { const x = jsOf(s, j.id); if (x.planBase == null) x.planBase = j.planText || ''; if (t.trim() === String(x.planBase).trim()) { delete x.plan; delete x.planBase; } else x.plan = t; })}
              onUndo={() => touch((s) => { const x = jsOf(s, j.id); delete x.plan; delete x.planBase; })} />
            <ContextPanel rows={ctxFor(j.id)} onAdd={(note) => addCtx(j.id, 'context', null, note)} onRemove={removeCtx} onRedo={() => redoRead(j.id)} redoing={redoing === j.id} redoErr={redoErr[j.id]} />
            <div className="small" style={{ marginTop: 6 }}><a href={JT(j.id)} target="_blank" rel="noreferrer">Open in JobTread</a></div>

            {/* 2. SINCE LAST MEETING */}
            <h4>2. Since last meeting</h4>
            {vis(j.insight?.recent).length ? <div className="note" style={{ marginBottom: 6 }}><b>From job messages and daily logs (Claude, check it):</b><ul style={{ margin: '4px 0 0' }}>{vis(j.insight.recent).map((x) => <ReadLine key={x} text={x} onDismiss={dismiss} />)}</ul></div> : null}
            {last ? (
              <>
                {lm?.notes ? <div className="note" style={{ whiteSpace: 'pre-wrap' }}><b>Notes from {fd(last.meeting_date)}:</b>{'\n'}{lm.notes}</div> : <p className="empty" style={{ margin: '0 0 6px' }}>No notes for this job at the {fd(last.meeting_date)} meeting.</p>}
                {j.lastMeeting?.length ? <p className="small" style={{ margin: '0 0 6px' }}>From last meeting: kept {j.lastMeeting.filter((t) => t.status === 'done').length} of {j.lastMeeting.length}. Late ones are marked below.</p> : null}
                {(j.lastMeeting || []).filter((t) => t.status === 'done').map((t) => <div key={t.id} className="small">✓ Done: {t.name} ({t.who || 'no owner'})</div>)}
              </>
            ) : <p className="empty" style={{ margin: '0 0 6px' }}>First meeting, so there are no notes or commitments from last week yet.</p>}
            <div className="small" style={{ margin: '6px 0' }}>Open tasks on this job. Decide each late one: Done, New date, or Drop. Tasks outside 🔵 ACTIVE can be moved in.</div>
            {j.tasks.length ? <ul className="tlist">{j.tasks.map((t) => { const tr = S.triage[t.id] || {}; const opts = [['done', 'Done'], ['date', 'New date'], ['drop', 'Drop'], ...(t.src !== 'ACTIVE' ? [['move', 'Move to ACTIVE']] : [])]; return (
              <li key={t.id} style={{ flexWrap: 'wrap' }}>
                <span className={`dot ${t.overdue ? 'd-amber' : t.doneLike ? 'd-house' : 'd-green'}`} />
                <div className="grow">{t.name}{t.fromLast ? <span className="tag t-blue" style={{ marginLeft: 6 }}>from last meeting</span> : null}{t.roadblock ? <span className="tag t-red" style={{ marginLeft: 6 }}>roadblock</span> : null}{t.src !== 'ACTIVE' ? <span className="small"> (not in 🔵 ACTIVE)</span> : null}
                  <div className="small">{t.who.join(', ') || 'no owner'} · {t.due ? 'due ' + fd(t.due) : 'no date'}{t.overdue ? <b style={{ color: C.amber }}> · {t.days} day{t.days === 1 ? '' : 's'} late</b> : null}{t.type ? ' · type ' + t.type : ''}</div></div>
                {(t.overdue || tr.act || t.src !== 'ACTIVE') && <div className="seg">{opts.map(([k, l]) => <button key={k} className={tr.act === k ? 'on' : ''} onClick={() => touch((s) => { s.triage[t.id] = s.triage[t.id]?.act === k ? {} : { ...(s.triage[t.id] || {}), act: k, jobId: j.id, name: t.name }; })}>{l}</button>)}</div>}
                {(tr.act === 'date' || tr.act === 'drop') && <div className="row" style={{ flex: '1 1 100%', margin: '6px 0 0 16px' }}>
                  {tr.act === 'date' && <input type="date" value={tr.date || ''} onChange={(e) => touch((s) => { s.triage[t.id].date = e.target.value; })} />}
                  <select value={tr.why || ''} onChange={(e) => touch((s) => { s.triage[t.id].why = e.target.value; })}><option value="">Why did it slip?</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                </div>}
              </li>); })}</ul> : <p className="empty">No open tasks.</p>}

            {/* 3. ROADBLOCKS AND RED FLAGS */}
            <h4>3. Roadblocks and red flags</h4>
            {j.roadblocks?.length ? <ul className="tlist" style={{ marginBottom: 8 }}>{j.roadblocks.map((r) => <li key={r.id}><span className="dot d-red" /><span><b>{r.name}</b> · {r.who.join(', ') || 'no owner'} · open {r.daysOpen} days{r.due ? ' · due ' + fd(r.due) : ''}</span></li>)}</ul> : <p className="empty" style={{ margin: '0 0 6px' }}>No open roadblocks. Roadblocks stay here every week until they are ticked complete in JobTread.</p>}
            {rf.map((f) => { const r = S.rb[f.id] || {}; return (
              <div key={f.id} className={`flag ${f.sev}`}><div className="bar" /><div className="body">
                <div className="meta"><span className={`tag t-${f.sev}`}>{f.kind}</span></div>
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
                  <textarea style={{ minHeight: 52, marginTop: 6 }} placeholder="Description: what needs to happen to clear it, who to call, links" defaultValue={r.details || ''} onBlur={(e) => touch((s) => { s.rb[f.id].details = e.target.value; })} />
                </>}
              </div></div>); })}
            {!rf.length && <p className="empty">No red flags on this job.</p>}
            {hk.length > 0 && <><div className="small" style={{ marginTop: 6 }}><b>Housekeeping not handled yet ({hk.length}):</b></div><ul className="tlist">{hk.map((f) => <li key={f.id}><span className="dot d-house" /><span className="small">{f.text} <b>{f.owner}</b></span></li>)}</ul></>}

            {/* 4. THE FOUR QUESTIONS */}
            <h4>4. The four questions</h4>
            {(j.agenda || []).length ? <div className="small" style={{ margin: '0 0 8px' }}><b>Also cover:</b> {(j.agenda || []).map((p, i) => <label key={i} style={{ display: 'flex', gap: 6, cursor: 'pointer', marginTop: 3 }}><input type="checkbox" checked={!!js.agenda?.[i]} onChange={(e) => touch((s) => { const x = jsOf(s, j.id); x.agenda = x.agenda || {}; x.agenda[i] = e.target.checked; })} /><span>{p}</span></label>)}</div> : null}
            <div className="qbox"><div className="qhead">1. Are we on track for the next gate date?</div>
              <div className="small" style={{ marginBottom: 6 }}>{nextGate > 0 && gateDue(nextGate) ? `Next: Gate ${nextGate + 1} ${j.gates[nextGate].name.replace(/^\d+\.\s*/, '')}, due ${fd(gateDue(nextGate))}${j.markers.find((m) => m.gate === nextGate + 1)?.date || js.markers?.[j.markers.find((m) => m.gate === nextGate + 1)?.id] ? '' : ' (default date)'}${gateDue(nextGate) < today ? ', already past' : ''}.` : 'No next gate date yet. Set a production start or the gate dates.'}</div>
              <div className="seg" style={{ marginBottom: 6 }}>{[['on', 'On track'], ['risk', 'At risk'], ['off', 'Off track']].map(([k, l]) => <button key={k} className={q.q1?.track === k ? 'on' : ''} onClick={() => setQ('q1', 'track', q.q1?.track === k ? '' : k)}>{l}</button>)}</div>
              <NoteBox value={q.q1?.note} placeholder="Why, and what changes the answer" minHeight={46} onSave={(v) => setQ('q1', 'note', v)} />
            </div>
            <div className="qbox"><div className="qhead">2. What is in the way?</div>
              <div className="small" style={{ marginBottom: 6 }}>Add each blocker as a roadblock: it becomes a red Roadblock task in 🔵 ACTIVE and stays on this card until it is cleared.</div>
              {roadblocksNew.map(itemRow)}
              <NewItem members={members} kind="roadblock" label="Roadblock: what is in the way" onAdd={(it) => touch((s) => { jsOf(s, j.id).items.push(it); })} />
              <div style={{ marginTop: 6 }}><NoteBox value={q.q2?.note} placeholder="Notes" minHeight={40} onSave={(v) => setQ('q2', 'note', v)} /></div>
            </div>
            <div className="qbox"><div className="qhead">3. What has to be decided, ordered or ready in the next 3 weeks?</div>
              {soon.length ? <ul className="tlist" style={{ marginBottom: 6 }}>{soon.map((x, i) => <li key={i}><span className={`dot ${x.late ? 'd-amber' : 'd-house'}`} /><span className="small"><b>{fd(x.d, true)}</b> · {x.t}{x.late ? ' · late' : ''}</span></li>)}</ul> : <div className="small" style={{ marginBottom: 6 }}>Nothing on this job's schedule in the next 3 weeks.</div>}
              <NoteBox value={q.q3?.note} placeholder="What has to be decided, ordered or ready, and anything missing from the list above" minHeight={46} onSave={(v) => setQ('q3', 'note', v)} />
            </div>
            <div className="qbox"><div className="qhead">4. Who owes what, by when?</div>
              <div className="small" style={{ marginBottom: 6 }}>Each commitment becomes its own task in 🔵 ACTIVE after Confirm, assigned to that person.</div>
              {commitments.map(itemRow)}
              <NewItem members={members} kind="commitment" label="Commitment: what will be done" onAdd={(it) => touch((s) => { jsOf(s, j.id).items.push(it); })} />
            </div>

            {/* 5. OTHER NOTES */}
            <h4>5. Other notes and decisions</h4>
            <NoteBox value={js.notes} placeholder={`Anything else decided about ${j.short}. All answers above and these notes go into one internal daily log on the job.`} onSave={(v) => touch((s) => { jsOf(s, j.id).notes = v; })} />

            {/* 6. UPDATE GATES AND DATES */}
            <h4>6. Update the gate checklist and gate dates</h4>
            {j.gates.length ? <>
              <select value={gv} onChange={(e) => touch((s) => { jsOf(s, j.id).gateView = Number(e.target.value); })} style={{ marginBottom: 6 }}>{j.gates.map((g, i) => <option key={g.id} value={i}>{g.name} ({gateDoneLive(js, j, i)}/{g.items.length}){i === c ? ' · current' : ''}</option>)}</select>
              {j.gates[gv].items.map((it, i) => { const v = tickVal(js, j, gv, i); const ch = v !== !!it[1]; return <div key={i} style={{ padding: '3px 0' }}><label style={{ display: 'flex', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={v} onChange={(e) => touch((s) => { jsOf(s, j.id).ticks[`${gv}_${i}`] = e.target.checked; })} /><span>{it[0]}{ch ? <span className="tag t-blue" style={{ marginLeft: 6 }}>queued</span> : null}</span></label></div>; })}
            </> : null}
            {j.markers.length ? <>
              <div className="small" style={{ margin: '10px 0 6px' }}>{dfl ? <>Gate dates. Defaults are counted back from {fd(j.start)}. <button className="btn sm" onClick={() => touch((s) => { const x = jsOf(s, j.id); j.markers.forEach((m, i) => { x.markers[m.id] = dfl[i]; }); })}>Fill all with defaults</button></> : 'Gate dates. No start date yet, so no defaults.'}</div>
              <div className="mk">{j.markers.map((m, i) => { const val = js.markers?.[m.id] ?? m.date ?? ''; const past = dfl && dfl[i] < today; return [
                <div key={m.id + 'l'} className="lab">{m.name.split(' (')[0]}</div>,
                <input key={m.id + 'i'} type="date" value={val || ''} onChange={(e) => touch((s) => { jsOf(s, j.id).markers[m.id] = e.target.value; })} />,
                <div key={m.id + 'd'} className="small" style={{ color: past ? C.red : C.muted }}>{dfl ? fd(dfl[i]) : ''}</div>]; })}</div>
            </> : null}

            {/* 7. STATUS */}
            <h4>7. Keep it active, or put it on hold?</h4>
            {holdOpen ? <HoldForm initialDate={addDays(meetingDate, 28)} onCancel={() => setHoldFormFor(null)} onSave={async (d, r) => { await setHold(j, true, d, r); setHoldFormFor(null); setOpen(null); }} />
              : <div className="row"><button className="btn sm" onClick={() => setHoldFormFor(j.id)}>Put on hold...</button><span className="small">Set a wake-up date and the reason. The job moves to the On-hold list until then, and the hold is noted in its daily log on Confirm.</span></div>}
            <div className="nav"><span />{pos < list.length - 1 ? <button className="btn" onClick={() => setOpen(list[pos + 1].id)}>Next job: {list[pos + 1].short}</button> : <button className="btn" onClick={() => { setStep(2); setOpen(null); window.scrollTo(0, 0); }}>Done with jobs</button>}</div>
          </div>
        )}
      </div>
    );
  }

  /* ================================================================ MEETING */
  function Meet() {
    const list = jobs.filter((j) => !isHeld(j.id));
    return (
      <div>
        <div className="note" style={{ marginTop: 14 }}><b>Last week we said we would change:</b> {last?.delta ? last.delta : <span className="empty">{last ? 'No delta was written last week.' : 'Nothing yet. This is the first meeting. From next week, the delta typed in Close shows here.'}</span>}</div>
        <div className="steps">{STEPS.map((s, i) => <button key={s} className={step === i + 1 ? 'on' : ''} onClick={() => { setStep(i + 1); window.scrollTo(0, 0); }}>{i + 1}. {s}</button>)}</div>
        {step === 1 && <div>
          <h2>1. Job by job</h2>
          <p className="lead">Active design jobs, soonest start first. Open one at a time. Each card runs top to bottom: where the job stands, since last meeting, roadblocks and red flags, talking points, then notes and new tasks. Everything waits for the review screen.</p>
          {list.map((j, pos) => <div key={j.id}>{JobCard({ j, pos, list })}</div>)}
        </div>}
        {step === 2 && OnHold()}
        {step === 3 && LookAhead()}
        {step === 4 && Close()}
        <div className="nav">
          <button className="btn" disabled={step === 1} onClick={() => { setStep(step - 1); window.scrollTo(0, 0); }}>Back</button>
          {step < 4 ? <button className="btn pri" onClick={() => { setStep(step + 1); window.scrollTo(0, 0); }}>Next: {STEPS[step]}</button> : <button className="btn pri" onClick={() => { setView('review'); window.scrollTo(0, 0); }}>Close meeting and review changes</button>}
        </div>
      </div>
    );
  }

  function OnHold() {
    const held = jobs.filter((j) => holdOf(j.id));
    const quiet = jobs.filter((j) => !holdOf(j.id) && (j.flags || []).some((f) => f.kind === 'Quiet job'));
    return (
      <div>
        <h2>2. On-hold jobs</h2>
        <p className="lead">Jobs paused by the client or by us, with the wake-up date and the reason. When the wake-up date arrives, the job comes back into Job by job by itself. Use Edit to change the date or reason, or Wake up now to bring it back today.</p>
        {held.length ? held.map((j) => <HoldRow key={j.id} job={j} hold={holdOf(j.id)} meetingDate={meetingDate} onSave={(d, r) => setHold(j, true, d, r)} onWake={() => setHold(j, false, null, null)} />) : <p className="empty">No jobs on hold.</p>}
        {quiet.length > 0 && <><h4>Candidates (no activity in 14 days)</h4>{quiet.map((j) => <div key={j.id} className="card pad" style={{ marginBottom: 8 }}>
          <div><b>{j.short}</b>: <span className="small">{(j.flags || []).find((f) => f.kind === 'Quiet job')?.text}</span></div>
          {holdFormFor === j.id ? <HoldForm initialDate={addDays(meetingDate, 28)} onCancel={() => setHoldFormFor(null)} onSave={async (d, r) => { await setHold(j, true, d, r); setHoldFormFor(null); }} /> : <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setHoldFormFor(j.id)}>Put on hold...</button>}
        </div>)}</>}
      </div>
    );
  }

  function LookAhead() {
    const end = addDays(meetingDate, 42);
    const ev = [];
    for (const j of jobs) {
      if (isHeld(j.id)) continue;
      if (j.start && j.start >= meetingDate && j.start <= end) ev.push({ d: j.start, j, t: 'Production start: ' + j.startName, k: 'start' });
      const js = JS(j.id), dfl = defaults(j);
      j.markers.forEach((m, i) => {
        const set = js.markers?.[m.id] || m.date;
        if (set) { if (set >= meetingDate && set <= end) ev.push({ d: set, j, t: m.name.split(' (')[0], k: 'set' }); }
        else if (dfl && dfl[i] >= meetingDate && dfl[i] <= end) ev.push({ d: dfl[i], j, t: m.name.split(' (')[0], k: 'def' });
      });
    }
    ev.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const busy = jobs.filter((j) => j.start && j.end && j.start <= end && j.end >= meetingDate);
    const after = jobs.filter((j) => j.start && j.start > end).slice(0, 3);
    return (
      <div>
        <h2>3. Six-week look ahead</h2>
        <p className="lead">{fd(meetingDate, true)} to {fd(end, true)}. Starts and planning markers across all jobs. Markers not set yet show their default date, marked <span className="tag t-blue">default</span>.</p>
        <div className="card pad"><ul className="tlist">{ev.length ? ev.map((e, i) => <li key={i}><span className={`dot ${e.k === 'start' ? 'd-red' : e.k === 'set' ? 'd-green' : 'd-house'}`} /><span><b>{fd(e.d, true)}</b> · {e.j.short} · {e.t}{e.k === 'def' ? <span className="tag t-blue" style={{ marginLeft: 6 }}>default</span> : null}</span></li>) : <li className="empty">Nothing in the next 6 weeks.</li>}</ul></div>
        <h4>Josh and Dave</h4>
        <div className="card pad">{busy.length ? busy.map((j) => <div key={j.id}>{j.short} runs {fd(j.start)} to {fd(j.end)} ({j.endName}).</div>) : <div className="empty">No design-phase job has production in the window.</div>}
          {after.length ? <div className="small" style={{ marginTop: 6 }}>Next starts after the window: {after.map((j) => `${j.short} ${fd(j.start)}`).join(', ')}. Check none of them overlaps a job Josh and Dave are still finishing.</div> : null}</div>
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
        <h2>4. Close</h2>
        <p className="lead">Heather reads back every new commitment and roadblock, person by person. Each person says yes or corrects it. Next week each one shows on its job card under Since last meeting. Then one plus and one delta.</p>
        <div className="card pad"><h3>Read back</h3>{lines.length ? Object.entries(byWho).map(([who, arr]) => <div key={who} style={{ marginBottom: 8 }}><b>{who}</b><ul className="tlist">{arr.map(([job, it], i) => <li key={i}><span className={`dot ${it.kind === 'roadblock' ? 'd-red' : 'd-green'}`} /><span>{job} · {it.kind === 'roadblock' ? 'Roadblock: ' : ''}{it.what} · {it.due ? fd(it.due, true) : 'no date'}</span></li>)}</ul></div>) : <p className="empty">No new commitments or roadblocks yet. Add them on the job cards.</p>}</div>
        <div className="row" style={{ marginTop: 12, alignItems: 'stretch' }}>
          <div className="card pad grow"><h3>Plus: what worked</h3><textarea defaultValue={plus} onBlur={(e) => { if (e.target.value !== plus) { dirty.current = true; setPlus(e.target.value); } }} /></div>
          <div className="card pad grow"><h3>Delta: change next time</h3><p className="small" style={{ margin: '0 0 6px' }}>Shows at the top of next week's meeting.</p><textarea defaultValue={delta} onBlur={(e) => { if (e.target.value !== delta) { dirty.current = true; setDelta(e.target.value); } }} /></div>
        </div>
      </div>
    );
  }

  /* ================================================================ REVIEW */
  async function confirm() {
    setConfirming(true); setConfirmMsg(null);
    try {
      // make sure the latest edits are saved first
      await fetch('/api/dashboard/planning-meeting', { method: 'PUT', headers: { Authorization: token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId: meeting.id, state: S, plus, delta, meetingDate }) });
      dirty.current = false;
      const res = await fetch('/api/dashboard/planning-meeting/confirm', { method: 'POST', headers: { Authorization: token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId: meeting.id }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Confirm failed');
      if (j.ok) {
        setConfirmMsg({ ok: true, text: `Written to JobTread: ${j.written} change${j.written === 1 ? '' : 's'}, ${j.created} new task${j.created === 1 ? '' : 's'}. The next meeting is open now. Add the transcript below when the recording is ready.` });
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
        {!changeCount && <p className="empty">Nothing queued yet. Tick an item, set a marker, add a task or type notes on a job card, then come back.</p>}
        {(plus || delta) ? <p className="small">Saved with the meeting in the Hub (not JobTread): {[plus && 'Plus', delta && 'Delta'].filter(Boolean).join(', ')}.</p> : null}
        <div className="row" style={{ marginTop: 8 }}><button className="btn pri" disabled={!changeCount || confirming} onClick={confirm}>{confirming ? 'Writing to JobTread...' : `Confirm and write ${changeCount} change${changeCount === 1 ? '' : 's'} to JobTread`}</button></div>
        {confirmMsg && <div className={`msg ${confirmMsg.ok ? 'ok' : 'err'}`}>{confirmMsg.text}</div>}
        <Transcript last={last} />
      </div>
    );
  }

  function History() {
    const h = data?.history || [];
    return (
      <div>
        <h2>Meeting history</h2>
        {h.length ? <div className="card" style={{ overflowX: 'auto' }}><table><thead><tr><th>Meeting</th><th>Tasks created</th><th>Plus</th><th>Delta</th></tr></thead><tbody>{h.map((m) => <tr key={m.id}><td>{fd(m.meeting_date, true)}</td><td>{m.tasks}</td><td>{m.plus || ''}</td><td>{m.delta || ''}</td></tr>)}</tbody></table></div> : <p className="empty">No confirmed meetings yet.</p>}
      </div>
    );
  }

  /* ================================================================ shell */
  return (
    <div className="pm" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 16px 64px' }}>
      <style>{CSS}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.maroon }}>Planning Meeting</div>
          <div className="small">Meeting date <input type="date" value={meetingDate} onChange={(e) => { dirty.current = true; setMeetingDate(e.target.value); }} style={{ padding: '2px 6px' }} /> · {jobs.length} design jobs · {saveState}</div>
        </div>
        <div className="small"><b style={{ color: C.ink }}>{changeCount}</b> JobTread change{changeCount === 1 ? '' : 's'} queued</div>
      </div>
      {err && <div className="msg err">{err}</div>}
      <div className="tabs">{[['brief', 'Prep Brief'], ['meet', 'Meeting'], ['review', 'Review and transcript'], ['history', 'History'], ['setup', 'Set up a job']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => { setView(k); window.scrollTo(0, 0); }}>{l}</button>)}</div>
      {view === 'brief' && Brief()}
      {view === 'meet' && Meet()}
      {view === 'review' && Review()}
      {view === 'history' && History()}
      {view === 'setup' && <SetupPanel jobs={jobs} />}
    </div>
  );
}
