// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { getContactOpportunities } from '../lib/ghl';

export async function GET(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contactId = req.nextUrl.searchParams.get('contactId') || '';
  if (!contactId) return NextResponse.json({ opportunities: [] });

  try {
    const raw = await getContactOpportunities(contactId);

    const opportunities = raw.map((opp: any) => {
      // Extract jt_job_id from custom fields
      let jtJobId: string | null = null;
      if (opp.customFields && Array.isArray(opp.customFields)) {
        for (const cf of opp.customFields) {
          const key = (cf.fieldKey || cf.key || cf.id || '').toLowerCase();
          if (key.includes('jt_job_id') || key.includes('jt.job') || key.includes('jobtread')) {
            if (cf.value && cf.value !== '') {
              jtJobId = String(cf.value);
              break;
            }
          }
        }
      }

      return {
        id: opp.id,
        name: opp.name || 'Unnamed Opportunity',
        status: opp.status || '',
        pipelineId: opp.pipelineId || '',
        pipelineName: opp.pipelineName || opp.pipeline?.name || '',
        stageId: opp.pipelineStageId || '',
        stageName: opp.stageName || opp.stage?.name || opp.pipelineStageName || '',
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

