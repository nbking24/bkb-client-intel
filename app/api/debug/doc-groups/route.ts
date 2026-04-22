// @ts-nocheck
// Temporary diagnostic: read a document's cost groups including descriptions.
// Remove after verifying billable CO formatting fix on Bartholomew CO #110.
import { NextRequest, NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';

export async function GET(req: NextRequest) {
  const documentId = req.nextUrl.searchParams.get('documentId') || '';
  if (!documentId) {
    return NextResponse.json({ error: 'documentId required' }, { status: 400 });
  }
  const data = await pave({
    document: {
      $: { id: documentId },
      costGroups: {
        nodes: {
          id: {},
          name: {},
          description: {},
          parentCostGroup: { name: {} },
        },
      },
    },
  });
  const groups = ((data as any)?.document?.costGroups?.nodes || []).map((g: any) => ({
    name: g.name,
    parent: g.parentCostGroup?.name || null,
    description: g.description || '',
  }));
  return NextResponse.json({ documentId, groupCount: groups.length, groups });
}
