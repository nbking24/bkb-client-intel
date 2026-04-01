// @ts-nocheck
/**
 * POST /api/upload
 *
 * Accepts multipart form data with image files, stores them in Supabase Storage,
 * and returns public URLs. Used by the field dashboard for change order photo uploads.
 *
 * The public URLs can then be passed to JobTread's upload API to attach to budget items.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { createServerClient } from '@/app/lib/supabase';

const BUCKET = 'co-photos';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_FILES = 10;
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
];

/**
 * Ensure the storage bucket exists (creates on first use).
 */
async function ensureBucket(sb: ReturnType<typeof createServerClient>) {
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b: any) => b.name === BUCKET)) {
    await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_FILE_SIZE });
  }
}

export async function POST(req: NextRequest) {
  // Auth check
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Maximum ${MAX_FILES} files per upload` }, { status: 400 });
    }

    const sb = createServerClient();
    await ensureBucket(sb);

    const results: Array<{ name: string; url: string; size: number }> = [];
    const errors: Array<{ name: string; error: string }> = [];

    for (const file of files) {
      // Validate type
      if (!ALLOWED_TYPES.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|heic|heif|pdf|doc|docx|xls|xlsx|txt|csv)$/i)) {
        errors.push({ name: file.name, error: 'Unsupported file type' });
        continue;
      }

      // Validate size
      if (file.size > MAX_FILE_SIZE) {
        errors.push({ name: file.name, error: 'File too large (max 10MB)' });
        continue;
      }

      // Generate unique path: userId/timestamp-originalname
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${auth.userId}/${timestamp}-${safeName}`;

      const buffer = Buffer.from(await file.arrayBuffer());
      const { data, error } = await sb.storage
        .from(BUCKET)
        .upload(path, buffer, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });

      if (error) {
        errors.push({ name: file.name, error: error.message });
        continue;
      }

      // Get public URL
      const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(data.path);
      results.push({
        name: file.name,
        url: urlData.publicUrl,
        size: file.size,
      });
    }

    return NextResponse.json({
      success: true,
      uploaded: results,
      errors: errors.length > 0 ? errors : undefined,
      count: results.length,
    });
  } catch (err: any) {
    console.error('[upload] Error:', err?.message);
    return NextResponse.json({ error: 'Upload failed: ' + (err?.message || 'Unknown error') }, { status: 500 });
  }
}
