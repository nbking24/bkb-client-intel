import { NextRequest, NextResponse } from 'next/server';
import { updateCostGroup } from '../../../../lib/jobtread';

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

    const result = await updateCostGroup(costGroupId, { description });

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
