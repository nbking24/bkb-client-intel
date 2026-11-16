// @ts-nocheck
'use client';

/**
 * Public Project Questionnaire: /start (project.brettkingbuilder.com/start)
 *
 * One link for every client. Name, email and phone are prefilled from the URL
 * (Calendly's "pass event details to redirected page" sends invitee_full_name,
 * invitee_email and question answers). One question per screen, branched by
 * project type. Photos upload straight to Supabase Storage via signed URLs.
 * On submit the server matches the email to the JobTread job and writes a
 * daily log (app/lib/questionnaire.ts).
 *
 * Style: BKB deck look (Cormorant Garamond + Golos Text). No em or en dashes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PROJECT_TYPES, PORTFOLIO, INVESTMENT_LINK, CORE_BEFORE, CORE_AFTER, LAST_TEXT, typeQuestionsFor,
} from '@/app/lib/questionnaire-config';

const C = {
  ink: '#1F1D1B', cream: '#F5F1EA', sand: '#E9E4DB', line: '#D6CFC2', gold: '#C9A05C',
  ox: '#6E1E1C', mute: '#6F6A62', body: '#4A4640',
};
const SERIF = "'Cormorant Garamond', Georgia, serif";
const SANS = "'Golos Text', Arial, sans-serif";

const STEPS = ['Introductory Call', 'Project Questionnaire', 'Initial Consultation', 'Design Agreement'];

function looksLikePhone(s) { return /^[+()\d\s.-]{7,}$/.test(String(s || '').trim()); }

export default function StartPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [source, setSource] = useState('');
  const [returning, setReturning] = useState(false);
  const [types, setTypes] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState(0);
  const [batch, setBatch] = useState('');
  const [idx, setIdx] = useState(-1); // -1 intro, then screens, then done
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const hp = useRef('');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const n = p.get('invitee_full_name') || p.get('name') || [p.get('invitee_first_name'), p.get('invitee_last_name')].filter(Boolean).join(' ');
    const e = p.get('invitee_email') || p.get('email') || '';
    let ph = p.get('phone') || p.get('text_reminder_number') || '';
    if (!ph) for (let i = 1; i <= 5; i++) { const a = p.get('answer_' + i); if (looksLikePhone(a)) { ph = a; break; } }
    if (n) setName(n);
    if (e) setEmail(e);
    if (ph) setPhone(ph);
    setPrefilled(!!(n && e));
    setSource(p.get('event_type_name') || p.get('src') || (n && e ? 'calendly' : 'link'));
  }, []);

  useEffect(() => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setReturning(false); return; }
    const t = setTimeout(() => {
      fetch('/api/public/questionnaire?email=' + encodeURIComponent(email)).then((r) => r.json()).then((d) => setReturning(!!d?.submitted)).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [email]);

  const screens = useMemo(() => {
    const s: any[] = [{ kind: 'types' }];
    CORE_BEFORE.forEach((q) => s.push({ kind: 'q', q }));
    typeQuestionsFor(types).forEach((q) => s.push({ kind: 'q', q }));
    CORE_AFTER.forEach((q) => s.push({ kind: 'q', q }));
    s.push({ kind: 'photos' });
    s.push({ kind: 'q', q: LAST_TEXT });
    return s;
  }, [types]);

  const set = (id, v) => setAnswers((a) => ({ ...a, [id]: v }));
  const toggle = (id, opt) => setAnswers((a) => {
    const cur = Array.isArray(a[id]) ? a[id] : [];
    return { ...a, [id]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
  });

  function next() {
    setErr('');
    if (idx === -1) {
      if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('Please enter your name and email.'); return; }
    }
    const sc = screens[idx];
    if (sc?.kind === 'types' && !types.length) { setErr('Pick at least one.'); return; }
    if (sc?.kind === 'q' && sc.q.required && !String(answers[sc.q.id] || '').trim()) { setErr('This one helps us most. A sentence or two is plenty.'); return; }
    if (idx >= screens.length - 1) { submit(); return; }
    setIdx(idx + 1);
    window.scrollTo(0, 0);
  }
  function back() { setErr(''); setIdx(Math.max(-1, idx - 1)); window.scrollTo(0, 0); }

  async function addFiles(list: FileList | null) {
    if (!list || !list.length) return;
    const arr = Array.from(list).slice(0, 15 - files.length);
    setUploading((u) => u + arr.length);
    try {
      const r = await fetch('/api/public/questionnaire/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch, files: arr.map((f) => ({ name: f.name, type: f.type, size: f.size })) }),
      });
      const d = await r.json();
      if (d.batch) setBatch(d.batch);
      await Promise.all(arr.map(async (f, i) => {
        const u = d.uploads?.[i];
        if (!u?.signedUrl) { setErr(`Couldn't add ${f.name}${u?.error ? ' (' + u.error + ')' : ''}.`); return; }
        const fd = new FormData();
        fd.append('cacheControl', '3600');
        fd.append('', f);
        const up = await fetch(u.signedUrl, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false' } });
        if (!up.ok) { setErr(`Couldn't upload ${f.name}. Please try again.`); return; }
        setFiles((cur) => [...cur, { path: u.path, name: f.name, type: f.type, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : '' }]);
      }));
    } catch {
      setErr('Upload failed. Please check your connection and try again.');
    } finally {
      setUploading((u) => Math.max(0, u - arr.length));
    }
  }

  async function submit() {
    if (uploading) { setErr('Hang on, your photos are still uploading.'); return; }
    setSending(true); setErr('');
    try {
      const r = await fetch('/api/public/questionnaire', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, projectTypes: types, answers, files: files.map(({ path, name, type }) => ({ path, name, type })), source, website: hp.current }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d?.error || 'Something went wrong. Please try again.'); setSending(false); return; }
      setDone(true); window.scrollTo(0, 0);
    } catch {
      setErr('Something went wrong. Please try again.');
    }
    setSending(false);
  }

  const total = screens.length;
  const pct = done ? 100 : idx < 0 ? 0 : Math.round(((idx + 1) / total) * 100);
  const first = (name || '').trim().split(/\s+/)[0];

  return (
    <div style={{ minHeight: '100vh', background: C.cream, color: C.ink, fontFamily: SANS }}>
      <header style={{ background: C.ink, color: C.cream, textAlign: 'center', padding: '22px 16px 18px', borderBottom: `3px solid ${C.gold}` }}>
        <div style={{ fontFamily: SERIF, fontSize: 20, letterSpacing: 7 }}>BRETT KING</div>
        <div style={{ fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#CFC8BC', marginTop: 4 }}>Builder-Contractor</div>
      </header>

      <main style={{ maxWidth: 560, margin: '0 auto', padding: '24px 20px 48px' }}>
        {!done && idx >= 0 && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: C.mute }}>
              <span>Question {idx + 1} of {total}</span><span>{pct}%</span>
            </div>
            <div style={{ height: 4, background: C.line, borderRadius: 2, marginTop: 6 }}><div style={{ height: 4, width: pct + '%', background: C.ox, borderRadius: 2, transition: 'width .3s' }} /></div>
          </div>
        )}

        {done ? (
          <Thanks first={first} types={types} showAll={showAll} setShowAll={setShowAll} />
        ) : idx === -1 ? (
          <section>
            <h1 style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 38, lineHeight: 1.1, margin: 0 }}>Tell us about your project</h1>
            <div style={{ width: 56, borderTop: `1.5px solid ${C.gold}`, margin: '14px 0' }} />
            <p style={{ fontSize: 15, lineHeight: 1.55, color: C.body, margin: 0 }}>
              This takes about 5 minutes and helps us make the most of our time together. Answer what you can. Anything you skip, we'll cover when we meet.
            </p>
            <Process step={2} showAll={showAll} setShowAll={setShowAll} />
            {returning && (
              <div style={{ background: '#F1E7D6', borderLeft: `3px solid ${C.gold}`, padding: '12px 14px', fontSize: 14, lineHeight: 1.5, marginBottom: 16, color: C.body }}>
                We already have your answers, thank you. Anything you add here will be added to them.
              </div>
            )}
            {prefilled ? (
              <p style={{ fontSize: 14, color: C.mute, margin: '0 0 18px' }}>Filling this out as <b style={{ color: C.ink }}>{name}</b> ({email}). <a href="#" onClick={(e) => { e.preventDefault(); setPrefilled(false); }} style={{ color: C.ox }}>Not you?</a></p>
            ) : (
              <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
                <Field label="Your name" value={name} onChange={setName} autoComplete="name" />
                <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" />
                <Field label="Phone (optional)" value={phone} onChange={setPhone} type="tel" autoComplete="tel" />
              </div>
            )}
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" onChange={(e) => (hp.current = e.target.value)} style={{ position: 'absolute', left: -9999, width: 1, height: 1 }} name="website" />
            {err && <Err>{err}</Err>}
            <Btn onClick={next}>Start</Btn>
            <p style={{ textAlign: 'center', fontSize: 12, color: C.mute, marginTop: 10 }}>Most questions are optional</p>
          </section>
        ) : (
          <section>
            <Screen sc={screens[idx]} answers={answers} set={set} toggle={toggle} types={types} setTypes={setTypes}
              files={files} setFiles={setFiles} addFiles={addFiles} uploading={uploading} />
            {err && <Err>{err}</Err>}
            <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
              <button onClick={back} style={{ flex: '0 0 auto', background: 'transparent', border: `1px solid ${C.line}`, color: C.body, padding: '14px 18px', borderRadius: 8, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: SANS, cursor: 'pointer' }}>Back</button>
              <div style={{ flex: 1 }}><Btn onClick={next} disabled={sending}>{sending ? 'Sending...' : idx === total - 1 ? 'Submit' : 'Next'}</Btn></div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Screen({ sc, answers, set, toggle, types, setTypes, files, setFiles, addFiles, uploading }) {
  if (sc.kind === 'types') {
    return (
      <>
        <H>What kind of project is this?</H>
        <Help>Pick everything that applies.</Help>
        <Options options={PROJECT_TYPES.map((t) => t.label)} selected={types.map((t) => PROJECT_TYPES.find((p) => p.id === t)?.label)}
          onToggle={(label) => { const id = PROJECT_TYPES.find((p) => p.label === label).id; setTypes((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])); }} />
      </>
    );
  }
  if (sc.kind === 'photos') {
    return (
      <>
        <H>Add photos of the space today, and any inspiration pictures or plans</H>
        <Help>Phone photos are perfect. This step is optional.</Help>
        <label style={{ display: 'block', border: `1.5px dashed ${C.gold}`, borderRadius: 10, padding: '26px 16px', textAlign: 'center', background: C.sand, cursor: 'pointer', fontSize: 14, color: C.body }}>
          <input type="file" multiple accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 22, color: C.ink }}>Tap to add photos or files</div>
          <div style={{ marginTop: 4 }}>Up to 15 files</div>
        </label>
        {uploading > 0 && <p style={{ fontSize: 13, color: C.mute }}>Uploading {uploading}...</p>}
        {files.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
            {files.map((f, i) => (
              <div key={f.path} style={{ position: 'relative', background: C.sand, borderRadius: 8, overflow: 'hidden', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.mute, padding: f.preview ? 0 : 6, textAlign: 'center' }}>
                {f.preview ? <img src={f.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : f.name}
                <button onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label="Remove" style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, border: 0, background: 'rgba(31,29,27,.7)', color: '#fff', fontSize: 13, cursor: 'pointer' }}>x</button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }
  const q = sc.q;
  return (
    <>
      <H>{q.label}{q.required ? '' : ''}</H>
      {q.help && <Help>{q.help}</Help>}
      {q.id === 'investment' && (
        <p style={{ fontSize: 13.5, color: C.body, margin: '-6px 0 14px' }}>
          Want to know what drives the cost of a remodel? <a href={INVESTMENT_LINK} target="_blank" rel="noreferrer" style={{ color: C.ox }}>Understanding your remodeling investment</a>
        </p>
      )}
      {q.twoBox ? (
        <div style={{ display: 'grid', gap: 14 }}>
          {q.twoBox.map((b) => <Area key={b.id} label={b.label} value={answers[b.id] || ''} onChange={(v) => set(b.id, v)} />)}
        </div>
      ) : q.type === 'text' ? (
        <Area value={answers[q.id] || ''} onChange={(v) => set(q.id, v)} />
      ) : q.type === 'pick' ? (
        <Options single options={q.options} selected={[answers[q.id]]} onToggle={(o) => set(q.id, answers[q.id] === o ? '' : o)} />
      ) : (
        <Options options={[...q.options, ...(q.other ? ['Something else'] : [])]} selected={answers[q.id] || []} onToggle={(o) => toggle(q.id, o)} />
      )}
      {q.other && (answers[q.id] || []).includes('Something else') && (
        <div style={{ marginTop: 12 }}><Field label="Tell us more" value={answers[q.id + '_other'] || ''} onChange={(v) => set(q.id + '_other', v)} /></div>
      )}
      {q.followUp && (
        <div style={{ marginTop: 14 }}><Field label={q.followUp.label + ' (optional)'} value={answers[q.followUp.id] || ''} onChange={(v) => set(q.followUp.id, v)} /></div>
      )}
    </>
  );
}

function Process({ step, showAll, setShowAll, doneThrough }) {
  const through = doneThrough ?? step - 1;
  return (
    <div style={{ background: C.sand, borderRadius: 10, padding: '14px 14px 10px', margin: '20px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 20 }}>Where you are</span>
        <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: C.ox, fontWeight: 600 }}>Step {Math.min(step, 13)} of 13</span>
      </div>
      <div style={{ height: 4, background: C.line, borderRadius: 2, marginBottom: 8 }}><div style={{ height: 4, width: (through / 13) * 100 + '%', background: C.ox, borderRadius: 2 }} /></div>
      {STEPS.map((s, i) => {
        const n = i + 1; const isDone = n <= through; const isNow = n === step;
        return (
          <div key={s} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: i ? `1px solid ${C.line}` : 0, fontSize: 14, color: isDone ? C.mute : isNow ? C.ink : '#8A8278', fontWeight: isNow ? 600 : 400 }}>
            <span style={{ width: 22, height: 22, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flex: 'none', background: isDone ? C.gold : isNow ? C.ox : 'transparent', color: isDone || isNow ? '#fff' : '#8A8278', border: isDone || isNow ? 0 : '1.5px solid #B8AFA1' }}>{isDone ? '✓' : n}</span>
            {s}{isNow ? ' · now' : ''}
          </div>
        );
      })}
      {showAll ? (
        <div style={{ fontSize: 12.5, color: C.body, lineHeight: 1.6, paddingTop: 6 }}>
          <b>Design:</b> 5 Existing Conditions, 6 Concept Design, 7 Plans and Pricing<br />
          <b>Selections and Pre-Construction:</b> 8 Selections, 9 Construction Contract, 10 Permits and Schedule<br />
          <b>Construction:</b> 11 Construction, 12 Final Walkthrough<br />
          <b>Warranty and Follow-Up:</b> 13 Two-Year Guarantee
        </div>
      ) : (
        <button onClick={() => setShowAll(true)} style={{ background: 'none', border: 0, padding: '6px 0 2px', fontSize: 12, color: C.mute, cursor: 'pointer', fontFamily: SANS, textAlign: 'left' }}>
          Then Design, Selections and Pre-Construction, Construction, and Warranty. See all 13 steps &rsaquo;
        </button>
      )}
    </div>
  );
}

function Thanks({ first, types, showAll, setShowAll }) {
  const links = (types.length ? types : ['other']).map((t) => PORTFOLIO[t]).filter(Boolean);
  return (
    <section>
      <h1 style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 38, lineHeight: 1.1, margin: 0 }}>Thank you{first ? ', ' + first : ''}.</h1>
      <div style={{ width: 56, borderTop: `1.5px solid ${C.gold}`, margin: '14px 0' }} />
      <p style={{ fontSize: 15, lineHeight: 1.55, color: C.body, margin: 0 }}>
        Nathan will read this before your meeting. If anything else comes to mind, just reply to your confirmation email.
      </p>
      <Process step={3} doneThrough={2} showAll={showAll} setShowAll={setShowAll} />
      <h2 style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 26, margin: '8px 0 6px' }}>Looking for ideas?</h2>
      <p style={{ fontSize: 14, color: C.body, margin: '0 0 14px' }}>Here are a few of our completed projects like yours.</p>
      <div style={{ display: 'grid', gap: 10 }}>
        {links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', background: C.ink, color: C.cream, padding: '14px', borderRadius: 8, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600, textDecoration: 'none' }}>{l.label}</a>
        ))}
      </div>
      <p style={{ textAlign: 'center', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: C.mute, marginTop: 30 }}>Building upon a solid foundation</p>
    </section>
  );
}

function H({ children }) {
  return <h2 style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 30, lineHeight: 1.15, margin: '0 0 10px' }}>{children}</h2>;
}
function Help({ children }) {
  return <p style={{ fontSize: 14, lineHeight: 1.5, color: C.mute, margin: '0 0 16px' }}>{children}</p>;
}
function Err({ children }) {
  return <p style={{ color: C.ox, fontSize: 14, margin: '12px 0' }}>{children}</p>;
}
function Btn({ children, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ display: 'block', width: '100%', background: C.ox, color: C.cream, border: 0, padding: '15px', borderRadius: 8, fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600, fontFamily: SANS, cursor: 'pointer', opacity: disabled ? 0.6 : 1 }}>{children}</button>;
}
function Field({ label, value, onChange, type = 'text', autoComplete }) {
  return (
    <label style={{ display: 'block', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: C.mute }}>
      {label}
      <input type={type} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)}
        style={{ display: 'block', width: '100%', marginTop: 6, padding: '12px', fontSize: 16, fontFamily: SANS, border: `1px solid ${C.line}`, borderRadius: 8, background: '#fff', color: C.ink, boxSizing: 'border-box' }} />
    </label>
  );
}
function Area({ label, value, onChange }) {
  return (
    <label style={{ display: 'block', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: C.mute }}>
      {label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={5}
        style={{ display: 'block', width: '100%', marginTop: label ? 6 : 0, padding: '12px', fontSize: 16, lineHeight: 1.45, fontFamily: SANS, border: `1px solid ${C.line}`, borderRadius: 8, background: '#fff', color: C.ink, boxSizing: 'border-box', resize: 'vertical' }} />
    </label>
  );
}
function Options({ options, selected, onToggle, single }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {options.map((o) => {
        const on = (selected || []).includes(o);
        return (
          <button key={o} onClick={() => onToggle(o)} style={{ textAlign: 'left', padding: '13px 14px', borderRadius: 8, fontSize: 15, fontFamily: SANS, cursor: 'pointer', border: `1.5px solid ${on ? C.ox : C.line}`, background: on ? '#F3E6E2' : '#fff', color: C.ink, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 18, height: 18, flex: 'none', borderRadius: single ? 9 : 4, border: `1.5px solid ${on ? C.ox : '#B8AFA1'}`, background: on ? C.ox : 'transparent', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>
            {o}
          </button>
        );
      })}
    </div>
  );
}
