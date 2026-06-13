// @ts-nocheck
'use client';

/**
 * /raffle/admin — owner/admin-only console for the raffle.
 *
 * - Manual-entry form for paper sign-up sheet names (source='admin_manual')
 * - Live list of every entry (with PII) — sortable, edit/delete
 * - "Spin the wheel" link to /raffle/wheel?control=owner for the TV
 * - Trigger Drawing button as a fallback (calls /api/raffle/draw directly,
 *   no animation). Useful if the TV display is offline.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

const BKB_RED    = '#68050a';
const BKB_GOLD   = '#c88c00';
const BKB_CREAM  = '#f8f6f3';
const INK        = '#1C1F22';
const INK_SOFT   = '#5C5043';
const BORDER     = `1px solid #e8e5e0`;

const INTERESTS: { id: string; label: string }[] = [
  { id: 'kitchen',     label: 'Kitchen' },
  { id: 'bathroom',    label: 'Bath' },
  { id: 'addition',    label: 'Addition' },
  { id: 'interior',    label: 'Interior' },
  { id: 'exterior',    label: 'Windows & Exteriors' },
  { id: 'landscaping', label: 'Outdoor / Hardscape' },
  { id: 'historic',    label: 'Historic' },
  { id: 'other',       label: 'Other' },
];

const DRAW_AT_MS = Date.parse('2026-06-14T20:00:00Z');

type AdminEntry = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  contact_ok: boolean;
  interests: string[];
  source: 'public_qr' | 'admin_manual';
  entered_by: string | null;
  is_winner: boolean;
  drawn_at: string | null;
  created_at: string;
};

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('bkb-token') || '';
}

export default function RaffleAdminPage() {
  const auth = useAuth();

  const [entries, setEntries] = useState<AdminEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [drawNow, setDrawNow] = useState(Date.now());
  const [drawErr, setDrawErr] = useState('');
  const [drawnWinner, setDrawnWinner] = useState<AdminEntry | null>(null);

  // edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft,  setEditDraft]  = useState<EditDraft | null>(null);
  const [editErr,    setEditErr]    = useState('');

  // form
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [email, setEmail]     = useState('');
  const [contactOk, setCont]  = useState(false);
  const [enteredBy, setEntBy] = useState('');
  const [interests, setInts]  = useState<Set<string>>(new Set());
  const [adding, setAdding]   = useState(false);
  const [addErr, setAddErr]   = useState('');

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/raffle/admin', {
        headers: { Authorization: `Bearer ${getToken()}` },
        cache: 'no-store',
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        setErr(b?.error || 'load_failed');
        setLoading(false);
        return;
      }
      const body = await r.json();
      setEntries(body.entries || []);
      const winner = (body.entries || []).find((e: AdminEntry) => e.is_winner);
      if (winner) setDrawnWinner(winner);
    } catch (e: any) {
      setErr(e?.message || 'load_failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(() => setDrawNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setAddErr('');
    if (!name.trim()) { setAddErr('Name is required.'); return; }
    setAdding(true);
    try {
      const r = await fetch('/api/raffle/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          contact_ok: contactOk,
          interests: Array.from(interests),
          entered_by: enteredBy.trim() || auth.user?.name || null,
        }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        setAddErr(b?.message || b?.error || 'add_failed');
        return;
      }
      // clear & reload
      setName(''); setPhone(''); setEmail(''); setCont(false); setInts(new Set());
      await load();
    } catch (e: any) {
      setAddErr(e?.message || 'add_failed');
    } finally {
      setAdding(false);
    }
  }

  async function delEntry(id: string) {
    if (!confirm('Soft-delete this entry?')) return;
    const r = await fetch(`/api/raffle/admin?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      alert(b?.error || 'delete_failed');
      return;
    }
    load();
  }

  // ---- Inline edit ----
  type EditDraft = {
    name: string;
    phone: string;
    email: string;
    contact_ok: boolean;
    interests: Set<string>;
  };

  function startEdit(e: AdminEntry) {
    setEditingId(e.id);
    setEditDraft({
      name: e.name || '',
      phone: e.phone || '',
      email: e.email || '',
      contact_ok: !!e.contact_ok,
      interests: new Set(e.interests || []),
    });
    setEditErr('');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditErr('');
  }
  async function saveEdit(id: string) {
    if (!editDraft) return;
    setEditErr('');
    if (!editDraft.name.trim()) {
      setEditErr('Name cannot be empty.');
      return;
    }
    const r = await fetch('/api/raffle/admin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({
        id,
        name: editDraft.name.trim(),
        phone: editDraft.phone.trim() || null,
        email: editDraft.email.trim() || null,
        contact_ok: editDraft.contact_ok,
        interests: Array.from(editDraft.interests),
      }),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      setEditErr(b?.message || b?.error || 'save_failed');
      return;
    }
    setEditingId(null);
    setEditDraft(null);
    await load();
  }
  function toggleEditInterest(id: string) {
    if (!editDraft) return;
    const next = new Set(editDraft.interests);
    if (next.has(id)) next.delete(id); else next.add(id);
    setEditDraft({ ...editDraft, interests: next });
  }

  async function resetWinner() {
    if (!confirm('Clear the current winner so the wheel can be re-spun? (Use for testing.)')) return;
    setDrawErr('');
    const r = await fetch('/api/raffle/reset', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      setDrawErr(b?.error || 'reset_failed');
      return;
    }
    setDrawnWinner(null);
    await load();
  }

  async function triggerDraw(override = false) {
    setDrawErr('');
    const r = await fetch('/api/raffle/draw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ override }),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      if (b?.error === 'too_early' && b?.seconds_until_drawing) {
        setDrawErr(`Too early. ${Math.floor(b.seconds_until_drawing / 3600)} hours until drawing.`);
      } else if (b?.error === 'winner_already_drawn') {
        setDrawErr('Winner already drawn.');
      } else {
        setDrawErr(b?.error || 'draw_failed');
      }
      return;
    }
    await load();
  }

  function toggleInt(id: string) {
    const n = new Set(interests);
    if (n.has(id)) n.delete(id); else n.add(id);
    setInts(n);
  }

  // ----- auth gate ---------------------------------------------------------
  if (auth.loading) {
    return <Center>Loading…</Center>;
  }
  if (!auth.isAuthenticated || auth.role !== 'owner') {
    return <Center>You must be signed in as the owner to use this page.</Center>;
  }

  // ----- main render -------------------------------------------------------
  const isDrawTime = drawNow >= DRAW_AT_MS;
  const stats = {
    total:     entries.length,
    publicQR:  entries.filter(e => e.source === 'public_qr').length,
    manual:    entries.filter(e => e.source === 'admin_manual').length,
    optIn:     entries.filter(e => e.contact_ok).length,
  };

  return (
    <main style={{ background: BKB_CREAM, minHeight: '100vh', color: INK, fontFamily: 'system-ui, sans-serif' }}>
      {/* Hero */}
      <div style={{ background: BKB_RED, color: BKB_CREAM, padding: '1.4rem 1.6rem', borderBottom: `3px solid ${BKB_GOLD}` }}>
        <div style={{ fontSize: 11, letterSpacing: '0.32em', color: BKB_GOLD, marginBottom: 6, fontWeight: 600 }}>
          BUCKS BEAUTIFUL TOUR · 2026
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ margin: 0, fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 30, fontStyle: 'italic', fontWeight: 400 }}>
            Raffle Console
          </h1>
          <a
            href="/raffle/wheel?control=owner"
            target="_blank"
            rel="noreferrer"
            style={{ color: BKB_CREAM, border: `1px solid ${BKB_GOLD}`, padding: '0.5rem 1.1rem', textDecoration: 'none', fontSize: 12, letterSpacing: '0.2em', fontWeight: 600 }}
          >
            OPEN TV WHEEL ↗
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '1.6rem' }}>
        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
          <Stat label="ENTRIES"      value={stats.total} />
          <Stat label="VIA QR"       value={stats.publicQR} />
          <Stat label="ENTERED BY US" value={stats.manual} />
          <Stat label="OPT-IN LEADS" value={stats.optIn} accent />
        </div>

        {/* Drawing control */}
        <div style={{ background: '#fff', border: BORDER, borderRadius: 6, padding: '1rem 1.2rem', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.28em', color: BKB_GOLD, fontWeight: 600 }}>DRAWING</div>
              <div style={{ fontSize: 18, fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', color: BKB_RED }}>
                Sunday, June 14, 2026 · 4:00 PM
              </div>
              {drawnWinner ? (
                <>
                  <div style={{ fontSize: 14, marginTop: 6, color: INK }}>
                    Winner: <strong style={{ color: BKB_RED }}>{drawnWinner.name}</strong>
                    {drawnWinner.drawn_at ? `  ·  drawn ${new Date(drawnWinner.drawn_at).toLocaleString()}` : null}
                  </div>
                  <button
                    onClick={resetWinner}
                    style={{
                      marginTop: 8,
                      padding: '0.4rem 0.9rem',
                      background: 'transparent',
                      color: BKB_RED,
                      border: `1px solid ${BKB_RED}`,
                      borderRadius: 3,
                      fontSize: 11,
                      letterSpacing: '0.16em',
                      cursor: 'pointer',
                    }}
                  >
                    RESET WINNER (for testing)
                  </button>
                </>
              ) : (
                <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 4 }}>
                  {isDrawTime ? "It's drawing time." : 'Not yet.'}
                </div>
              )}
            </div>
            {!drawnWinner && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => triggerDraw(false)}
                  disabled={!isDrawTime || entries.length === 0}
                  style={{
                    padding: '0.6rem 1.2rem',
                    background: (!isDrawTime || entries.length === 0) ? '#999' : BKB_RED,
                    color: BKB_CREAM,
                    border: `1.5px solid ${BKB_GOLD}`,
                    borderRadius: 4,
                    fontSize: 12,
                    letterSpacing: '0.24em',
                    fontWeight: 700,
                    cursor: (!isDrawTime || entries.length === 0) ? 'not-allowed' : 'pointer',
                  }}
                >
                  DRAW WINNER NOW
                </button>
                <button
                  onClick={() => {
                    if (confirm('Override the drawing-time check? This is for testing only.')) {
                      triggerDraw(true);
                    }
                  }}
                  style={{
                    padding: '0.6rem 1.2rem',
                    background: 'transparent',
                    color: INK_SOFT,
                    border: `1px solid ${INK_SOFT}`,
                    borderRadius: 4,
                    fontSize: 11,
                    letterSpacing: '0.18em',
                    cursor: 'pointer',
                  }}
                >
                  TEST OVERRIDE
                </button>
              </div>
            )}
          </div>
          {drawErr && (
            <div style={{ marginTop: 10, color: BKB_RED, fontSize: 13 }}>{drawErr}</div>
          )}
        </div>

        {/* Manual entry form */}
        <div style={{ background: '#fff', border: BORDER, borderRadius: 6, padding: '1.2rem', marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 14px 0', fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 400, fontSize: 22, color: BKB_RED }}>
            Add a name
          </h2>
          <form onSubmit={addEntry}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1.8fr', gap: 10, marginBottom: 10 }}>
              <Field label="Name *">
                <input value={name} onChange={e => setName(e.target.value)} required style={input()} />
              </Field>
              <Field label="Phone">
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(215) 555-0123" style={input()} />
              </Field>
              <Field label="Email">
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" style={input()} />
              </Field>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: INK }}>
                <input type="checkbox" checked={contactOk} onChange={e => setCont(e.target.checked)} />
                Contact OK
              </label>
              {INTERESTS.map(opt => {
                const on = interests.has(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleInt(opt.id)}
                    style={{
                      padding: '0.35rem 0.6rem',
                      border: `1px solid ${on ? BKB_RED : '#ccc'}`,
                      background: on ? `${BKB_RED}11` : '#fff',
                      color: on ? BKB_RED : INK,
                      borderRadius: 3,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {on ? '✓ ' : ''}
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <Field label="Entered by">
                <input value={enteredBy} onChange={e => setEntBy(e.target.value)} placeholder={auth.user?.name || ''} style={input()} />
              </Field>
              <button
                type="submit"
                disabled={adding}
                style={{
                  padding: '0.6rem 1.2rem',
                  background: BKB_RED,
                  color: BKB_CREAM,
                  border: 'none',
                  borderRadius: 4,
                  fontSize: 12,
                  letterSpacing: '0.18em',
                  fontWeight: 700,
                  cursor: adding ? 'wait' : 'pointer',
                  opacity: adding ? 0.7 : 1,
                }}
              >
                {adding ? 'ADDING…' : 'ADD ENTRY'}
              </button>
            </div>
            {addErr && <div style={{ color: BKB_RED, marginTop: 10, fontSize: 13 }}>{addErr}</div>}
          </form>
        </div>

        {/* Entries list */}
        <div style={{ background: '#fff', border: BORDER, borderRadius: 6, padding: '1rem 1.2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 400, fontSize: 22, color: BKB_RED }}>
              All entries
            </h2>
            <button onClick={load} style={{ fontSize: 12, color: BKB_RED, background: 'none', border: 'none', cursor: 'pointer' }}>↻ Refresh</button>
          </div>
          {err && <div style={{ color: BKB_RED, marginBottom: 12 }}>{err}</div>}
          {loading && <div style={{ color: INK_SOFT }}>Loading…</div>}
          {!loading && entries.length === 0 && (
            <div style={{ color: INK_SOFT, fontStyle: 'italic' }}>No entries yet.</div>
          )}
          {!loading && entries.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: INK_SOFT, fontWeight: 600, fontSize: 11, letterSpacing: '0.18em' }}>
                    <th style={th()}>NAME</th>
                    <th style={th()}>PHONE</th>
                    <th style={th()}>EMAIL</th>
                    <th style={th()}>CONTACT?</th>
                    <th style={th()}>INTERESTS</th>
                    <th style={th()}>VIA</th>
                    <th style={th()}>WHEN</th>
                    <th style={th()}></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => {
                    const isEditing = editingId === e.id && editDraft;
                    if (isEditing && editDraft) {
                      return (
                        <tr key={e.id} style={{ borderTop: BORDER, background: '#fffcec' }}>
                          <td style={td()}>
                            <input value={editDraft.name}
                              onChange={ev => setEditDraft({ ...editDraft, name: ev.target.value })}
                              style={{ ...input(), padding: '0.3rem 0.4rem', fontSize: 13 }} />
                          </td>
                          <td style={td()}>
                            <input value={editDraft.phone}
                              onChange={ev => setEditDraft({ ...editDraft, phone: ev.target.value })}
                              style={{ ...input(), padding: '0.3rem 0.4rem', fontSize: 13 }} />
                          </td>
                          <td style={td()}>
                            <input value={editDraft.email}
                              onChange={ev => setEditDraft({ ...editDraft, email: ev.target.value })}
                              style={{ ...input(), padding: '0.3rem 0.4rem', fontSize: 13 }} />
                          </td>
                          <td style={td()}>
                            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input type="checkbox" checked={editDraft.contact_ok}
                                onChange={ev => setEditDraft({ ...editDraft, contact_ok: ev.target.checked })} />
                              Yes
                            </label>
                          </td>
                          <td style={td()}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 220 }}>
                              {INTERESTS.map(opt => {
                                const on = editDraft.interests.has(opt.id);
                                return (
                                  <button key={opt.id} type="button" onClick={() => toggleEditInterest(opt.id)}
                                    style={{
                                      padding: '0.15rem 0.35rem',
                                      border: `1px solid ${on ? BKB_RED : '#ccc'}`,
                                      background: on ? `${BKB_RED}11` : '#fff',
                                      color: on ? BKB_RED : INK,
                                      borderRadius: 3, fontSize: 10, cursor: 'pointer',
                                    }}>
                                    {on ? '✓ ' : ''}{opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td style={td()}>
                            {e.source === 'public_qr' ? 'QR' : `manual${e.entered_by ? ' · ' + e.entered_by : ''}`}
                          </td>
                          <td style={td()}>{new Date(e.created_at).toLocaleString()}</td>
                          <td style={td()}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <button onClick={() => saveEdit(e.id)}
                                style={{ background: BKB_RED, color: '#fff', border: 'none', padding: '0.3rem 0.5rem', borderRadius: 3, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                                save
                              </button>
                              <button onClick={cancelEdit}
                                style={{ background: 'none', border: '1px solid #ccc', padding: '0.3rem 0.5rem', borderRadius: 3, fontSize: 11, cursor: 'pointer', color: INK_SOFT }}>
                                cancel
                              </button>
                              {editErr && <div style={{ color: BKB_RED, fontSize: 10 }}>{editErr}</div>}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={e.id} style={{ borderTop: BORDER, background: e.is_winner ? '#fff7e0' : 'transparent' }}>
                        <td style={td()}>
                          {e.is_winner && <span style={{ color: BKB_GOLD, marginRight: 6 }}>★</span>}
                          {e.name}
                        </td>
                        <td style={td()}>{e.phone || '—'}</td>
                        <td style={td()}>{e.email || '—'}</td>
                        <td style={td()}>{e.contact_ok ? <span style={{ color: BKB_RED, fontWeight: 600 }}>YES</span> : '—'}</td>
                        <td style={td()}>{(e.interests || []).join(', ') || '—'}</td>
                        <td style={td()}>
                          {e.source === 'public_qr' ? 'QR' : `manual${e.entered_by ? ' · ' + e.entered_by : ''}`}
                        </td>
                        <td style={td()}>{new Date(e.created_at).toLocaleString()}</td>
                        <td style={td()}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => startEdit(e)}
                              style={{ background: 'none', border: 'none', color: BKB_RED, cursor: 'pointer', fontSize: 12 }}>
                              edit
                            </button>
                            <button onClick={() => delEntry(e.id)}
                              style={{ background: 'none', border: 'none', color: BKB_RED, cursor: 'pointer', fontSize: 12 }}>
                              delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ============================================================
// Helpers
// ============================================================

function input(): React.CSSProperties {
  return {
    width: '100%',
    padding: '0.55rem 0.7rem',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 14,
    fontFamily: 'inherit',
  };
}
function th(): React.CSSProperties { return { padding: '0.4rem 0.55rem', textAlign: 'left' as const }; }
function td(): React.CSSProperties { return { padding: '0.55rem 0.55rem', verticalAlign: 'top' as const }; }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.16em', color: INK_SOFT, fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{ background: '#fff', border: BORDER, borderRadius: 6, padding: '0.9rem 1rem' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.24em', color: BKB_GOLD, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 30, fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', color: accent ? BKB_RED : INK, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BKB_CREAM, color: INK, fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' }}>
      <div style={{ maxWidth: 480 }}>{children}</div>
    </main>
  );
}
