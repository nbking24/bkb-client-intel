// @ts-nocheck
/**
 * Per folder overrides for Mike's FTP, kept in agent_cache under one key.
 *
 * mode "no_job_keep_name": the folder has no JobTread job (it predates
 * JobTread). The plan, the reorg and every later run skip the job match and
 * the status check, and never rename the folder. The one time moves into
 * Photos/, Videos/ and Plans & Renderings/ still apply. `label` is the status
 * shown for it (for example "Completed").
 *
 * Shape: { folders: { "<folder name>": { mode, label, note, setBy, setAt } } }
 *
 * Style note: no em or en dashes in this file.
 */
import { getSupabase } from '@/app/api/lib/supabase';

export const OVERRIDES_KEY = 'marketing-ftp-folder-overrides';

export type FolderOverride = {
  mode: 'no_job_keep_name';
  label?: string | null;
  note?: string | null;
  setBy?: string | null;
  setAt?: string;
};

export async function getFolderOverrides(): Promise<Record<string, FolderOverride>> {
  const { data, error } = await getSupabase()
    .from('agent_cache')
    .select('data')
    .eq('key', OVERRIDES_KEY)
    .maybeSingle();
  if (error) throw new Error('Could not read folder overrides: ' + error.message);
  return data?.data?.folders || {};
}

export async function setFolderOverride(folder: string, override: FolderOverride | null) {
  const folders = await getFolderOverrides();
  if (override) folders[folder] = { ...override, setAt: new Date().toISOString() };
  else delete folders[folder];
  const { error } = await getSupabase()
    .from('agent_cache')
    .upsert({ key: OVERRIDES_KEY, data: { folders }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error('Could not save folder override: ' + error.message);
  return folders;
}
