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

type Step = 'select-user' | 'enter-pin' | 'create-pin' | 'confirm-pin';

export default function DashboardLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('select-user');
  const [selectedUser, setSelectedUser] = useState<typeof LOGIN_USERS[0] | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const selectUser = async (user: typeof LOGIN_USERS[0]) => {
    setSelectedUser(user);
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, check: true }),
      });
      const data = await res.json();
      if (data.hasPin) {
        setStep('enter-pin');
      } else {
        setStep('create-pin');
      }
    } catch {
      setErr('Connection error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async () => {
    if (!pin.trim() || !selectedUser) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || 'Invalid PIN');
        setPin('');
        return;
      }
      localStorage.setItem('bkb-token', data.token);
      router.push('/dashboard');
    } catch {
      setErr('Connection error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitNewPin = () => {
    if (!newPin || newPin.length < 4) {
      setErr('PIN must be at least 4 digits');
      return;
    }
    setErr('');
    setStep('confirm-pin');
  };

  const confirmAndSavePin = async () => {
    if (confirmPin !== newPin) {
      setErr('PINs do not match. Try again.');
      setConfirmPin('');
      return;
    }
    if (!selectedUser) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, pin: newPin, setup: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || 'Failed to create PIN');
        return;
      }
      localStorage.setItem('bkb-token', data.token);
      router.push('/dashboard');
    } catch {
      setErr('Connection error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setStep('select-user');
    setSelectedUser(null);
    setPin('');
    setNewPin('');
    setConfirmPin('');
    setErr('');
  };

  const inputStyle = {
    background: '#242424',
    border: '1px solid rgba(205,162,116,0.12)',
    color: '#e8e0d8',
  };

  // Step 1: Select User
  if (step === 'select-user') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: '#141414' }}>
        <img src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png" alt="BKB" className="h-16 w-auto mb-6" />
        <h1 className="text-xl mb-1" style={{ color: '#CDA274', fontFamily: 'Georgia, serif' }}>Operations Platform</h1>
        <p className="text-sm mb-8" style={{ color: '#8a8078' }}>Who are you?</p>
        <div className="w-full max-w-sm space-y-3">
          {LOGIN_USERS.map(user => (
            <button
              key={user.id}
              onClick={() => selectUser(user)}
              disabled={busy}
              className="w-full flex items-center gap-4 px-4 py-3.5 rounded-lg transition-all disabled:opacity-50"
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
        {busy && <p className="text-sm mt-4" style={{ color: '#8a8078' }}>Checking...</p>}
        {err && <p className="text-sm mt-4" style={{ color: '#c45c4c' }}>{err}</p>}
      </div>
    );
  }

  // Step 2: Enter existing PIN
  if (step === 'enter-pin' && selectedUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: '#141414' }}>
        <img src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png" alt="BKB" className="h-16 w-auto mb-6" />
        <h1 className="text-xl mb-1" style={{ color: '#CDA274', fontFamily: 'Georgia, serif' }}>Welcome back, {selectedUser.name.split(' ')[0]}</h1>
        <p className="text-sm mb-8" style={{ color: '#8a8078' }}>Enter your PIN</p>
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
            style={inputStyle}
          />
          {err && <p className="text-center text-sm" style={{ color: '#c45c4c' }}>{err}</p>}
          <button
            onClick={submitPin}
            disabled={!pin.trim() || busy}
            className="w-full py-4 rounded-lg font-semibold disabled:opacity-30"
            style={{ background: '#CDA274', color: '#1a1a1a' }}
          >
            {busy ? 'Signing in...' : 'Sign In'}
          </button>
          <button
            onClick={goBack}
            className="w-full py-2 text-sm rounded-lg"
            style={{ color: '#8a8078' }}
          >
            Not {selectedUser.name.split(' ')[0]}? Go back
          </button>
        </div>
      </div>
    );
  }

  // Step 3: Create new PIN
  if (step === 'create-pin' && selectedUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: '#141414' }}>
        <img src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png" alt="BKB" className="h-16 w-auto mb-6" />
        <h1 className="text-xl mb-1" style={{ color: '#CDA274', fontFamily: 'Georgia, serif' }}>Hi, {selectedUser.name.split(' ')[0]}!</h1>
        <p className="text-sm mb-8" style={{ color: '#8a8078' }}>Create a PIN to secure your account</p>
        <div className="w-full max-w-xs space-y-4">
          <input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={e => setNewPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitNewPin()}
            placeholder="Choose a PIN (4+ digits)"
            autoFocus
            maxLength={10}
            className="w-full px-4 py-4 rounded-lg text-center text-2xl tracking-widest outline-none"
            style={inputStyle}
          />
          {err && <p className="text-center text-sm" style={{ color: '#c45c4c' }}>{err}</p>}
          <button
            onClick={submitNewPin}
            disabled={!newPin || newPin.length < 4}
            className="w-full py-4 rounded-lg font-semibold disabled:opacity-30"
            style={{ background: '#CDA274', color: '#1a1a1a' }}
          >
            Next
          </button>
          <button
            onClick={goBack}
            className="w-full py-2 text-sm rounded-lg"
            style={{ color: '#8a8078' }}
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  // Step 4: Confirm new PIN
  if (step === 'confirm-pin' && selectedUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: '#141414' }}>
        <img src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png" alt="BKB" className="h-16 w-auto mb-6" />
        <h1 className="text-xl mb-1" style={{ color: '#CDA274', fontFamily: 'Georgia, serif' }}>Confirm your PIN</h1>
        <p className="text-sm mb-8" style={{ color: '#8a8078' }}>Enter it one more time</p>
        <div className="w-full max-w-xs space-y-4">
          <input
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={e => setConfirmPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmAndSavePin()}
            placeholder="••••"
            autoFocus
            maxLength={10}
            className="w-full px-4 py-4 rounded-lg text-center text-2xl tracking-widest outline-none"
            style={inputStyle}
          />
          {err && <p className="text-center text-sm" style={{ color: '#c45c4c' }}>{err}</p>}
          <button
            onClick={confirmAndSavePin}
            disabled={!confirmPin || busy}
            className="w-full py-4 rounded-lg font-semibold disabled:opacity-30"
            style={{ background: '#CDA274', color: '#1a1a1a' }}
          >
            {busy ? 'Setting up...' : 'Create PIN & Sign In'}
          </button>
          <button
            onClick={() => { setStep('create-pin'); setConfirmPin(''); setErr(''); }}
            className="w-full py-2 text-sm rounded-lg"
            style={{ color: '#8a8078' }}
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  return null;
}
