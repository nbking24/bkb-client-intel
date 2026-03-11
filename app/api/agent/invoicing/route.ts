// ============================================================
// Invoicing Health Agent — Analysis Endpoint
//
// GET → Run invoicing health analysis with Claude assessment
//       Returns structured recommendations + summary
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { buildInvoicingContext, type InvoicingFullContext } from '@/app/lib/invoicing-health';
import { createServerClient } from '@/app/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 120; // Allow up to 2 min for full agent analysis

// ============================================================
// Types
// ============================================================

interface InvoicingAgentReport {
  generatedAt: string;
  summary: string;
  recommendations: AgentRecommendation[];
  invoicingData: InvoicingFullContext;
}

interface AgentRecommendation {
  action: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  jobName: string;
  category: 'contract' | 'cost_plus' | 'billable' | 'general';
}

// ============================================================
// Cache Helpers
// ============================================================

const CACHE_KEY = 'invoicing-agent-report';

async function getCachedAgentReport(): Promise<InvoicingAgentReport | null> {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('agent_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .single();

    if (error || !data) return null;
    return data.data as InvoicingAgentReport;
  } catch {
    return null;
  }
}

async function saveCachedAgentReport(report: InvoicingAgentReport): Promise<void> {
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
    console.error('[InvoicingAgent] Cache write error:', err);
  }
}

// ============================================================
// Claude Analysis
// ============================================================

async function runClaudeAnalysis(context: InvoicingFullContext): Promise<{
  summary: string;
  recommendations: AgentRecommendation[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[InvoicingAgent] No ANTHROPIC_API_KEY — returning raw data only');
    return {
      summary: `Invoicing overview: ${context.summary.totalOpenJobs} open jobs (${context.summary.contractJobs} contract, ${context.summary.costPlusJobs} cost-plus). ${context.summary.totalAlerts} alerts. Overall health: ${context.summary.overallHealth}.`,
      recommendations: [],
    };
  }

  // Build a concise prompt with the invoicing data
  const contractSummary = context.contractJobs.map((j) =>
    `- ${j.jobName} (${j.clientName}): health=${j.health}, scheduleProgress=${Math.round(j.scheduleProgress * 100)}%, approvedInvoices=${j.invoicedToDate}, draftInvoices=${j.draftInvoices.length}, overdueMilestones=${j.overdueMilestones.length}${j.alerts.length > 0 ? `, alerts: ${j.alerts.join('; ')}` : ''}`
  ).join('\n');

  const cpSummary = context.costPlusJobs.map((j) =>
    `- ${j.jobName} (${j.clientName}): health=${j.health}, daysSinceInvoice=${j.daysSinceLastInvoice ?? 'never'}, unbilledAmount=$${j.unbilledAmount}, unbilledHours=${j.unbilledHours}h${j.alerts.length > 0 ? `, alerts: ${j.alerts.join('; ')}` : ''}`
  ).join('\n');

  const billableSummary = context.billableItems.map((j) =>
    `- ${j.jobName}: $${j.totalUninvoicedAmount} uninvoiced, ${j.totalUninvoicedHours}h unbilled`
  ).join('\n');

  const prompt = `You are BKB's invoicing health analyst. Analyze this invoicing data and provide:
1. A 2-3 sentence executive summary of the current invoicing health across all jobs.
2. A prioritized list of specific, actionable recommendations (max 8).

DATA:

CONTRACT (FIXED-PRICE) JOBS:
${contractSummary || 'None detected'}

COST PLUS JOBS (14-day billing cadence):
${cpSummary || 'None detected'}

BILLABLE ITEMS PENDING:
${billableSummary || 'None'}

GLOBAL ALERTS:
${context.alerts.slice(0, 15).join('\n') || 'None'}

RULES:
- Cost Plus jobs should be invoiced every 14 days (biweekly Friday)
- Payment milestones on contract jobs use $ prefix in task names
- Cost Code 23 = billable labor items
- Flag any job that has unbilled amounts over $500 as high priority
- Flag any Cost Plus job over 14 days since last invoice as high priority

Return ONLY a JSON object:
{
  "summary": "...",
  "recommendations": [
    {
      "action": "short action title",
      "description": "specific detail about what to do",
      "priority": "high|medium|low",
      "jobName": "job name this applies to",
      "category": "contract|cost_plus|billable|general"
    }
  ]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[InvoicingAgent] Claude API error ${res.status}: ${errText.slice(0, 300)}`);
    return {
      summary: `Analysis unavailable. Raw data: ${context.summary.totalAlerts} alerts across ${context.summary.totalOpenJobs} jobs.`,
      recommendations: [],
    };
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  try {
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      summary: parsed.summary || '',
      recommendations: (parsed.recommendations || []).slice(0, 8),
    };
  } catch {
    console.error('[InvoicingAgent] Failed to parse Claude response');
    return {
      summary: text.slice(0, 500),
      recommendations: [],
    };
  }
}

// ============================================================
// GET Handler
// ============================================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wantCached = searchParams.get('cached') === 'true';

  if (wantCached) {
    const cached = await getCachedAgentReport();
    if (cached) {
      return NextResponse.json({ ...cached, _cached: true });
    }
  }

  try {
    console.log('[InvoicingAgent] Starting fresh analysis...');
    const startTime = Date.now();

    // 1. Gather invoicing data
    const invoicingData = await buildInvoicingContext();

    // 2. Run Claude analysis
    const { summary, recommendations } = await runClaudeAnalysis(invoicingData);

    const report: InvoicingAgentReport = {
      generatedAt: new Date().toISOString(),
      summary,
      recommendations,
      invoicingData,
    };

    // 3. Cache results
    await saveCachedAgentReport(report);

    const elapsed = Date.now() - startTime;
    console.log(`[InvoicingAgent] Analysis complete in ${elapsed}ms — ${recommendations.length} recommendations`);

    return NextResponse.json({
      ...report,
      _cached: false,
      _analysisTimeMs: elapsed,
    });
  } catch (err: any) {
    console.error('[InvoicingAgent] Analysis failed:', err);
    return NextResponse.json(
      { error: 'Invoicing agent analysis failed', details: err.message },
      { status: 500 }
    );
  }
}
