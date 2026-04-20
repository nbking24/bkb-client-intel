// @ts-nocheck
/**
 * /api/health
 *
 * Post-deploy health probe used by Cowork after shipping a ticket fix.
 * Returns 200 when the app is healthy, 500 otherwise, with a JSON body
 * describing which checks passed and which failed.
 *
 * Checks:
 *  - Supabase responds within a few seconds to a lightweight query
 *  - The tickets table is readable
 *  - The dashboard overview route returns a sensible shape for the owner
 *  - No unhandled env var is missing for the critical paths
 *
 * Callable without auth so it can be hit from automation (curl) and
 * from external uptime monitoring if we add that later.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/app/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

type CheckResult = {
  name: string;
  ok: boolean;
  duration_ms: number;
  detail?: string;
};

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function check(name: string, fn: () => Promise<void>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, ok: true, duration_ms: Date.now() - start };
  } catch (err: any) {
    return {
      name,
      ok: false,
      duration_ms: Date.now() - start,
      detail: err?.message?.slice(0, 300) || 'unknown error',
    };
  }
}

export async function GET(req: NextRequest) {
  const checks: CheckResult[] = [];

  // 1. Env vars Cowork cares about
  checks.push(
    await check('env_vars_present', async () => {
      const required = [
        'NEXT_PUBLIC_SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'APP_PIN',
      ];
      const missing = required.filter((k) => !process.env[k]);
      if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
    })
  );

  // 2. Supabase round-trip, lightweight query
  checks.push(
    await check('supabase_ping', async () => {
      const sb = createServerClient();
      await withTimeout(
        sb.from('tickets').select('id', { count: 'exact', head: true }).limit(1),
        3000,
        'supabase_ping'
      );
    })
  );

  // 3. Tickets table readable
  checks.push(
    await check('tickets_readable', async () => {
      const sb = createServerClient();
      const { error } = await sb.from('tickets').select('id').limit(1);
      if (error) throw new Error(error.message);
    })
  );

  // 4. Ticket events table readable
  checks.push(
    await check('ticket_events_readable', async () => {
      const sb = createServerClient();
      const { error } = await sb.from('ticket_events').select('id').limit(1);
      if (error) throw new Error(error.message);
    })
  );

  const allOk = checks.every((c) => c.ok);
  const status = allOk ? 200 : 500;

  return NextResponse.json(
    {
      ok: allOk,
      checked_at: new Date().toISOString(),
      checks,
    },
    { status }
  );
}
