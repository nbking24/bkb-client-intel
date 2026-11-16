// @ts-nocheck
'use client';

/**
 * Website contact form: /contact (project.brettkingbuilder.com/contact).
 * Embedded on brettkingbuilder.com/contact-us in an iframe; replaces the Loop form.
 * Posts to /api/public/contact, which makes the JobTread job, emails Terri and
 * emails the client the Informational Call booking link.
 *
 * The page posts its height to the parent window ({type:'bkb-contact-height'})
 * so the website embed can size the iframe without a scrollbar.
 *
 * Style: BKB deck look (Cormorant Garamond + Golos Text). No em or en dashes.
 */
import { useEffect, useRef, useState } from 'react';

const C = {
  ink: '#1F1D1B', cream: '#F5F1EA', sand: '#E9E4DB', line: '#D6CFC2', gold: '#C9A05C',
  ox: '#6E1E1C', mute: '#6F6A62', body: '#4A4640',
};
const SERIF = "'Cormorant Garamond', Georgia, serif";
const SANS = "'Golos Text', Arial, sans-serif";

const TYPES = ['Kitchen', 'Bathroom', 'Basement', 'Addition', 'Whole House', 'Detached Structure', 'Exterior', 'Other'];
const HEARD = ['Referral', 'Repeat Client', 'Google', 'Social Media', 'Event', 'Truck / Sign', 'Website', 'Other'];

const label = { display: 'block', fontFamily: SANS, fontSize: 13, fontWeight: 500, color: C.body, marginBottom: 6, letterSpacing: 0.3 };
const input = {
  width: '100%', boxSizing: 'border-box', fontFamily: SANS, fontSize: 15, color: C.ink, background: '#fff',
  border: `1px solid ${C.line}`, borderRadius: 6, padding: '11px 12px', outline: 'none',
};
const req = <span style={{ color: C.ox }}> *</span>;

export default function ContactPage() {
  const [f, setF] = useState({
    firstName: '', lastName: '', email: '', phone: '', street: '', city: '', state: 'PA', zip: '',
    message: '', heard: '', referredBy: '',
  });
  const [types, setTypes] = useState<string[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [batch, setBatch] = useState('');
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<null | { bookingUrl: string }>(null);
  const hp = useRef('');
  const root = useRef<HTMLDivElement>(null);

  // Tell the parent page how tall we are.
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return;
    const send = () => { try { window.parent?.postMessage({ type: 'bkb-contact-height', height: document.documentElement.scrollHeight }, '*'); } catch {} };
    const ro = new ResizeObserver(send);
    ro.observe(root.current);
    send();
    return () => ro.disconnect();
  }, []);

  const set = (k) => (e) => setF((cur) => ({ ...cur, [k]: e.target.value }));
  const toggle = (t) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  async function addFiles(list: FileList | null) {
    if (!list || !list.length) return;
    const arr = Array.from(list).slice(0, 15 - files.length);
    setUploading((u) => u + arr.length);
    try {
      const r = await fetch('/api/public/questionnaire/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch, files: arr.map((x) => ({ name: x.name, type: x.type, size: x.size })) }),
      });
      const d = await r.json();
      if (d.batch) setBatch(d.batch);
      await Promise.all(arr.map(async (x, i) => {
        const u = d.uploads?.[i];
        if (!u?.signedUrl) { setErr(`Couldn't add ${x.name}${u?.error ? ' (' + u.error + ')' : ''}.`); return; }
        const fd = new FormData();
        fd.append('cacheControl', '3600');
        fd.append('', x);
        const up = await fetch(u.signedUrl, { method: 'PUT', body: fd, headers: { 'x-upsert': 'false' } });
        if (!up.ok) { setErr(`Couldn't upload ${x.name}. Please try again.`); return; }
        setFiles((cur) => [...cur, { path: u.path, name: x.name, type: x.type }]);
      }));
    } catch {
      setErr('Upload failed. Please check your connection and try again.');
    } finally {
      setUploading((u) => Math.max(0, u - arr.length));
    }
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!f.firstName.trim() || !f.lastName.trim()) return setErr('Please enter your first and last name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErr('Please enter a valid email.');
    if (!f.phone.trim()) return setErr('Please enter a phone number.');
    if (!f.message.trim()) return setErr('Please tell us a little about your project.');
    if (uploading) return setErr('Hang on, your files are still uploading.');
    setSending(true);
    try {
      const r = await fetch('/api/public/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, types, files: files.map(({ path, name, type }) => ({ path, name, type })), website: hp.current }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d?.error || 'Something went wrong. Please try again, or call us at 215-536-1145.'); setSending(false); return; }
      setDone({ bookingUrl: d.bookingUrl });
      try { window.parent?.postMessage({ type: 'bkb-contact-submitted' }, '*'); } catch {}
      window.scrollTo(0, 0);
    } catch {
      setErr('Something went wrong. Please try again, or call us at 215-536-1145.');
    }
    setSending(false);
  }

  const wrap = { background: C.cream, minHeight: '100%', padding: '28px 16px 36px', fontFamily: SANS, color: C.ink };
  const card = { maxWidth: 680, margin: '0 auto' };

  if (done) {
    return (
      <div ref={root} style={wrap}>
        <div style={{ ...card, textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontFamily: SERIF, fontSize: 34, lineHeight: 1.15, marginBottom: 12 }}>Thank you, {f.firstName}.</div>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: C.body, maxWidth: 520, margin: '0 auto 22px' }}>
            We received your message. The next step is a short call with Terri in our office, about 20 minutes,
            to hear about your home and what you have in mind. Pick a time that works for you:
          </p>
          <a href={done.bookingUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', background: C.ox, color: C.cream, padding: '14px 26px', borderRadius: 6, textDecoration: 'none', fontWeight: 600, letterSpacing: 1.2, fontSize: 14, textTransform: 'uppercase' }}>
            Schedule a call
          </a>
          <p style={{ fontSize: 14, color: C.mute, marginTop: 20 }}>
            We also emailed you this link. If you would rather we call you, no need to do anything. Terri will reach out.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} style={wrap}>
      <form onSubmit={submit} style={card} noValidate>
        <div style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.15, marginBottom: 6 }}>Tell us about your project</div>
        <p style={{ fontSize: 15, color: C.body, lineHeight: 1.55, margin: '0 0 22px' }}>
          Send us a note and we will be in touch. You will also get a link to schedule a short call with our office.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div><label style={label}>First name{req}</label><input style={input} value={f.firstName} onChange={set('firstName')} autoComplete="given-name" /></div>
          <div><label style={label}>Last name{req}</label><input style={input} value={f.lastName} onChange={set('lastName')} autoComplete="family-name" /></div>
          <div><label style={label}>Email{req}</label><input style={input} type="email" value={f.email} onChange={set('email')} autoComplete="email" /></div>
          <div><label style={label}>Phone{req}</label><input style={input} type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>What kind of project? <span style={{ color: C.mute, fontWeight: 400 }}>(choose any)</span></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TYPES.map((t) => {
              const on = types.includes(t);
              return (
                <button type="button" key={t} onClick={() => toggle(t)}
                  style={{ fontFamily: SANS, fontSize: 14, padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${on ? C.ox : C.line}`, background: on ? C.ox : '#fff', color: on ? C.cream : C.ink }}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <label style={label}>Project address <span style={{ color: C.mute, fontWeight: 400 }}>(optional)</span></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 14 }}>
          <input style={input} placeholder="Street" value={f.street} onChange={set('street')} autoComplete="address-line1" />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <input style={input} placeholder="Town" value={f.city} onChange={set('city')} autoComplete="address-level2" />
            <input style={input} placeholder="State" value={f.state} onChange={set('state')} autoComplete="address-level1" />
            <input style={input} placeholder="Zip" value={f.zip} onChange={set('zip')} autoComplete="postal-code" inputMode="numeric" />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Tell us about your project{req}</label>
          <textarea style={{ ...input, minHeight: 130, resize: 'vertical' }} value={f.message} onChange={set('message')}
            placeholder="What would you like to change, and roughly when are you hoping to start?" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>Photos or plans <span style={{ color: C.mute, fontWeight: 400 }}>(optional)</span></label>
          <label style={{ display: 'inline-block', fontSize: 14, padding: '9px 16px', border: `1px dashed ${C.gold}`, borderRadius: 6, cursor: 'pointer', background: '#fff' }}>
            {uploading ? `Uploading ${uploading}...` : 'Add files'}
            <input type="file" multiple accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          {files.length > 0 && (
            <div style={{ fontSize: 13, color: C.mute, marginTop: 8 }}>
              {files.map((x, i) => (
                <div key={x.path}>
                  {x.name}{' '}
                  <button type="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                    style={{ border: 'none', background: 'none', color: C.ox, cursor: 'pointer', fontSize: 13 }}>remove</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
          <div>
            <label style={label}>How did you hear about us?</label>
            <select style={input} value={f.heard} onChange={set('heard')}>
              <option value="">Choose one</option>
              {HEARD.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          {(f.heard === 'Referral' || f.heard === 'Other') && (
            <div>
              <label style={label}>{f.heard === 'Referral' ? 'Who referred you?' : 'Tell us more'}</label>
              <input style={input} value={f.referredBy} onChange={set('referredBy')} />
            </div>
          )}
        </div>

        {/* honeypot */}
        <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" onChange={(e) => { hp.current = e.target.value; }}
          style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} name="website" />

        {err && <div style={{ color: C.ox, fontSize: 14, marginBottom: 12 }}>{err}</div>}

        <button type="submit" disabled={sending}
          style={{ background: C.ox, color: C.cream, border: 'none', borderRadius: 6, padding: '14px 28px', fontFamily: SANS,
            fontSize: 14, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.7 : 1 }}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
