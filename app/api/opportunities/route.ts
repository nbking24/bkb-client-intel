// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { getContactOpportunities, getPipelines } from '../lib/ghl';

// Known GHL custom field ID for "JT Job ID"
const JT_JOB_ID_FIELD = 'GjwWvbGyh7CQfGmFir5p';

export async function GET(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contactId = req.nextUrl.searchParams.get('contactId') || '';
  if (!contactId) return NextResponse.json({ opportunities: [] });

  try {
    // Fetch opportunities and pipelines in parallel
    const [raw, pipelines] = await Promise.all([
      getContactOpportunities(contactId),
      getPipelines(),
    ]);

    // Build lookup maps for pipeline and stage names
    const pipelineMap: Record<string, string> = {};
    const stageMap: Record<string, string> = {};
    for (const p of pipelines) {
      pipelineMap[p.id] = p.name || '';
      if (p.stages && Array.isArray(p.stages)) {
        for (const s of p.stages) {
          stageMap[s.id] = s.name || '';
        }
      }
    }

    const opportunities = raw.map((opp: any) => {
      // Extract jt_job_id from custom fields
      // GHL search returns: { id: "fieldId", fieldValueString: "value" }
      let jtJobId: string | null = null;
      if (opp.customFields && Array.isArray(opp.customFields)) {
        for (const cf of opp.customFields) {
          // Match by known field ID or by fieldKey pattern
          const fieldId = cf.id || '';
          const fieldKey = (cf.fieldKey || cf.key || '').toLowerCase();
          const isJtField = fieldId === JT_JOB_ID_FIELD
            || fieldKey.includes('jt_job_id')
            || fieldKey.includes('jobtread');

          if (isJtField) {
            // GHL search uses fieldValueString; detail endpoint uses value
            const val = cf.fieldValueString || cf.value || '';
            if (val !== '') {
              jtJobId = String(val);
              break;
            }
          }
        }
      }

      // Resolve pipeline and stage names from lookup maps
      const pipeId = opp.pipelineId || '';
      const stageId = opp.pipelineStageId || '';

      return {
        id: opp.id,
        name: opp.name || 'Unnamed Opportunity',
        status: opp.status || '',
        pipelineId: pipeId,
        pipelineName: pipelineMap[pipeId] || '',
        stageId: stageId,
        stageName: stageMap[stageId] || '',
        monetaryValue: opp.monetaryValue || 0,
        jtJobId,
      };
    });

    return NextResponse.json({ opportunities });
  } catch (err) {
    console.error('Opportunities search error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
