'use client';

import { useState, useEffect } from 'react';

// Per-user access resolved from /api/me. Drives the dynamic nav, Overview widget
// visibility, and feature gating. Cached at module scope so the layout and the
// pages that need it don't each trigger a separate fetch.

export interface MeAccess {
  id: string;
  name: string;
  initials: string;
  title: string | null;
  role: string;
  membershipId: string | null;
  email: string | null;
  dashboards: string[];
  features: string[];
  overviewWidgets: string[];
}

let cached: MeAccess | null = null;
let inflight: Promise<MeAccess | null> | null = null;

async function fetchMe(): Promise<MeAccess | null> {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('bkb-token');
  if (!token) return null;
  try {
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as MeAccess;
  } catch {
    return null;
  }
}

/** Clear the cached access (call on logout / user switch). */
export function clearAccessCache() {
  cached = null;
  inflight = null;
}

export interface UseAccessResult {
  access: MeAccess | null;
  loading: boolean;
  hasDashboard: (id: string) => boolean;
  hasFeature: (id: string) => boolean;
  hasWidget: (id: string) => boolean;
}

export function useAccess(): UseAccessResult {
  const [access, setAccess] = useState<MeAccess | null>(cached);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let alive = true;
    if (cached) {
      setAccess(cached);
      setLoading(false);
      return;
    }
    if (!inflight) inflight = fetchMe();
    inflight.then((a) => {
      cached = a;
      if (alive) {
        setAccess(a);
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, []);

  return {
    access,
    loading,
    hasDashboard: (id: string) => !!access?.dashboards?.includes(id),
    hasFeature: (id: string) => !!access?.features?.includes(id),
    hasWidget: (id: string) => !!access?.overviewWidgets?.includes(id),
  };
}
