// @ts-nocheck
/**
 * GET /api/dashboard/bill-review/patterns
 *
 * Lists every learned bill-categorization pattern, ordered by vendor then
 * by confirm count desc. Used by /dashboard/bill-review/patterns to give
 * Nathan visibility into what the matcher has learned and a way to delete
 * patterns that learned the wrong thing.
 */
import { NextResponse } from 'next/server';
import { getSupabase } from '../../../lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('bill_categorization_patterns')
    .select('*')
    .order('vendor_name', { ascending: true, nullsFirst: false })
    .order('cost_code_number', { ascending: true })
    .order('times_confirmed', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ patterns: data || [] });
}
