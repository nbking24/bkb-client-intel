'use client';

import { useState, useEffect } from 'react';
import { TEAM_USERS, ROLE_CONFIG, type TeamUser, type TeamRole } from '../lib/constants';

export interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  user: TeamUser | null;
  role: TeamRole | null;
  membershipId: string | null;
  permissions: typeof ROLE_CONFIG[TeamRole] | null;
  loading: boolean;
}

function decodeToken(token: string): { pin: string; userId?: string; timestamp: string } | null {
  try {
    const decoded = atob(token);
    const parts = decoded.split(':');
    if (parts.length >= 3) {
      return { pin: parts[0], userId: parts[1], timestamp: parts[2] };
    }
    if (parts.length === 2) {
      return { pin: parts[0], timestamp: parts[1] };
    }
    return null;
  } catch {
    return null;
  }
}

function buildAuthFromToken(token: string | null): Omit<AuthState, 'loading'> {
  if (!token) {
    return { isAuthenticated: false, userId: null, user: null, role: null, membershipId: null, permissions: null };
  }
  const decoded = decodeToken(token);
  if (!decoded) {
    return { isAuthenticated: false, userId: null, user: null, role: null, membershipId: null, permissions: null };
  }
  const userId = decoded.userId || null;
  const user = userId ? TEAM_USERS[userId] || null : null;
  const role = user?.role || null;
  const membershipId = user?.membershipId || null;
  const permissions = role ? ROLE_CONFIG[role] : null;
  return { isAuthenticated: true, userId, user, role, membershipId, permissions };
}

export function useAuth(): AuthState {
  // Start with loading=true; we can't read localStorage during SSR
  const [auth, setAuth] = useState<AuthState>({
    isAuthenticated: false,
    userId: null,
    user: null,
    role: null,
    membershipId: null,
    permissions: null,
    loading: true,
  });

  useEffect(() => {
    // Read token from localStorage on mount (client-side only)
    const token = localStorage.getItem('bkb-token');
    const state = buildAuthFromToken(token);
    setAuth({ ...state, loading: false });
  }, []);

  return auth;
}

/** Get userId from token without React hook (for non-component code) */
export function getUserIdFromToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('bkb-token');
  if (!token) return null;
  const decoded = decodeToken(token);
  return decoded?.userId || null;
}
