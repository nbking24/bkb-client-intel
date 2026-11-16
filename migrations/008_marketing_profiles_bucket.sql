-- Marketing pipeline Step 4: private storage for the profile writer.
--
-- The writer reads each job's existing Marketing Project Profile from Mike's
-- FTP once, stores its content in marketing_photo_doc_state, and rebuilds the
-- .docx every run. The photos embedded in that existing profile cannot be
-- traced back to JobTread files, so they are kept here:
--   <job_id>/legacy/<n>.<ext>     images taken from the original profile
--   <job_id>/backups/<time>.docx  the profile as it was before each replace
--   <job_id>/previews/<time>.docx review copies emailed to Nathan
--
-- Private bucket: only the server (service role) reads or writes it.
--
-- Style note: no em dashes in this file.

insert into storage.buckets (id, name, public, file_size_limit)
values ('marketing-profiles', 'marketing-profiles', false, 52428800)
on conflict (id) do nothing;
