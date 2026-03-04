import { NextRequest, NextResponse } from 'next/server';
import { getCostGroupsForJob, getJob } from '../../../../lib/jobtread';

interface BudgetCostItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
}

interface BudgetCostGroup {
  id: string;
  name: string;
  description: string;
  costItems: BudgetCostItem[];
}

interface BudgetSection {
  id: string;
  name: string;
  costGroups: BudgetCostGroup[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    // Fetch job info
    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Fetch all cost groups with hierarchy
    const allGroups = await getCostGroupsForJob(jobId);

    // Find the "Scope of Work" root group (contains the hammer emoji or exact name match)
    const scopeOfWorkGroup = allGroups.find(
      (g) => g.name.includes('Scope of Work') || g.name.includes('\u{1F528}')
    );

    if (!scopeOfWorkGroup) {
      return NextResponse.json(
        { error: 'Could not find "Scope of Work" cost group in this job\'s budget' },
        { status: 404 }
      );
    }

    // Build hierarchy:
    // Level 1: "Scope of Work" (root)
    // Level 2: Sections/Areas (children of Scope of Work) — these have the visibility toggle
    // Level 3: Cost groups under each section — these are where specs get written (description field)
    // Level 4: Cost items under each cost group

    // Find all groups whose parent is "Scope of Work"
    const sections = allGroups.filter(
      (g) => g.parentCostGroup?.id === scopeOfWorkGroup.id
    );

    // For each section, find cost groups whose parent is that section
    const budgetSections: BudgetSection[] = sections.map((section) => {
      const costGroups = allGroups
        .filter((g) => g.parentCostGroup?.id === section.id)
        .map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description || '',
          costItems: g.costItems.map((ci) => ({
            id: ci.id,
            name: ci.name,
            description: ci.description || '',
            quantity: ci.quantity,
            unitCost: ci.unitCost,
            unitPrice: ci.unitPrice,
          })),
        }));

      return {
        id: section.id,
        name: section.name,
        costGroups,
      };
    });

    // Also check if there are cost groups directly under Scope of Work
    // (some budgets may have cost groups directly under the root without intermediate sections)
    const directGroups = allGroups.filter(
      (g) =>
        g.parentCostGroup?.id === scopeOfWorkGroup.id &&
        !sections.some((s) => s.id === g.id) &&
        g.costItems.length > 0
    );

    if (directGroups.length > 0) {
      budgetSections.unshift({
        id: scopeOfWorkGroup.id,
        name: 'General',
        costGroups: directGroups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description || '',
          costItems: g.costItems.map((ci) => ({
            id: ci.id,
            name: ci.name,
            description: ci.description || '',
            quantity: ci.quantity,
            unitCost: ci.unitCost,
            unitPrice: ci.unitPrice,
          })),
        })),
      });
    }

    return NextResponse.json({
      jobId,
      jobName: job.name || '',
      scopeOfWorkId: scopeOfWorkGroup.id,
      sections: budgetSections,
      totalCostGroups: budgetSections.reduce((sum, s) => sum + s.costGroups.length, 0),
    });
  } catch (err: any) {
    console.error('Contract budget API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
