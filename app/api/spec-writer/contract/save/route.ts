import { NextRequest, NextResponse } from 'next/server';
import { pave, updateCostGroup } from '../../../../lib/jobtread';

interface RequestBody {
  costGroupId: string;
  description: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { costGroupId, description } = body;

    if (!costGroupId) {
      return NextResponse.json(
        { error: 'costGroupId is required' },
        { status: 400 }
      );
    }

    if (description === undefined || description === null) {
      return NextResponse.json(
        { error: 'description is required' },
        { status: 400 }
      );
    }

    // Never save contract text over the Job Plan (the 📋 Project Details description).
    const g: any = await pave({ costGroup: { $: { id: costGroupId }, name: {} } });
    if (/project details/i.test(g?.costGroup?.name || '')) {
      return NextResponse.json(
        { error: 'The 📋 Project Details group holds the Job Plan and is not part of the contract, so the spec writer does not save to it.' },
        { status: 400 }
      );
    }

    await updateCostGroup(costGroupId, { description });

    return NextResponse.json({
      success: true,
      costGroupId,
      message: 'Specification saved to JobTread',
    });
  } catch (err: any) {
    console.error('Contract save API error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to save specification to JobTread' },
      { status: 500 }
    );
  }
}
