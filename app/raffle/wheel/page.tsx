// @ts-nocheck
'use client';

/**
 * /raffle/wheel — TV display for the Bucks Beautiful Tour raffle.
 *
 * - Shows a Wheel-of-Fortune-style wheel with one segment per entry.
 * - Subscribes to Supabase realtime so the wheel updates as new entries arrive.
 * - Shows a countdown to drawing time (2026-06-14 16:00 ET).
 * - "SPIN THE WHEEL" button only enabled at drawing time AND only visible to
 *   a signed-in admin (token in localStorage). Public viewers see the wheel
 *   and the countdown but no controls.
 * - When the draw happens, the wheel animates to land on the winner and shows
 *   a celebratory overlay.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserClient } from '../../lib/supabase';

const BKB_RED    = '#68050a';
const BKB_GOLD   = '#c88c00';
const BKB_GOLD_2 = '#d9a855';
const BKB_CREAM  = '#f8f6f3';
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

  // -- 1. Pull initial entries + subscribe to realtime ----------------------
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

  // -- 2. tick the clock every second --------------------------------------
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // -- 3. read admin auth token --------------------------------------------
  useEffect(() => {
    try {
      const token = localStorage.getItem('bkb-token');
      const role  = localStorage.getItem('bkb-role');     // some pages cache role separately
      setAuthToken(token);
      // Treat owner as the only role allowed to spin. Token alone isn't enough
      // because we don't synchronously know the role; but ?control=owner in the
      // URL is also accepted for the TV scenario where Brett opens the page once.
      const sp = new URLSearchParams(window.location.search);
      const queryControl = sp.get('control') === 'owner';
      setAuthedAdmin(!!token && (role === 'owner' || queryControl));
    } catch {}
  }, []);

  // -- 4. detect a winner arriving over realtime ---------------------------
  useEffect(() => {
    if (!winner) return;
    // If we already see a winner but the wheel is sitting still, animate
    // it to land on them (but only if we didn't already animate).
    if (rotation === 0 && entries.length > 0) {
      const idx = entries.findIndex(e => e.id === winner.id);
      if (idx >= 0) {
        const seg = 360 / entries.length;
        // Rotation so that the pointer at 0deg (12 o'clock) lands at the
        // center of segment idx. Wheel rotates CW so we need negative seg-center.
        const target = -(idx * seg + seg / 2);
        // Spin: many full rotations plus the target.
        const finalRot = target - 360 * 6;
        setSpinning(true);
        setRotation(finalRot);
        // overlay shows ~0.5s after wheel finishes
        setTimeout(() => setOverlay(true), 8500);
      } else {
        setOverlay(true);
      }
    }
  }, [winner, entries]);

  // -- 5. spin handler -----------------------------------------------------
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
      // Find the winner's index, animate to it
      const idx = entries.findIndex(e => e.id === w.id);
      if (idx < 0) {
        // Realtime hasn't caught up; fallback to overlay-only
        setWinner({ id: w.id, name: w.name, is_winner: true });
        setOverlay(true);
        setSpinning(false);
        return;
      }
      const seg = 360 / entries.length;
      const target = -(idx * seg + seg / 2);
      const finalRot = target - 360 * 6;
      setRotation(finalRot);
      // wait for spin to finish before locking in winner state + overlay
      setTimeout(() => {
        setWinner({ id: w.id, name: w.name, is_winner: true });
        setOverlay(true);
      }, 8400);
    } catch (err: any) {
      setErr(err?.message || 'Draw failed');
      setSpinning(false);
    }
  }

  // -- 6. countdown display -----------------------------------------------
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
        padding: '2.5rem 1rem',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Header entries={entries.length} />

      {/* The Wheel */}
      <div
        style={{
          marginTop: '2rem',
          position: 'relative',
          width: 'min(78vmin, 760px)',
          height: 'min(78vmin, 760px)',
        }}
      >
        <Pointer />
        <Wheel
          entries={entries}
          rotation={rotation}
          spinning={spinning}
        />
      </div>

      {/* Countdown / Drawing controls */}
      <div style={{ marginTop: '2.4rem', textAlign: 'center' }}>
        {!winner && countdownStr && (
          <>
            <div
              style={{
                fontSize: 12,
                letterSpacing: '0.32em',
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
                fontSize: 'clamp(28px, 5vmin, 56px)',
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
                fontSize: 14,
                color: INK,
                marginTop: 12,
                fontStyle: 'italic',
              }}
            >
              Saturday, June 14, 2026 · 4:00 PM
            </div>
          </>
        )}

        {!winner && isDrawingTime && (
          <div style={{ marginTop: 18, fontSize: 14, color: INK, fontStyle: 'italic' }}>
            It's time. {authedAdmin
              ? 'Spin the wheel below.'
              : 'Brett will draw the winner.'}
          </div>
        )}

        {winner && !showOverlay && (
          <div style={{ marginTop: 18, fontSize: 14, color: INK, fontStyle: 'italic' }}>
            Spinning…
          </div>
        )}

        {authedAdmin && !winner && (
          <button
            onClick={handleSpin}
            disabled={spinning || !isDrawingTime || entries.length === 0}
            style={{
              marginTop: 24,
              padding: '1rem 2.4rem',
              background: (spinning || !isDrawingTime) ? '#888' : BKB_RED,
              color: BKB_CREAM,
              border: `2px solid ${BKB_GOLD}`,
              borderRadius: 4,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: '0.24em',
              cursor: (spinning || !isDrawingTime) ? 'not-allowed' : 'pointer',
              opacity: (spinning || !isDrawingTime) ? 0.65 : 1,
            }}
          >
            {spinning ? 'SPINNING…' : 'SPIN THE WHEEL'}
          </button>
        )}
        {errMsg && (
          <div style={{ marginTop: 14, color: BKB_RED, fontSize: 13 }}>{errMsg}</div>
        )}
      </div>

      <Footer />

      {/* Winner overlay */}
      {winner && showOverlay && (
        <WinnerOverlay name={winner.name} onClose={() => setOverlay(false)} />
      )}
    </main>
  );
}

// ============================================================================
// Header (logo + title)
// ============================================================================
function Header({ entries }: { entries: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          fontSize: 12,
          letterSpacing: '0.36em',
          color: BKB_GOLD,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
        }}
      >
        BRETT KING BUILDER  ·  EST. 1982
      </div>
      <h1
        style={{
          fontStyle: 'italic',
          fontWeight: 400,
          color: BKB_RED,
          fontSize: 'clamp(36px, 6vmin, 72px)',
          margin: '0.2em 0 0.1em 0',
          lineHeight: 1,
        }}
      >
        A Taste of Bucks County
      </h1>
      <div
        style={{
          fontSize: 14,
          fontStyle: 'italic',
          color: INK,
          marginTop: 8,
        }}
      >
        {entries === 0
          ? 'Be the first to enter.'
          : `${entries} ${entries === 1 ? 'name' : 'names'} on the wheel.`}
      </div>
    </div>
  );
}

// ============================================================================
// The wheel itself
// ============================================================================
function Wheel({
  entries,
  rotation,
  spinning,
}: {
  entries: Entry[];
  rotation: number;
  spinning: boolean;
}) {
  if (entries.length === 0) {
    // Empty wheel placeholder
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

  // Pre-compute segment paths and label transforms.
  const segments = entries.map((e, i) => {
    const a0 = i * seg - 90;       // -90 so segment 0 starts at the top
    const a1 = (i + 1) * seg - 90;
    const aMid = (a0 + a1) / 2;
    const r = 96;

    const x0 = Math.cos((a0 * Math.PI) / 180) * r;
    const y0 = Math.sin((a0 * Math.PI) / 180) * r;
    const x1 = Math.cos((a1 * Math.PI) / 180) * r;
    const y1 = Math.sin((a1 * Math.PI) / 180) * r;
    const largeArc = seg > 180 ? 1 : 0;

    const path = `M 0 0 L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;

    // Alternating burgundy / gold (with a darker gold for higher contrast)
    const fill = i % 2 === 0 ? BKB_RED : BKB_GOLD_2;
    const labelFill = i % 2 === 0 ? BKB_CREAM : INK;

    // Label sits along the segment radius
    return { path, fill, labelFill, aMid, name: e.name, isWinner: e.is_winner };
  });

  // Sizing: when there are many entries, scale font down
  const fontSize = Math.max(3.2, Math.min(9, 60 / n + 2));

  return (
    <svg viewBox="-100 -100 200 200" width="100%" height="100%" style={{ display: 'block' }}>
      <defs>
        <filter id="wheelShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0.8" stdDeviation="1.5" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Rotating group */}
      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          transformOrigin: '0 0',
          transition: spinning ? 'transform 8s cubic-bezier(0.18, 0.7, 0.07, 1.0)' : 'none',
        }}
        filter="url(#wheelShadow)"
      >
        {/* Outer ring */}
        <circle cx="0" cy="0" r="98" fill={BKB_GOLD} />
        <circle cx="0" cy="0" r="96" fill={BKB_CREAM} />

        {/* Pie segments */}
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

        {/* Hub */}
        <circle cx="0" cy="0" r="12" fill={BKB_GOLD} stroke={BKB_RED} strokeWidth="1.5" />
        <circle cx="0" cy="0" r="5"  fill={BKB_RED}  />
      </g>
    </svg>
  );
}

function truncate(name: string, n: number): string {
  // Show more characters when there are few entries
  const max = Math.max(8, Math.floor(180 / Math.max(n, 1)));
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

// ============================================================================
// Pointer (red triangle at 12 o'clock)
// ============================================================================
function Pointer() {
  return (
    <svg
      viewBox="-10 -10 20 20"
      width="42"
      height="42"
      style={{
        position: 'absolute',
        top: -10,
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
        background: 'rgba(104, 5, 10, 0.94)',
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
          fontSize: 14,
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
          fontSize: 'clamp(60px, 14vmin, 200px)',
          lineHeight: 1,
        }}
      >
        {name}
      </div>
      <div
        style={{
          marginTop: 32,
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
// Footer (tagline)
// ============================================================================
function Footer() {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: 11,
        letterSpacing: '0.32em',
        color: BKB_GOLD,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      BRETT KING BUILDER · BUILDING &amp; RESTORING FINE HOMES SINCE 1982
    </div>
  );
}
