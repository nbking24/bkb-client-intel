// @ts-nocheck
/**
 * On-demand AI cost analysis for the Job Costing detail view.
 *
 *   POST /api/dashboard/job-costing/ai-analysis
 *     body: { detail: <JobDetail response from the detail endpoint> }
 *     → { analysis: string }
 *
 * The detail endpoint no longer runs the AI on every load. The client
 * holds the analysis in component state and only fires this endpoint
 * when the user clicks "Run AI Analysis" — so a job can be opened,
 * % overrides tweaked, and a fresh analysis pulled once at the end
 * instead of on every keystroke / load.
 *
 * Same prompt as the inline version used to be (kept in lockstep so
 * future tweaks happen here only).
 */
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export async function POST(req: Request) {
  try {
    const { detail } = await req.json();
    if (!detail || typeof detail !== 'object') {
      return NextResponse.json({ error: 'detail is required' }, { status: 400 });
    }
    const job = detail.job || {};
    const fs = detail.financialSummary || {};
    const ta = detail.timeAnalysis || {};
    const bd = (detail.costCodeBreakdown || []) as any[];

    const isCostPlus = !!fs.isCostPlus;
    const isCompleted = !!job.isCompleted;

    const totalEstimatedPrice = Number(fs.estimatedPrice) || 0;
    const totalEstimatedCost = Number(fs.estimatedCost) || 0;
    const totalActualCost = Number(fs.actualCost) || 0;
    const totalPendingCost = Number(fs.pendingCost) || 0;
    const totalCommitted = Number(fs.totalCosts) || (totalActualCost + totalPendingCost);
    const collectedAmount = Number(fs.collectedAmount) || 0;
    const contractTotal = Number(fs.contractPrice) || totalEstimatedPrice;
    const invoicedTotal = Number(fs.invoicedAmount) || 0;
    const margin = Number(fs.margin) || 0;
    const marginPct = Number(fs.marginPct) || 0;

    const estimatedLaborHours = Number(ta.estimatedHours) || 0;
    const totalWorkHours = Number(ta.actualWorkHours) || 0;
    const totalTravelHours = Number(ta.actualTravelHours) || 0;
    const totalBreakHours = Number(ta.actualBreakHours) || 0;
    const totalActualHrs = totalWorkHours + totalTravelHours + totalBreakHours;

    const effectiveProgress = fs.effectiveProgress != null ? fs.effectiveProgress : fs.scheduleProgress || 0;
    const progressSource = fs.progressSource || 'schedule';
    const manualSetBy = fs.manualSetBy || null;
    const manualNotes = fs.manualNotes || null;
    const scheduleProgress = Number(fs.scheduleProgress) || 0;

    // The detail endpoint doesn't return raw task counts so synthesize a
    // best-effort string. The exact ratio matters less than the % anyway.
    const scheduleDetail = `${scheduleProgress}% schedule`;

    const overBudgetCodes = bd
      .filter((c) => c.status === 'over' || c.status === 'watch')
      .map((c) => `${c.costCodeName}: est $${fmt(c.estimatedCost)}, actual $${fmt(c.actualCost)} (${c.pctUsed}%)`)
      .join('\n');

    const zeroCodes = bd
      .filter((c) => c.estimatedCost > 500 && c.actualCost === 0)
      .map((c) => `${c.costCodeName}: $${fmt(c.estimatedCost)} budgeted, $0 actual`)
      .join('\n');

    const cccComplete = bd
      .filter((c) => c.manualPercentComplete === 100)
      .map((c) => `${c.costCodeName}: 100% complete, $${fmt(c.actualCost)} actual vs $${fmt(c.estimatedCost)} budgeted${c.actualCost - c.estimatedCost !== 0 ? ` (variance $${fmt(c.actualCost - c.estimatedCost)})` : ''}`)
      .join('\n');
    const cccInProgress = bd
      .filter((c) => c.manualPercentComplete != null && c.manualPercentComplete < 100)
      .map((c) => {
        const pct = c.manualPercentComplete;
        const forecast = pct > 0 ? Math.round(c.actualCost / (pct / 100)) : 0;
        const forecastNote = pct > 0
          ? ` — at this rate forecast final $${fmt(forecast)} (vs $${fmt(c.estimatedCost)} budget)`
          : '';
        return `${c.costCodeName}: ${pct}% complete, $${fmt(c.actualCost)} actual on $${fmt(c.estimatedCost)} budget${forecastNote}`;
      })
      .join('\n');

    const costPlusNote = isCostPlus
      ? `\nNOTE: This is a COST-PLUS job. There is no fixed contract price. The client is billed for actual costs plus a markup/fee. Margin = Collected - Actual Costs. Focus on whether collections are keeping pace with spending, not on estimated price (which is $0 for cost-plus).`
      : '';

    const completedNote = isCompleted
      ? `\nIMPORTANT: This project is SUBSTANTIALLY COMPLETE (status: "${job?.customStatus || 'Closed'}"). The construction work is done. Any remaining costs are final billing items (retention, punch-list, final invoices from subs/vendors). Treat all numbers as FINAL figures, not projections. Use "final margin" instead of "projected margin." Flag any pending bills/POs that still need to be closed out. Evaluate the overall job profitability as a completed project — what went well, what lessons can be applied to future jobs.`
      : '';

    const prompt = `You are a construction job costing analyst for Brett King Builder, a high-end residential renovation company in the Philadelphia area.

Analyze this job's financial health and provide a concise executive summary.

JOB: ${job?.name || 'Unknown'} (${job?.clientName || ''})
TYPE: ${isCostPlus ? 'Cost-Plus' : 'Fixed Price'}${costPlusNote}${completedNote}
STATUS: ${isCompleted ? 'PROJECT COMPLETE' : 'In Progress'} (JobTread status: ${job?.customStatus || 'N/A'})

FINANCIAL OVERVIEW:
- Contract Price (what client pays): $${fmt(totalEstimatedPrice)}
- Internal Cost Budget: $${fmt(totalEstimatedCost)}
- Paid Costs (approved bills/POs + labor): $${fmt(totalActualCost)}
- Pending Costs (draft/pending bills/POs): $${fmt(totalPendingCost)}
- Total Costs (paid + pending): $${fmt(totalCommitted)}
${isCostPlus ? `- Collected from Client: $${fmt(collectedAmount)}` : `- Contract Value: $${fmt(contractTotal)}`}
- ${isCostPlus ? 'Profit (Collected - Total Costs)' : 'Margin (Contract - Total Costs)'}: $${fmt(margin)} (${marginPct.toFixed(1)}%)
- Invoiced: $${fmt(invoicedTotal)}

LABOR:
- Estimated Hours: ${estimatedLaborHours}
- Actual Hours: ${totalActualHrs.toFixed(1)} (work: ${totalWorkHours.toFixed(1)}, travel: ${totalTravelHours.toFixed(1)})

PROGRESS: ${effectiveProgress}% complete${progressSource === 'manual'
  ? ` (manual override${manualSetBy ? ' set by ' + manualSetBy : ''}${manualNotes ? '; notes: ' + manualNotes : ''})`
  : ` (${scheduleDetail})`}

${overBudgetCodes ? `COST CODES OVER/NEAR BUDGET:\n${overBudgetCodes}` : 'All cost codes within budget.'}

${zeroCodes ? `UPCOMING COSTS (budgeted but no spend yet):\n${zeroCodes}` : ''}

${cccComplete ? `CATEGORIES MARKED COMPLETE (final numbers — variance is FINAL, not a forecast):\n${cccComplete}` : ''}

${cccInProgress ? `CATEGORIES WITH PARTIAL PROGRESS SET (use the forecast to project final spend; flag any where forecast exceeds budget):\n${cccInProgress}` : ''}

Provide:
${isCompleted ? `1. A 2-3 sentence final assessment of the job's profitability and performance
2. Top 2-3 specific wins or lessons learned (with dollar amounts)
3. One actionable item — either a closeout task (pending bills to resolve, final invoicing) or a lesson for future jobs
4. If there are pending/draft vendor bills or POs, flag them as items needing resolution before the job can be fully closed out` :
`1. A 2-3 sentence executive summary of the job's financial health
2. Top 2-3 specific areas of concern or strength (with dollar amounts)
3. One actionable recommendation`}

Keep it direct and practical — this is for a construction project manager. Use plain language, no jargon. No markdown formatting — use plain text only. Total response under 200 words.`;

    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const analysis = response.content?.[0]?.type === 'text' ? response.content[0].text : '';

    return NextResponse.json({ analysis });
  } catch (err: any) {
    console.error('[job-costing/ai-analysis] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'AI analysis failed' }, { status: 500 });
  }
}
