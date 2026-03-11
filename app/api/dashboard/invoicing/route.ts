// ============================================================
// Invoicing Health Dashboard — API Route
//
// GET → Returns invoicing health data for all active jobs
//       ?cached=true → return cached result from Supabase
//       ?refresh=true → force a fresh analysis
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { buildInvoicingContext, type InvoicingFullContext } from '@/app/lib/invoicing-health';
import { createServerClient } from '@/app/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ============================================================
// Supabase Cache Helpers
// ============================================================

const CACHE_KEY = 'invoicing-health-report';

async function getCachedReport(): Promise<{ data: InvoicingFullContext; updatedAt: string } | null> {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('agent_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .single();

    if (error || !data) return null;
    return { data: data.data as InvoicingFullContext, updatedAt: data.updated_at };
  } catch (err) {
    console.error('[InvoicingAPI] Cache read error:', err);
    return null;
  }
}

async function saveCachedReport(report: InvoicingFullContext): Promise<void> {
  try {
    const supabase = createServerClient();
    await supabase
      .from('agent_cache')
      .upsert(
        {
          key: CACHE_KEY,
          data: report,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
  } catch (err) {
    console.error('[InvoicingAPI] Cache write error:', err);
  }
}

// ============================================================
// GET Handler
// ============================================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wantCached = searchParams.get('cached') === 'true';
  const forceRefresh = searchParams.get('refresh') === 'true';

  console.log(`[InvoicingAPI] GET — cached=${wantCached}, refresh=${forceRefresh}`);

  // If cached requested and not forcing refresh, try cache first
  if (wantCached && !forceRefresh) {
    const cached = await getCachedReport();
    if (cached) {
      console.log(`[InvoicingAPI] Returning cached report from ${cached.updatedAt}`);
      return NextResponse.json({
        ...cached.data,
        _cached: true,
        _cachedAt: cached.updatedAt,
      });
    }
    // No cache available — fall through to fresh analysis
    console.log('[InvoicingAPI] No cache found, running fresh analysis');
  }

  try {
    // Run fresh analysis
    const startTime = Date.now();
    const report = await buildInvoicingContext();
    const elapsed = Date.now() - startTime;

    console.log(`[InvoicingAPI] Fresh analysis complete in ${elapsed}ms`);
    console.log(`  Jobs: ${report.summary.totalOpenJobs} (${report.summary.contractJobs} contract, ${report.summary.costPlusJobs} cost-plus)`);
    console.log(`  Alerts: ${report.summary.totalAlerts}`);
    console.log(`  Health: ${report.summary.overallHealth}`);

    // Cache the result
    await saveCachedReport(report);

    return NextResponse.json({
      ...report,
      _cached: false,
      _analysisTimeMs: elapsed,
    });
  } catch (err: any) {
    console.error('[InvoicingAPI] Analysis failed:', err);
    return NextResponse.json(
      { error: 'Failed to analyze invoicing health', details: err.message },
      { status: 500 }
    );
  }
}
