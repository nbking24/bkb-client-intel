'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const LOGIN_USERS = [
  { id: 'nathan',      name: 'Nathan King',      role: 'Owner',            initials: 'NK' },
  { id: 'terri',       name: 'Terri King',       role: 'Office Manager',   initials: 'TK' },
  { id: 'evan',        name: 'Evan Harrington',  role: 'Lead Carpenter',   initials: 'EH' },
  { id: 'josh',        name: 'Josh King',        role: 'Project Manager',  initials: 'JK' },
  { id: 'dave_steich', name: 'Dave Steich',      role: 'Carpenter',        initials: 'DS' },
];

export default function DashboardLoginPage() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pinVerified, setPinVerified] = useState(false);
  const [verifiedPin, setVerifiedPin] = useState('');

  const submitPin = async () => {
    if (!pin.trim()) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (!r.ok) throw new Error();
      setVerifiedPin(pin);
      setPinVerified(true);
    } catch {
      setErr('Invalid PIN');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const selectUser = async (userId: string) => {
    setBusy(true);
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: verifiedPin, userId }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      localStorage.setItem('bkb-token', d.token);
      router.push('/dashboard');
    } catch {
      setErr('Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  if (!pinVerified) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: '#141414' }}>
        <img src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png" alt="BKB" className="h-16 w-auto mb-6" />
        <h1 className="text-xl mb-1" style={{ color: '#CDA274', fontFamily: 'Georgia, serif' }}>Operations Platform</h1>
        <p className="text-sm mb-8" style={{ color: '#8a8078' }}>Enter your PIN to continue</p>
        <div className="w-full max-w-xs space-y-4">
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitPin()}
            placeholder="••••"
            autoFocus
            maxLength={10}
            className="w-full px-4 py-4 rounded-lg text-center text-2xl tracking-widest outline-none"
            style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)', color: '#e8e0d8' }}
          />
          {err && <p className="text-center text-sm" style={{ color: '#c45c4c' }}>{err}</p>}
          <button
            onClick={submitPin}
            disabled={!pin.trim() || busy}
            className="w-full py-4 rounded-lg font-semibold disabled:opacity-30"
            style={{ background: '#CDA274', color: '#1a1a1a' }}
          >
            {busy ? 'Verifying...' : 'Enter'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: '#141414' }}>
      <img src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png" alt="BKB" className="h-16 w-auto mb-6" />
      <h1 className="text-xl mb-1" style={{ color: '#CDA274', fontFamily: 'Georgia, serif' }}>Welcome</h1>
      <p className="text-sm mb-8" style={{ color: '#8a8078' }}>Who are you?</p>
      <div className="w-full max-w-sm space-y-3">
        {LOGIN_USERS.map(user => (
          <button
            key={user.id}
            onClick={() => selectUser(user.id)}
            disabled={busy}
            className="w-full flex items-center gap-4 px-4 py-3.5 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(205,162,116,0.4)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(205,162,116,0.12)')}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ background: '#CDA274', color: '#1a1a1a' }}
            >
              {user.initials}
            </div>
            <div className="text-left">
              <div className="font-medium" style={{ color: '#e8e0d8' }}>{user.name}</div>
              <div className="text-xs" style={{ color: '#8a8078' }}>{user.role}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
