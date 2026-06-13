// @ts-nocheck
'use client';

/**
 * /raffle/wheel — TV display for the Bucks Beautiful Tour raffle.
 *
 * Designed for full-screen casting to a TV.  Header shows the BKB logo +
 * "A Taste of Bucks County" title, the wheel takes center stage, and two
 * QR codes (Our Website + Contact Us) sit in the top corners so visitors
 * can scan them from across the room.
 *
 * Realtime subscription to Supabase means names appear on the wheel as
 * visitors submit the entry form.  At 4 PM on 6/14, an authed owner sees
 * a "SPIN THE WHEEL" button that animates to a random winner.
 *
 * Color palette matches the BKB heraldic logo (sampled from print pieces).
 */

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '../../lib/supabase';

// ----- BKB brand palette (sampled from the actual logo) ---------------------
const BKB_RED    = '#7A2629';   // deep burgundy — crest body
const BKB_RED_DK = '#5C171A';   // darker burgundy for shadow edges
const BKB_GOLD   = '#C08020';   // rich gold — crown body
const BKB_GOLD_LT= '#D9A855';   // lighter gold for alternating segments
const BKB_CREAM  = '#FBF6EB';   // paper cream — page bg + cream type
const INK        = '#1C1F22';

// 2026-06-14 16:00 ET == 20:00 UTC (EDT)
const DRAW_AT_MS = Date.parse('2026-06-14T20:00:00Z');

type Entry = { id: string; name: string; is_winner: boolean };

export default function WheelPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [winner, setWinner]   = useState<Entry | null>(null);
  const [now, setNow]         = useState<number>(Date.now());
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [showOverlay, setOverlay] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authedAdmin, setAuthedAdmin] = useState(false);
  const [errMsg, setErr] = useState('');

  // -- 1. initial load + realtime subscription -----------------------------
  useEffect(() => {
    let mounted = true;
    const supabase = createBrowserClient();
    async function load() {
      const res = await fetch('/api/raffle/entries', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      if (!mounted) return;
      setEntries(body.entries || []);
      if (body.winner) {
        setWinner({ id: body.winner.id, name: body.winner.name, is_winner: true });
        setOverlay(true);
      }
    }
    load();
    const channel = supabase
      .channel('raffle_entries_live')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'raffle_entries' },
          () => { load(); })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, []);

  // -- 2. tick clock --------------------------------------------------------
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // -- 3. read admin auth ---------------------------------------------------
  useEffect(() => {
    try {
      const token = localStorage.getItem('bkb-token');
      const role  = localStorage.getItem('bkb-role');
      setAuthToken(token);
      const sp = new URLSearchParams(window.location.search);
      const queryControl = sp.get('control') === 'owner';
      setAuthedAdmin(!!token && (role === 'owner' || queryControl));
    } catch {}
  }, []);

  // -- 4. animate when a winner is set -------------------------------------
  useEffect(() => {
    if (!winner) return;
    if (rotation === 0 && entries.length > 0) {
      const idx = entries.findIndex(e => e.id === winner.id);
      if (idx >= 0) {
        const seg = 360 / entries.length;
        const target = -(idx * seg + seg / 2);
        const finalRot = target - 360 * 6;
        setSpinning(true);
        setRotation(finalRot);
        setTimeout(() => setOverlay(true), 8500);
      } else {
        setOverlay(true);
      }
    }
  }, [winner, entries]);

  // -- 5. SPIN handler -----------------------------------------------------
  async function handleSpin() {
    if (spinning) return;
    if (entries.length === 0) { setErr('No entries to spin.'); return; }
    if (winner) { setErr('Winner already drawn.'); return; }
    setErr('');
    setSpinning(true);
    try {
      const res = await fetch('/api/raffle/draw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken || ''}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body?.error || 'Draw failed');
        setSpinning(false);
        return;
      }
      const body = await res.json();
      const w = body.winner;
      const idx = entries.findIndex(e => e.id === w.id);
      if (idx < 0) {
        setWinner({ id: w.id, name: w.name, is_winner: true });
        setOverlay(true);
        setSpinning(false);
        return;
      }
      const seg = 360 / entries.length;
      const target = -(idx * seg + seg / 2);
      const finalRot = target - 360 * 6;
      setRotation(finalRot);
      setTimeout(() => {
        setWinner({ id: w.id, name: w.name, is_winner: true });
        setOverlay(true);
      }, 8400);
    } catch (err: any) {
      setErr(err?.message || 'Draw failed');
      setSpinning(false);
    }
  }

  // -- 6. countdown ---------------------------------------------------------
  const isDrawingTime = now >= DRAW_AT_MS;
  const countdownStr  = useMemo(() => {
    if (isDrawingTime) return null;
    const diff = Math.max(0, DRAW_AT_MS - now);
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
    return `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  }, [now, isDrawingTime]);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: BKB_CREAM,
        color: INK,
        fontFamily: 'Georgia, "Times New Roman", serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1.5rem 1rem 6rem',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top corner QRs */}
      <QrCorner
        side="left"
        label="OUR WEBSITE"
        url="brettkingbuilder.com"
        src="/raffle/qr_website.png"
      />
      <QrCorner
        side="right"
        label="CONTACT US"
        url="brettkingbuilder.com / contact-us"
        src="/raffle/qr_contact.png"
      />

      <Header entries={entries.length} />

      {/* The wheel */}
      <div
        style={{
          marginTop: '1.4rem',
          position: 'relative',
          width: 'min(72vmin, 720px)',
          height: 'min(72vmin, 720px)',
        }}
      >
        <Pointer />
        <Wheel entries={entries} rotation={rotation} spinning={spinning} />
      </div>

      {/* Countdown / drawing controls */}
      <div style={{ marginTop: '1.8rem', textAlign: 'center' }}>
        {!winner && countdownStr && (
          <>
            <div
              style={{
                fontSize: 12,
                letterSpacing: '0.36em',
                color: BKB_GOLD,
                fontWeight: 600,
                fontFamily: 'system-ui, sans-serif',
                marginBottom: 10,
              }}
            >
              DRAWING IN
            </div>
            <div
              style={{
                fontSize: 'clamp(30px, 5.5vmin, 60px)',
                fontStyle: 'italic',
                color: BKB_RED,
                letterSpacing: 1,
                lineHeight: 1,
              }}
            >
              {countdownStr}
            </div>
            <div
              style={{
                fontSize: 15,
                color: INK,
                marginTop: 10,
                fontStyle: 'italic',
              }}
            >
              Saturday, June 14, 2026 · 4:00 PM
            </div>
          </>
        )}

        {!winner && isDrawingTime && (
          <div style={{ fontSize: 15, color: INK, fontStyle: 'italic' }}>
            It's time. {authedAdmin ? 'Spin the wheel below.' : 'Brett will draw the winner.'}
          </div>
        )}

        {winner && !showOverlay && (
          <div style={{ fontSize: 15, color: INK, fontStyle: 'italic' }}>Spinning…</div>
        )}

        {authedAdmin && !winner && (
          <button
            onClick={handleSpin}
            disabled={spinning || !isDrawingTime || entries.length === 0}
            style={{
              marginTop: 20,
              padding: '1rem 2.6rem',
              background: (spinning || !isDrawingTime) ? '#888' : BKB_RED,
              color: BKB_CREAM,
              border: `2px solid ${BKB_GOLD}`,
              borderRadius: 4,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '0.28em',
              cursor: (spinning || !isDrawingTime) ? 'not-allowed' : 'pointer',
              opacity: (spinning || !isDrawingTime) ? 0.65 : 1,
              boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
            }}
          >
            {spinning ? 'SPINNING…' : 'SPIN THE WHEEL'}
          </button>
        )}
        {errMsg && (
          <div style={{ marginTop: 12, color: BKB_RED, fontSize: 14 }}>{errMsg}</div>
        )}
      </div>

      <Footer />

      {winner && showOverlay && (
        <WinnerOverlay name={winner.name} onClose={() => setOverlay(false)} />
      )}
    </main>
  );
}

// ============================================================================
// Header
// ============================================================================
function Header({ entries }: { entries: number }) {
  return (
    <div style={{ textAlign: 'center', maxWidth: '60vw', paddingTop: '0.4rem' }}>
      <img
        src="/raffle/bkb_logo.png"
        alt="Brett King Builder"
        style={{
          height: 'clamp(72px, 11vmin, 132px)',
          width: 'auto',
          display: 'block',
          margin: '0 auto 0.4rem',
        }}
      />
      <div
        style={{
          fontSize: 'clamp(10px, 1.3vmin, 14px)',
          letterSpacing: '0.42em',
          color: BKB_GOLD,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
        }}
      >
        BUILDER · CONTRACTOR · EST. 1982
      </div>
      <h1
        style={{
          fontStyle: 'italic',
          fontWeight: 400,
          color: BKB_RED,
          fontSize: 'clamp(40px, 6.5vmin, 80px)',
          margin: '0.10em 0 0.1em 0',
          lineHeight: 1,
        }}
      >
        A Taste of Bucks County
      </h1>
      <div style={{ fontSize: 14, fontStyle: 'italic', color: INK, marginTop: 6 }}>
        {entries === 0
          ? 'Be the first to enter.'
          : `${entries} ${entries === 1 ? 'name' : 'names'} on the wheel.`}
      </div>
    </div>
  );
}

// ============================================================================
// Corner QR (positioned absolutely in top-left or top-right)
// ============================================================================
function QrCorner({
  side, label, url, src,
}: { side: 'left' | 'right'; label: string; url: string; src: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '1.5rem',
        [side]: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        zIndex: 4,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.34em',
          color: BKB_RED,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <img
        src={src}
        alt={label}
        style={{
          width: 'clamp(108px, 13vmin, 168px)',
          height: 'auto',
          display: 'block',
          border: `2px solid ${BKB_GOLD}`,
          background: BKB_CREAM,
        }}
      />
      <div
        style={{
          fontSize: 11,
          marginTop: 7,
          color: BKB_RED_DK,
          fontFamily: 'system-ui, sans-serif',
          fontStyle: 'italic',
          letterSpacing: '0.04em',
        }}
      >
        {url}
      </div>
    </div>
  );
}

// ============================================================================
// The wheel
// ============================================================================
function Wheel({
  entries, rotation, spinning,
}: { entries: Entry[]; rotation: number; spinning: boolean }) {
  if (entries.length === 0) {
    return (
      <svg viewBox="-100 -100 200 200" width="100%" height="100%">
        <circle cx="0" cy="0" r="96" fill={BKB_CREAM} stroke={BKB_GOLD} strokeWidth="2" />
        <text x="0" y="0" textAnchor="middle" dominantBaseline="middle"
              fill={BKB_RED} fontSize="9" fontStyle="italic">
          Waiting on the first entry…
        </text>
      </svg>
    );
  }

  const n   = entries.length;
  const seg = 360 / n;
  const segments = entries.map((e, i) => {
    const a0 = i * seg - 90;
    const a1 = (i + 1) * seg - 90;
    const aMid = (a0 + a1) / 2;
    const r = 96;
    const x0 = Math.cos((a0 * Math.PI) / 180) * r;
    const y0 = Math.sin((a0 * Math.PI) / 180) * r;
    const x1 = Math.cos((a1 * Math.PI) / 180) * r;
    const y1 = Math.sin((a1 * Math.PI) / 180) * r;
    const largeArc = seg > 180 ? 1 : 0;
    const path = `M 0 0 L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
    const fill = i % 2 === 0 ? BKB_RED : BKB_GOLD_LT;
    const labelFill = i % 2 === 0 ? BKB_CREAM : INK;
    return { path, fill, labelFill, aMid, name: e.name, isWinner: e.is_winner };
  });
  const fontSize = Math.max(3.2, Math.min(9, 60 / n + 2));

  return (
    <svg viewBox="-100 -100 200 200" width="100%" height="100%" style={{ display: 'block' }}>
      <defs>
        <filter id="wheelShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0.8" stdDeviation="1.5" floodOpacity="0.35" />
        </filter>
      </defs>
      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          transformOrigin: '0 0',
          transition: spinning ? 'transform 8s cubic-bezier(0.18, 0.7, 0.07, 1.0)' : 'none',
        }}
        filter="url(#wheelShadow)"
      >
        <circle cx="0" cy="0" r="98" fill={BKB_GOLD} />
        <circle cx="0" cy="0" r="96" fill={BKB_CREAM} />
        {segments.map((s, i) => (
          <g key={i}>
            <path d={s.path} fill={s.fill} stroke={BKB_CREAM} strokeWidth="0.5" />
            <g transform={`rotate(${s.aMid}) translate(${72} 0)`}>
              <text
                textAnchor="end"
                dominantBaseline="middle"
                fill={s.labelFill}
                fontFamily='Georgia, "Times New Roman", serif'
                fontSize={fontSize}
                fontStyle="italic"
                style={{ paintOrder: 'stroke', strokeWidth: 0.2, stroke: 'rgba(0,0,0,0.18)' }}
              >
                {truncate(s.name, n)}
              </text>
            </g>
          </g>
        ))}
        <circle cx="0" cy="0" r="12" fill={BKB_GOLD} stroke={BKB_RED} strokeWidth="1.5" />
        <circle cx="0" cy="0" r="5"  fill={BKB_RED}  />
      </g>
    </svg>
  );
}

function truncate(name: string, n: number): string {
  const max = Math.max(8, Math.floor(180 / Math.max(n, 1)));
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

// ============================================================================
// Pointer
// ============================================================================
function Pointer() {
  return (
    <svg
      viewBox="-10 -10 20 20"
      width="48"
      height="48"
      style={{
        position: 'absolute',
        top: -12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 5,
      }}
    >
      <polygon points="-7,-3 7,-3 0,9" fill={BKB_RED} stroke={BKB_GOLD} strokeWidth="0.6" />
    </svg>
  );
}

// ============================================================================
// Winner overlay
// ============================================================================
function WinnerOverlay({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: `linear-gradient(135deg, ${BKB_RED}f5 0%, ${BKB_RED_DK}f8 100%)`,
        color: BKB_CREAM,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        textAlign: 'center',
        fontFamily: 'Georgia, "Times New Roman", serif',
        padding: '2rem',
      }}
    >
      <div
        style={{
          fontSize: 16,
          letterSpacing: '0.5em',
          color: BKB_GOLD,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
        }}
      >
        AND THE WINNER IS
      </div>
      <div
        style={{
          marginTop: 24,
          fontStyle: 'italic',
          fontSize: 'clamp(60px, 14vmin, 220px)',
          lineHeight: 1,
          color: BKB_CREAM,
        }}
      >
        {name}
      </div>
      <div
        style={{
          marginTop: 28,
          fontSize: 18,
          fontStyle: 'italic',
          color: BKB_GOLD,
        }}
      >
        Brett King Builder · Bucks Beautiful Tour 2026
      </div>
      <button
        onClick={onClose}
        style={{
          marginTop: 48,
          background: 'transparent',
          color: BKB_CREAM,
          border: `1px solid ${BKB_GOLD}`,
          padding: '0.6rem 1.6rem',
          letterSpacing: '0.3em',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        DISMISS
      </button>
    </div>
  );
}

// ============================================================================
// Footer
// ============================================================================
function Footer() {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: 12,
        letterSpacing: '0.32em',
        color: BKB_GOLD,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      BRETT KING BUILDER · BUILDING &amp; RESTORING FINE HOMES SINCE 1982
    </div>
  );
}
