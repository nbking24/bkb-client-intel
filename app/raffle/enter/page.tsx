// @ts-nocheck
'use client';

/**
 * /raffle/enter — public entry form for the Bucks Beautiful Tour 2026 raffle.
 *
 * Visitors land here from the QR code on the popcorn bag, basket flyer, or
 * paper sign-up sheet. Mobile-first.
 *
 * Field set matches the paper sign-up sheet:
 *   Name, Phone, Email, "May we contact you about a project?" (Y/N),
 *   Project-interest checkboxes (8 options).
 *
 * On submit:
 *   - POST /api/raffle/entry
 *   - If contact_ok=true, redirect to brettkingbuilder.com schedule page
 *   - Otherwise show "You're entered!" thank-you screen
 */

import { useState } from 'react';

const BKB_RED   = '#68050a';
const BKB_GOLD  = '#c88c00';
const BKB_CREAM = '#f8f6f3';
const INK       = '#1C1F22';
const INK_SOFT  = '#5C5043';

const INTERESTS: { id: string; label: string }[] = [
  { id: 'kitchen',     label: 'Kitchen Remodeling' },
  { id: 'bathroom',    label: 'Bathroom Remodeling' },
  { id: 'addition',    label: 'Home Addition' },
  { id: 'interior',    label: 'Interior Remodel' },
  { id: 'exterior',    label: 'Windows & Exteriors' },
  { id: 'landscaping', label: 'Outdoor Living / Hardscape' },
  { id: 'historic',    label: 'Historic Restoration' },
  { id: 'other',       label: 'Something else' },
];

const SCHEDULE_URL =
  'https://www.brettkingbuilder.com/schedule-your-phone-consultation-with-us/';

type Stage = 'form' | 'submitting' | 'success_silent' | 'already_entered' | 'error';

export default function RaffleEnterPage() {
  const [name, setName]         = useState('');
  const [phone, setPhone]       = useState('');
  const [email, setEmail]       = useState('');
  const [contactOk, setContact] = useState<boolean | null>(null);
  const [interests, setInter]   = useState<Set<string>>(new Set());
  const [stage, setStage]       = useState<Stage>('form');
  const [errMsg, setErrMsg]     = useState('');
  const [thankName, setThank]   = useState('');

  function toggleInterest(id: string) {
    const next = new Set(interests);
    if (next.has(id)) next.delete(id); else next.add(id);
    setInter(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg('');

    if (!name.trim()) { setErrMsg('Please enter your name.'); return; }
    if (!email.trim()) {
      setErrMsg('Please enter your email so we can let you know if you win.');
      return;
    }
    if (contactOk === null) {
      setErrMsg('Please let us know whether we may contact you about a project.');
      return;
    }

    setStage('submitting');
    try {
      const res = await fetch('/api/raffle/entry', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:       name.trim(),
          phone:      phone.trim() || null,
          email:      email.trim() || null,
          contact_ok: contactOk === true,
          interests:  Array.from(interests),
        }),
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        setThank(name.trim().split(' ')[0] || '');
        setErrMsg(body?.message || "You're already entered. Good luck!");
        setStage('already_entered');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrMsg(body?.message || body?.error || 'Something went wrong. Please try again.');
        setStage('error');
        return;
      }

      // Success!
      const firstName = name.trim().split(' ')[0] || '';
      setThank(firstName);
      if (contactOk === true) {
        // Hand-off to the consultation scheduler
        window.location.href = SCHEDULE_URL;
        return;
      }
      setStage('success_silent');
    } catch (err: any) {
      setErrMsg(err?.message || 'Network error. Please try again.');
      setStage('error');
    }
  }

  // ----- Render helpers -----------------------------------------------------

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.85rem 1rem',
    fontSize: 16,                       // 16px so iOS does not zoom on focus
    border: `1px solid ${BKB_GOLD}66`,
    borderRadius: 6,
    background: '#fff',
    color: INK,
    fontFamily: 'Georgia, "Times New Roman", serif',
    outlineColor: BKB_RED,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: BKB_RED,
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 600,
    display: 'block',
    marginBottom: 6,
  };

  return (
    <main style={{ background: BKB_CREAM, minHeight: '100vh', padding: '0 0 3rem 0' }}>
      {/* Burgundy hero band */}
      <div
        style={{
          background: BKB_RED,
          color: BKB_CREAM,
          padding: '1.6rem 1.2rem 2rem 1.2rem',
          borderBottom: `3px solid ${BKB_GOLD}`,
          textAlign: 'center',
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.32em',
            color: BKB_GOLD,
            fontFamily: 'system-ui, sans-serif',
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          BUCKS BEAUTIFUL TOUR · 2026
        </div>
        <h1
          style={{
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 30,
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          A Taste of Bucks County
        </h1>
        <div style={{ fontStyle: 'italic', marginTop: 8, fontSize: 14, opacity: 0.9 }}>
          Enter to win a curated basket of local goods.
        </div>
      </div>

      {/* Form */}
      {(stage === 'form' || stage === 'submitting' || stage === 'error') && (
        <form
          onSubmit={submit}
          style={{
            maxWidth: 480,
            margin: '0 auto',
            padding: '1.4rem 1.2rem',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Your name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="name"
              required
              style={fieldStyle}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Phone (optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              autoComplete="tel"
              inputMode="tel"
              placeholder="(215) 555-0123"
              style={fieldStyle}
            />
          </div>

          <div style={{ marginBottom: 22 }}>
            <label style={labelStyle}>Email *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              required
              style={fieldStyle}
            />
            <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 6 }}>
              We need your email so we can let you know if you win.
            </div>
          </div>

          {/* Contact toggle */}
          <div
            style={{
              border: `1px solid ${BKB_GOLD}66`,
              borderRadius: 6,
              padding: '1rem',
              background: '#fff',
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: INK,
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontStyle: 'italic',
                marginBottom: 12,
                lineHeight: 1.4,
              }}
            >
              May we follow up with you about a project at your own home?
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                onClick={() => setContact(true)}
                style={{
                  flex: 1,
                  padding: '0.7rem',
                  borderRadius: 6,
                  border: `1.5px solid ${BKB_RED}`,
                  background: contactOk === true ? BKB_RED : '#fff',
                  color: contactOk === true ? BKB_CREAM : BKB_RED,
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                YES — I'D LIKE THAT
              </button>
              <button
                type="button"
                onClick={() => setContact(false)}
                style={{
                  flex: 1,
                  padding: '0.7rem',
                  borderRadius: 6,
                  border: `1.5px solid ${INK_SOFT}`,
                  background: contactOk === false ? INK_SOFT : '#fff',
                  color: contactOk === false ? '#fff' : INK_SOFT,
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                JUST THE RAFFLE
              </button>
            </div>
            {contactOk === true && (
              <div
                style={{
                  fontSize: 12,
                  color: BKB_RED,
                  marginTop: 10,
                  fontStyle: 'italic',
                  fontFamily: 'Georgia, "Times New Roman", serif',
                }}
              >
                After you submit, we will send you straight to our scheduler so you can pick a time that works for you.
              </div>
            )}
          </div>

          {/* Interests — only relevant if they said yes */}
          {contactOk === true && (
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>What kind of project? (optional)</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {INTERESTS.map(opt => {
                  const on = interests.has(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleInterest(opt.id)}
                      style={{
                        textAlign: 'left',
                        padding: '0.6rem 0.7rem',
                        border: `1px solid ${on ? BKB_RED : BKB_GOLD + '66'}`,
                        borderRadius: 6,
                        background: on ? `${BKB_RED}0d` : '#fff',
                        color: on ? BKB_RED : INK,
                        fontSize: 13,
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        cursor: 'pointer',
                        lineHeight: 1.25,
                      }}
                    >
                      {on ? '✓ ' : ''}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {errMsg && (
            <div
              style={{
                background: '#fbe7e8',
                color: BKB_RED,
                border: `1px solid ${BKB_RED}33`,
                padding: '0.7rem',
                borderRadius: 6,
                fontSize: 13,
                marginBottom: 14,
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              {errMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={stage === 'submitting'}
            style={{
              width: '100%',
              padding: '1rem',
              background: BKB_RED,
              color: BKB_CREAM,
              border: `1.5px solid ${BKB_GOLD}`,
              borderRadius: 6,
              fontSize: 15,
              letterSpacing: '0.18em',
              fontWeight: 600,
              fontFamily: 'system-ui, sans-serif',
              cursor: stage === 'submitting' ? 'wait' : 'pointer',
              opacity: stage === 'submitting' ? 0.7 : 1,
            }}
          >
            {stage === 'submitting' ? 'ENTERING…' : 'ENTER THE RAFFLE'}
          </button>

          <div
            style={{
              fontSize: 11,
              color: INK_SOFT,
              textAlign: 'center',
              marginTop: 16,
              fontFamily: 'system-ui, sans-serif',
              letterSpacing: '0.04em',
            }}
          >
            Drawing at 4:00 PM on Sunday, June 14, 2026. One entry per person.<br />
            Winner notified by phone or email. Your information stays with Brett King Builder.
          </div>
        </form>
      )}

      {/* Thank-you (no contact) */}
      {stage === 'success_silent' && (
        <ThankYou
          firstName={thankName}
          line="You're entered. We'll draw the winner at 4 PM on Sunday and let you know if it's you."
        />
      )}

      {/* Already-entered case */}
      {stage === 'already_entered' && (
        <ThankYou
          firstName={thankName}
          line={errMsg || "You're already entered. Good luck!"}
        />
      )}
    </main>
  );
}

function ThankYou({ firstName, line }: { firstName: string; line: string }) {
  return (
    <div
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '2.4rem 1.4rem',
        textAlign: 'center',
        fontFamily: 'Georgia, "Times New Roman", serif',
        color: '#1C1F22',
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.32em',
          color: BKB_GOLD,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
          marginBottom: 12,
        }}
      >
        BRETT KING BUILDER
      </div>
      <h1
        style={{
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: 32,
          color: BKB_RED,
          marginBottom: 18,
          lineHeight: 1.1,
        }}
      >
        {firstName ? `Thanks, ${firstName}.` : 'Thanks for entering.'}
      </h1>
      <p style={{ fontSize: 16, lineHeight: 1.45, color: '#1C1F22' }}>
        {line}
      </p>
      <div
        style={{
          marginTop: 28,
          fontSize: 12,
          letterSpacing: '0.18em',
          color: '#5C5043',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        BUILDING &amp; RESTORING FINE HOMES SINCE 1982
      </div>
    </div>
  );
}
