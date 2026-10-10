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
.pm .msg{margin-top:10px;padding:10px 12px;border-radius:8px;font-size:14px}
.pm .ok{background:${C.greenSoft};color:${C.green}}.pm .err{background:${C.redSoft};color:${C.red}}
@media (max-width:760px){.pm .grid4{grid-template-columns:1fr 1fr}.pm .mk{grid-template-columns:1fr 1fr}.pm .mk .lab{grid-column:1/-1}}
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

function NewItem({ members, onAdd }) {
    const [kind, setKind] = useState('commitment');
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
          <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="commitment">Commitment</option><option value="roadblock">Roadblock</option></select>
          <input type="text" className="grow" placeholder="What" value={what} onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIt(); } }} />
          <select value={whoId} onChange={(e) => setWhoId(e.target.value)}><option value="">Who</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn sm" onClick={addIt}>Add</button>
        </div>
        <textarea style={{ minHeight: 50, marginTop: 6 }} placeholder="Description (optional): the detail someone needs to do it without asking. Saved as the task description." value={details} onChange={(e) => setDetails(e.target.value)} />
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
  const [confirming, setConfirming] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState(null);
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
      for (const it of js.items || []) add(j.id, it.kind === 'roadblock' ? 'Roadblock' : 'Commitment', `New task in 🔵 ACTIVE: ${it.what} · ${it.whoName || 'no owner'} · ${it.due ? 'due ' + fd(it.due) : 'no date'}${it.details ? ' · description: ' + it.details : ''}`);
    }
    for (const [fid, r] of Object.entries(S.rb || {})) {
      if (r?.act === 'rb' && r.what?.trim()) add(fid.split('|')[1], 'Roadblock', `New task in 🔵 ACTIVE: ${r.what} · ${r.whoName || 'no owner'} · ${r.due ? 'due ' + fd(r.due) : 'no date'}${r.details ? ' · description: ' + r.details : ''}`);
    }
    for (const [tid, t] of Object.entries(S.triage || {})) {
      if (!t?.act) continue;
      if (t.act === 'done') add(t.jobId, 'Update', `Tick complete: ${t.name}`);
      if (t.act === 'date' && t.date) add(t.jobId, 'Update', `Move due date to ${fd(t.date)}: ${t.name}${t.why ? ' · reason: ' + t.why : ''}`);
      if (t.act === 'drop') add(t.jobId, 'Update', `Drop: tick complete and add "Dropped at the ${fd(meetingDate)} meeting${t.why ? ': ' + t.why : ''}" to its description. Not deleted: ${t.name}`);
    }
    for (const h of allHoldRows) {
      if (meeting?.created_at && h.set_at && h.set_at >= meeting.created_at && jobs.some((j) => j.id === h.job_id)) add(h.job_id, 'Hub only', h.on_hold ? `On hold${h.next_touch ? ' until ' + fd(h.next_touch) : ''}${h.reason ? ' · ' + h.reason : ''}. Noted in the daily log.` : 'Taken off hold. Noted in the daily log.');
    }
    for (const j of jobs) {
      const js = S.jobs[j.id];
      if (out[j.id] || js?.notes?.trim()) add(j.id, 'Daily log', `One internal daily log dated ${fd(meetingDate)}, "Planning meeting ${fd(meetingDate, true)}", with the notes${js?.notes?.trim() ? ` (${js.notes.trim().split(/\s+/).length} words)` : ''} and the changes above`);
    }
    return out;
  }, [S, jobs, meetingDate, allHoldRows]);
  const changeCount = Object.values(changes).reduce((n, a) => n + a.filter((x) => x.kind !== 'Hub only').length, 0);

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
            <p className="small" style={{ margin: '0 0 6px' }}>No flags for these jobs until their next-touch date, except a start still on the schedule.</p>
            <ul className="tlist">{held.map((j) => { const h = holdOf(j.id); const due = h.next_touch && h.next_touch <= meetingDate; return (
              <li key={j.id}><span className={`dot ${due || j.start ? 'd-red' : 'd-house'}`} /><span><b>{j.short}</b> · on hold until {h.next_touch ? fd(h.next_touch) : 'no date'}{h.reason ? ' · ' + h.reason : ''}{due ? <b> · next-touch date has arrived: it is back in Job by job</b> : null}{j.start ? <b style={{ color: C.red }}> · {j.startName} is still on the schedule for {fd(j.start)}. Move the start or take it off hold.</b> : null}</span></li>); })}</ul>
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
    const hold = holdOf(j.id);
    return (
      <div className="card job">
        <div className="head" onClick={() => setOpen(isOpen ? null : j.id)}>
          <div>
            <div style={{ fontWeight: 700 }}>{j.short} <span className="small" style={{ fontWeight: 400 }}>{j.name}</span></div>
            <div className="small">{j.start ? `${j.startName} ${fd(j.start, true)}` : 'No production dates'} · Gate {c + 1} {j.gates[c]?.name.replace(/^\d+\.\s*/, '')} · {gateDoneLive(js, j, c)} of {j.gates[c]?.items.length || 0}</div>
          </div>
          <div className="row"><GateBar j={j} js={js} />{red ? <span className="tag t-red">{red} red</span> : null}{amb ? <span className="tag t-amber">{amb} amber</span> : null}{j.roadblocks?.length ? <span className="tag t-red">{j.roadblocks.length} roadblock{j.roadblocks.length > 1 ? 's' : ''}</span> : null}<span className="small">{isOpen ? 'Close' : 'Open'}</span></div>
        </div>
        {isOpen && (
          <div className="bd">
            <h4>Where it stands</h4>
            <div style={{ fontSize: 14 }}>{j.start ? <>{j.startName} starts <b>{fd(j.start, true)}</b></> : <b>No start date</b>} · Gate {c + 1} {j.gates[c]?.name.replace(/^\d+\.\s*/, '')} ({gateDoneLive(js, j, c)} of {j.gates[c]?.items.length || 0}) · {j.done} of {j.total} checklist items done · client selections needed: <b>{j.sel?.['1. Client Selection Needed'] || 0}</b>{j.sel?.['2. Internal Selection Needed'] ? <> · internal: <b>{j.sel['2. Internal Selection Needed']}</b></> : null} · last activity {j.lastActivity ? fd(j.lastActivity.date) + ' (' + j.lastActivity.what + ')' : 'none'} · <a href={JT(j.id)} target="_blank" rel="noreferrer">Open in JobTread</a></div>

            <h4>Since last meeting</h4>
            {last ? (
              <>
                {lm?.notes ? <div className="note" style={{ whiteSpace: 'pre-wrap' }}><b>Notes from {fd(last.meeting_date)}:</b> {lm.notes}</div> : <p className="empty" style={{ margin: '0 0 6px' }}>No notes for this job at the {fd(last.meeting_date)} meeting.</p>}
                {j.lastMeeting?.length ? <p className="small" style={{ margin: '0 0 6px' }}>From last meeting: kept {j.lastMeeting.filter((t) => t.status === 'done').length} of {j.lastMeeting.length}. Late ones are marked below.</p> : null}
                {(j.lastMeeting || []).filter((t) => t.status === 'done').map((t) => <div key={t.id} className="small">✓ Done: {t.name} ({t.who || 'no owner'})</div>)}
              </>
            ) : <p className="empty" style={{ margin: '0 0 6px' }}>First meeting, so there are no notes or commitments from last week yet.</p>}
            <div className="small" style={{ margin: '6px 0' }}>Open tasks on this job. Decide each late one: Done, New date, or Drop.</div>
            {j.tasks.length ? <ul className="tlist">{j.tasks.map((t) => { const tr = S.triage[t.id] || {}; return (
              <li key={t.id} style={{ flexWrap: 'wrap' }}>
                <span className={`dot ${t.overdue ? 'd-amber' : t.doneLike ? 'd-house' : 'd-green'}`} />
                <div className="grow">{t.name}{t.fromLast ? <span className="tag t-blue" style={{ marginLeft: 6 }}>from last meeting</span> : null}{t.roadblock ? <span className="tag t-red" style={{ marginLeft: 6 }}>roadblock</span> : null}{t.src !== 'ACTIVE' ? <span className="small"> (not in 🔵 ACTIVE)</span> : null}
                  <div className="small">{t.who.join(', ') || 'no owner'} · {t.due ? 'due ' + fd(t.due) : 'no date'}{t.overdue ? <b style={{ color: C.amber }}> · {t.days} day{t.days === 1 ? '' : 's'} late</b> : null}{t.type ? ' · type ' + t.type : ''}</div></div>
                {(t.overdue || tr.act) && <div className="seg">{[['done', 'Done'], ['date', 'New date'], ['drop', 'Drop']].map(([k, l]) => <button key={k} className={tr.act === k ? 'on' : ''} onClick={() => touch((s) => { s.triage[t.id] = s.triage[t.id]?.act === k ? {} : { ...(s.triage[t.id] || {}), act: k, jobId: j.id, name: t.name }; })}>{l}</button>)}</div>}
                {(tr.act === 'date' || tr.act === 'drop') && <div className="row" style={{ flex: '1 1 100%', margin: '6px 0 0 16px' }}>
                  {tr.act === 'date' && <input type="date" value={tr.date || ''} onChange={(e) => touch((s) => { s.triage[t.id].date = e.target.value; })} />}
                  <select value={tr.why || ''} onChange={(e) => touch((s) => { s.triage[t.id].why = e.target.value; })}><option value="">Why did it slip?</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                </div>}
              </li>); })}</ul> : <p className="empty">No open tasks.</p>}

            <h4>Roadblocks and red flags</h4>
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

            <h4>This week's talking points</h4>
            <ul className="tlist">
              {(j.agenda || []).map((p, i) => <li key={i}><label style={{ display: 'flex', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={!!js.agenda?.[i]} onChange={(e) => touch((s) => { const x = jsOf(s, j.id); x.agenda = x.agenda || {}; x.agenda[i] = e.target.checked; })} /><span>{p}</span></label></li>)}
              <li><span className="small">Then the four questions: on track for the next gate date? What is in the way? What has to be ready in the next 3 weeks? Who owes what, by when?</span></li>
            </ul>

            <h4>Notes and decisions</h4>
            <textarea defaultValue={js.notes || ''} placeholder={`Notes and decisions for ${j.short}. Saved as an internal daily log on the job.`} onBlur={(e) => { if (e.target.value !== (js.notes || '')) touch((s) => { jsOf(s, j.id).notes = e.target.value; }); }} />

            <h4>New commitments and roadblocks</h4>
            <p className="small" style={{ margin: '0 0 6px' }}>Each one becomes its own task in 🔵 ACTIVE after Confirm. A commitment is something one of us will do by a date. A roadblock is something stopping the job from reaching its next gate; it gets the red Roadblock type and stays on this card every week until it is ticked complete.</p>
            {(js.items || []).map((it, i) => <div key={it.uid} className="added"><span><span className="tag t-blue" style={{ marginRight: 6 }}>{it.kind}</span>{it.what} · <b>{it.whoName || 'no owner'}</b> · {it.due ? fd(it.due, true) : 'no date'}{it.details ? <><br /><span className="small" style={{ whiteSpace: 'pre-wrap' }}>{it.details}</span></> : null}</span><button className="x" aria-label="Remove" onClick={() => touch((s) => { jsOf(s, j.id).items.splice(i, 1); })}>×</button></div>)}
            <NewItem members={members} onAdd={(it) => touch((s) => { jsOf(s, j.id).items.push(it); })} />

            <h4>Update the gate checklist</h4>
            {j.gates.length ? <>
              <select value={gv} onChange={(e) => touch((s) => { jsOf(s, j.id).gateView = Number(e.target.value); })} style={{ marginBottom: 6 }}>{j.gates.map((g, i) => <option key={g.id} value={i}>{g.name} ({gateDoneLive(js, j, i)}/{g.items.length}){i === c ? ' · current' : ''}</option>)}</select>
              {j.gates[gv].items.map((it, i) => { const v = tickVal(js, j, gv, i); const ch = v !== !!it[1]; return <div key={i} style={{ padding: '3px 0' }}><label style={{ display: 'flex', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={v} onChange={(e) => touch((s) => { jsOf(s, j.id).ticks[`${gv}_${i}`] = e.target.checked; })} /><span>{it[0]}{ch ? <span className="tag t-blue" style={{ marginLeft: 6 }}>queued</span> : null}</span></label></div>; })}
            </> : <p className="empty">This job has no ✅ PROJECT GATES group.</p>}

            <h4>Planning markers</h4>
            {j.markers.length ? <>
              {dfl ? <p className="small" style={{ margin: '0 0 6px' }}>Defaults are counted back from {fd(j.start)}. <button className="btn sm" onClick={() => touch((s) => { const x = jsOf(s, j.id); j.markers.forEach((m, i) => { x.markers[m.id] = dfl[i]; }); })}>Fill all with defaults</button></p> : <p className="small" style={{ margin: '0 0 6px' }}>No start date yet, so no defaults.</p>}
              <div className="mk">{j.markers.map((m, i) => { const val = js.markers?.[m.id] ?? m.date ?? ''; const past = dfl && dfl[i] < today; return [
                <div key={m.id + 'l'} className="lab">{m.name.split(' (')[0]}</div>,
                <input key={m.id + 'i'} type="date" value={val || ''} onChange={(e) => touch((s) => { jsOf(s, j.id).markers[m.id] = e.target.value; })} />,
                <div key={m.id + 'd'} className="small" style={{ color: past ? C.red : C.muted }}>{dfl ? fd(dfl[i]) : ''}</div>]; })}</div>
            </> : <p className="empty">This job has no 🎨 PLANNING MILESTONES group.</p>}

            <h4>Job status in the meeting</h4>
            <div className="row"><div className="seg">
              <button className={!hold ? 'on' : ''} onClick={() => hold && setHold(j, false, null, null)}>Active</button>
              <button className={hold ? 'on' : ''} onClick={() => !hold && setHold(j, true, addDays(meetingDate, 28), '')}>On hold</button>
            </div>
              {hold ? <><span className="small">Next touch</span><input type="date" value={hold.next_touch || ''} onChange={(e) => setHold(j, true, e.target.value, hold.reason)} /><input type="text" className="grow" placeholder="Why it is on hold" defaultValue={hold.reason || ''} onBlur={(e) => setHold(j, true, hold.next_touch, e.target.value)} /></> : <span className="small">On hold moves the job to the On-hold list until its next-touch date. Kept in the Hub; the change is noted in the job's daily log on Confirm.</span>}
            </div>
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
        <p className="lead">Jobs paused by the client or by us. Each has a next-touch date. When the date arrives, the job comes back into Job by job by itself.</p>
        {held.length ? held.map((j) => { const h = holdOf(j.id); return (
          <div key={j.id} className="card pad" style={{ marginBottom: 8 }}><div className="row">
            <b>{j.short}</b>
            <span className="small">Next touch</span><input type="date" value={h.next_touch || ''} onChange={(e) => setHold(j, true, e.target.value, h.reason)} />
            <input type="text" className="grow" placeholder="Why it is on hold" defaultValue={h.reason || ''} onBlur={(e) => setHold(j, true, h.next_touch, e.target.value)} />
            <button className="btn sm" onClick={() => setHold(j, false, null, null)}>Wake up</button>
          </div>{j.start ? <div className="small" style={{ color: C.red, marginTop: 4 }}>{j.startName} is still on the schedule for {fd(j.start)}. Move the start or take it off hold.</div> : null}</div>); }) : <p className="empty">No jobs on hold.</p>}
        {quiet.length > 0 && <><h4>Candidates</h4>{quiet.map((j) => <div key={j.id} className="card pad" style={{ marginBottom: 8 }}><div className="row"><span className="grow"><b>{j.short}</b>: {(j.flags || []).find((f) => f.kind === 'Quiet job')?.text}</span><button className="btn sm" onClick={() => setHold(j, true, addDays(meetingDate, 28), '')}>Put on hold</button></div></div>)}</>}
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
      <div className="tabs">{[['brief', 'Prep Brief'], ['meet', 'Meeting'], ['review', 'Review and transcript'], ['history', 'History']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => { setView(k); window.scrollTo(0, 0); }}>{l}</button>)}</div>
      {view === 'brief' && Brief()}
      {view === 'meet' && Meet()}
      {view === 'review' && Review()}
      {view === 'history' && History()}
    </div>
  );
}
