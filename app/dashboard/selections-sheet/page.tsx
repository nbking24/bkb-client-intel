// @ts-nocheck
'use client';

/**
 * Client Selections Sheet — internal tool (/dashboard/selections-sheet)
 *
 * Pick a job → preview the branded, client-safe selections sheet →
 * Print / Save as PDF, or copy the tokened share link the client can
 * open with no login (/s/[token]).
 *
 * The JobTread Specifications tab stays the internal/trade document
 * (it prints Internal Notes). This sheet never includes internal
 * notes or costs — see app/api/lib/selections-sheet.ts.
 */

import { useEffect, useState } from 'react';
import { Printer, Link as LinkIcon, RefreshCw, Check } from 'lucide-react';
import SelectionsSheetView from '../components/SelectionsSheetView';

function getToken() {
  return typeof window !== 'undefined'
    ? localStorage.getItem('bkb-token') || ''
    : '';
}
function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

export default function SelectionsSheetPage() {
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [sheet, setSheet] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/dashboard/selections-sheet', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs || []))
      .catch(() => setError('Could not load jobs'));
  }, []);

  async function loadSheet(id) {
    if (!id) return;
    setLoading(true);
    setError('');
    setSheet(null);
    setShareUrl('');
    try {
      const r = await fetch(
        '/api/dashboard/selections-sheet?jobId=' + encodeURIComponent(id),
        { headers: authHeaders() }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to load');
      setSheet(d.sheet);
      setShareUrl(d.shareUrl);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ padding: 24 }}>
      {/* Toolbar — hidden when printing */}
      <div
        className="no-print"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, marginRight: 8 }}>
          Client Selections Sheet
        </h1>
        <select
          value={jobId}
          onChange={(e) => {
            setJobId(e.target.value);
            loadSheet(e.target.value);
          }}
          style={{
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 14,
            minWidth: 260,
          }}
        >
          <option value="">Select a job…</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {(j.number ? '#' + j.number + ' — ' : '') + j.name}
            </option>
          ))}
        </select>

        {sheet && (
          <>
            <button
              onClick={() =>
                shareUrl
                  ? window.open(shareUrl + '?print=1', '_blank')
                  : window.print()
              }
              style={btnStyle('#1a1a1a', '#ffffff')}
            >
              <Printer size={15} /> Print / Save PDF
            </button>
            <button onClick={copyLink} style={btnStyle('#ffffff', '#1a1a1a')}>
              {copied ? <Check size={15} /> : <LinkIcon size={15} />}
              {copied ? 'Copied' : 'Copy client link'}
            </button>
            <button
              onClick={() => loadSheet(jobId)}
              style={btnStyle('#ffffff', '#1a1a1a')}
            >
              <RefreshCw size={15} /> Refresh
            </button>
          </>
        )}
      </div>

      {loading && (
        <div className="no-print" style={{ color: '#6b7280', padding: 40 }}>
          Building the sheet from JobTread…
        </div>
      )}
      {error && (
        <div className="no-print" style={{ color: '#b91c1c', padding: 20 }}>
          {error}
        </div>
      )}

      {sheet && (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <SelectionsSheetView sheet={sheet} />
        </div>
      )}

      {!sheet && !loading && !error && (
        <div className="no-print" style={{ color: '#6b7280', padding: 40 }}>
          Pick a job to generate its client-facing selections sheet. The sheet
          pulls live from the job&apos;s 📜 Selections register and never
          includes internal notes or costs.
        </div>
      )}
    </div>
  );
}

function btnStyle(bg, fg) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 13.5,
    fontWeight: 600,
    background: bg,
    color: fg,
    border: '1px solid #1a1a1a',
    cursor: 'pointer',
  };
}
