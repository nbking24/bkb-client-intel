import { NextRequest, NextResponse } from 'next/server';
import { buildUserDashboardData } from '@/app/lib/dashboard-data';
import { analyzeUserDashboard, type DashboardAnalysis } from '@/app/lib/dashboard-analysis';
import { createServerClient } from '@/app/lib/supabase';

export const maxDuration = 60;

const CACHE_PREFIX = 'dashboard-overview-';

async function getCachedAnalysis(userId: string) {
  try {
    const supabase = createServerClient();
    const { data } = await supabase
      .from('agent_cache')
      .select('data, updated_at')
      .eq('key', `${CACHE_PREFIX}${userId}`)
      .single();
    return data;
  } catch {
    return null;
  }
}

async function saveCachedAnalysis(userId: string, analysis: any) {
  try {
    const supabase = createServerClient();
    await supabase
      .from('agent_cache')
      .upsert({
        key: `${CACHE_PREFIX}${userId}`,
        data: analysis,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
  } catch (err: any) {
    console.error('[DashboardOverview] Cache save failed:', err.message);
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    const cached = req.nextUrl.searchParams.get('cached') === 'true';
    const refresh = req.nextUrl.searchParams.get('refresh') === 'true';

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Try cache first (unless refresh forced)
    if (cached && !refresh) {
      const cachedData = await getCachedAnalysis(userId);
      if (cachedData) {
        return NextResponse.json({
          ...cachedData.data,
          _cached: true,
          _cachedAt: cachedData.updated_at,
        });
      }
    }

    // Build fresh analysis
    const startTime = Date.now();
    const dashboardData = await buildUserDashboardData(userId);
    const analysis: DashboardAnalysis = await analyzeUserDashboard(dashboardData);

    const result = {
      analysis,
      data: dashboardData,
      generatedAt: new Date().toISOString(),
    };

    // Save to cache
    await saveCachedAnalysis(userId, result);

    return NextResponse.json({
      ...result,
      _cached: false,
      _analysisTimeMs: Date.now() - startTime,
    });
  } catch (err: any) {
    console.error('[DashboardOverview] Error:', err);
    return NextResponse.json({ error: err.message || 'Analysis failed' }, { status: 500 });
  }
}
