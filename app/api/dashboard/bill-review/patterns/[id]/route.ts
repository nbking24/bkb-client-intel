// @ts-nocheck
/**
 * DELETE /api/dashboard/bill-review/patterns/[id]
 *
 * Deletes a single learned pattern row. Used by the Pattern Library page so
 * Nathan can prune a pattern that learned the wrong thing — the next
 * scan will fall back to the cost-code matcher / vendor history for that
 * (vendor, cc, sub) until a fresh approval seeds a new pattern.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/supabase';

export const runtime = 'nodejs';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('bill_categorization_patterns')
    .delete()
    .eq('id', params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
