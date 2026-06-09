import { createClient } from '@supabase/supabase-js';

// Client-side Supabase client (uses anon key, respects RLS)
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase env vars. Check .env.local');
  }

  return createClient(url, key);
}

// Server-side Supabase client (uses service role, bypasses RLS).
// NOTE: Next.js caches GET fetches even on `force-dynamic` routes, which made
// /api/me return stale access (new dashboards not showing up). Force every
// server query through an uncached fetch so DB writes are reflected immediately.
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase server env vars. Check .env.local');
  }

  return createClient(url, key, {
    global: {
      fetch: (input: any, init?: any) => fetch(input, { ...(init || {}), cache: 'no-store' }),
    },
  });
}
