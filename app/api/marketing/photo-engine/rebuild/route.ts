// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/rebuild
 *
 * Request a rebuild of a project's Word profile after images were added to or
 * removed from its folder. Body: { folder } (a top-level job folder name, for
 * example "Berntsen-Renovation"). Looks up the matching selected job by
 * folder_name (case-insensitive) and, if found, inserts a marketing_photo_runs
 * row (trigger 'rebuild', status 'queued', email_status 'draft'). The
 * Cowork/Claude task polls for queued rows and does the actual regeneration.
 * This route only records the request.
 *
 * Owner/admin only.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { validateAuth } from '@/app/api/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['owner', 'admin'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const folder = typeof body?.folder === 'string' ? body.folder.trim() : '';
  if (!folder) return NextResponse.json({ error: 'folder required' }, { status: 400 });

  const supabase = getSupabase();

  // Match the selected job by folder name, case-insensitive.
  const { data: selection } = await supabase
    .from('marketing_photo_selected_jobs')
    .select('job_id, job_number, job_name, folder_name, included')
    .ilike('folder_name', folder)
    .maybeSingle();

  if (!selection) {
    return NextResponse.json(
      { error: 'No selected job matches this folder' },
      { status: 404 }
    );
  }

  const { data: inserted, error } = await supabase
    .from('marketing_photo_runs')
    .insert({
      job_id: selection.job_id,
      job_number: selection.job_number || null,
      job_name: selection.job_name || null,
      folder_name: selection.folder_name || null,
      trigger: 'rebuild',
      status: 'queued',
      email_status: 'draft',
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, run: inserted });
}
