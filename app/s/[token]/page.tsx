// @ts-nocheck
'use client';

/**
 * Public client selections sheet — /s/[token]
 *
 * No login. The token is jobId~HMAC, validated server-side by
 * /api/public/selections-sheet, which returns only client-safe data
 * (no internal notes, no costs). BKB texts or emails this link to the
 * client; it always shows the live register, and ?print=1 auto-opens
 * the print dialog so the dashboard's Print button lands here too.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import SelectionsSheetView from '../../dashboard/components/SelectionsSheetView';

export default function PublicSelectionsSheetPage() {
  const params = useParams();
  const search = useSearchParams();
  const token = String(params?.token || '');
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState('');
  const printed = useRef(false);

  useEffect(() => {
    if (!token) return;
    fetch('/api/public/selections-sheet?t=' + encodeURIComponent(token))
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Not found');
        setSheet(d.sheet);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  // Auto-print when opened from the dashboard's Print button
  useEffect(() => {
    if (sheet && search?.get('print') === '1' && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 600);
    }
  }, [sheet, search]);

  if (error) {
    return (
      <div style={{ padding: 80, textAlign: 'center', color: '#4b4b4b' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          This link isn&apos;t available
        </div>
        <div style={{ fontSize: 14 }}>
          The selections sheet you&apos;re looking for could not be found.
          Please check the link or reach out to Brett King Builder.
        </div>
      </div>
    );
  }

  if (!sheet) {
    return (
      <div style={{ padding: 80, textAlign: 'center', color: '#8a8078' }}>
        Loading your selections…
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 12px 60px' }}>
      <div
        className="no-print"
        style={{
          maxWidth: 820,
          margin: '0 auto 12px',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <button
          onClick={() => window.print()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 13.5,
            fontWeight: 600,
            background: '#1a1a1a',
            color: '#ffffff',
            border: '1px solid #1a1a1a',
            cursor: 'pointer',
          }}
        >
          <Printer size={15} /> Print / Save PDF
        </button>
      </div>
      <div
        style={{
          boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
          maxWidth: 820,
          margin: '0 auto',
        }}
      >
        <SelectionsSheetView sheet={sheet} />
      </div>
    </div>
  );
}
