// @ts-nocheck
'use client';

/**
 * Compact overview flag: shows a count of the user's transcripts that still need
 * to be categorized, linking to the Transcripts dashboard. Renders nothing when
 * there are none. Replaces the full confirm card on the overview/field home.
 */
import { useEffect, useState } from 'react';
import { Mic, ChevronRight } from 'lucide-react';

function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : ''; }
const GOLD = '#c88c00';

export default function TranscriptsFlag() {
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/transcripts?status=unassigned', { headers: { authorization: `Bearer ${getToken()}` } });
        if (res.ok) { const d = await res.json(); setCount((d.transcripts || []).length); }
      } finally { setLoaded(true); }
    })();
  }, []);

  if (!loaded || count === 0) return null;

  return (
    <a href="/dashboard/transcripts" style={{ textDecoration: 'none' }}>
      <div style={{ marginBottom: 6, borderRadius: 8, border: '1px solid rgba(200,140,0,0.25)', background: 'rgba(200,140,0,0.06)', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <Mic size={15} style={{ color: GOLD, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#2a2520' }}>
          {count} transcript{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} categorizing
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 600, color: GOLD }}>
          Review <ChevronRight size={14} />
        </span>
      </div>
    </a>
  );
}
