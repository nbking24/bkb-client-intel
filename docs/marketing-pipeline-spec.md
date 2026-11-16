# BKB Marketing Pipeline (Mike at Lighthouse Digital), rebuild spec

Written 2026-11-16 from the two live profiles on the FTP (Henschel-Renovation, Marrero-Kitchen Addition), the FTP folder screenshots Nathan sent, the Hub photo engine tables, and Henschel's labeled JobTread photos. The original Cowork task and the photo labeling skill were lost (Mac task instructions blank, skill not found). This doc is the source of truth for the rebuild.

Repo copy of `claude/BKB-Marketing-Pipeline-Spec.md` from the Claude project. Keep both in step when a decision changes.

## Where it runs

Inside the BKB Hub (Vercel cron plus the Hub's own Claude API key), not on Nathan's Claude plan and not on any computer. The Hub already holds the FTP login (env MARKETING_FTP_*, root folder `BKB Review` on Mike's FTP), sends email as Nathan (Resend), runs the nightly change detector (`/api/cron/marketing-photo-detect`), and stores profile history (`marketing_photo_doc_state`, `marketing_photo_assets`, `marketing_photo_runs`, `marketing_photo_selected_jobs`, `marketing_photo_settings`).

Hub login tokens are now signed and verified (fixed 2026-11-16).

The photo labeler runs as a DataX agent instead of in the Hub (Nathan, 2026-11-16, already paid for): "JobTread Photo Labeler", id GBx5QiVlbK7b1RrlJ3It.

## Three parts

1. **Photo labeler** (DataX agent, every 4 hours during backfill, then nightly). Every image on an open job with no description gets a description and tags. Camera default names (`IMG_####`, `annotation_...`) are also renamed; names a person gave on upload are kept. A description marks the file done.
2. **Marketing profile writer.** Builds or updates each job's Word profile in the format below.
3. **Friday run** (weekly, about 2am ET). For each job flagged by the detector: choose new photos, videos and plans, copy them server side from JobTread to the FTP, update the profile, record everything, email Mike.

## 1. Photo labeler rules (reconstructed from labeled Henschel photos, Sept 2026)

- Name: `<Area> - <What it shows> - <YYYY-MM-DD>` using the photo's taken or upload date. Area is a room or zone: Exterior, Interior, Kitchen, Bathroom, Living Room, Addition, Basement, and so on. Example: `Exterior - Covered Porch Rafter Framing and Gable - 2026-09-02`.
- Description: one or two plain sentences of what is visible, naming materials and products when legible (Marvin windows, Blueskin VP100, slate roof), the stage of work, and people only by trade ("carpenter on a ladder"). No client names, no guesses.
- Tags (JobTread file tags): one phase tag and one area tag.
  - Phase: `01. Pre-construction` (22P5SRxXqzTW, existing conditions), `02. Project Start` (22P5YhhQb4ti), `05. Rough-In / MEP` (22P5xMGwU3dh), `03. In-Progress` (22P5SRxXqzTR), `06. Finish` (22P5SRxXqzTY).
  - Area: `10. Exterior` (22P5YhnCPeRV), `11. Living Space` (22P5SRxXqzTX), `13. Kitchen` (22P5YhfRyh8U), `13. Bathroom` (22P5YhRKcGAm).
  - Leave existing tags in place (add, never remove). Do not apply `X. Vendor` (the old skill did; it is wrong for site photos).
- Skip: files already carrying a descriptive name, screenshots of documents, receipts, and plan sheets (tag those `Documents/Plans` only).
- One-time backfill: every unlabeled photo on open jobs uploaded since 2026-09-03.

## 2. FTP structure (Nathan's decision 2026-11-16)

```
BKB Review/
  <Last>-<Job Name> (<Status>)/
    <Last>-<Job Name> Marketing Profile.docx
    Photos/
    Plans & Renderings/
    Videos/
```

- Folder name, then the status in parentheses (Nathan 2026-11-16):
  - If the JobTread job name already contains a dash, collapse each ` - ` to `-` and stop (`Johnson - 4 Season Room` to `Johnson-4 Season Room`, `Puglia - Sunroom` to `Puglia-Sunroom`).
  - Otherwise the first space becomes a hyphen (`Marrero Kitchen Addition` to `Marrero-Kitchen Addition`).
- Status in parentheses follows JobTread (job custom field Status, id `22P5SRxYPb7Q`) and the folder is renamed when it changes. Mapping (confirmed by Nathan 2026-11-16):
  - Status 5 and earlier, and `10. Ready` = `In Design`
  - `6. In Production` = `In Progress`
  - `6.5 Ongoing / Punch List` (finished projects in punch list), `7. Final Billing`, `11. Closed`, or a closed job = `Completed`
  - `8. Lost` jobs are not included: no folder rename, no moves, no uploads.
- Folders with no JobTread job (they predate JobTread) can be marked "no JobTread job, keep name" in the Hub. Every run skips the job match and status check for them and never renames them; the one time moves still apply. Marked so far: `Nicols-Whole Home Renovation (Completed)` (shown as Completed; not Nicholson #156, which is Lost). Marks are stored in `agent_cache` under `marketing-ftp-folder-overrides`.
- Photos move into `Photos/` (new). Existing folders are migrated once (Nathan 2026-11-16): root level photos move into `Photos/`, videos into `Videos/`, PDFs and rendering images into `Plans & Renderings/`; the profile .docx stays at the root. Anything else stays at the root and is listed in the plan for Nathan to decide. Tell Mike before the move in case his site links to file paths.
- File names: `<Job Name> - <What it shows> (<Kind>).jpg`, Kind one of Before, Progress, Finished, Rendering, Professional. Renderings and plan PDFs go in `Plans & Renderings/`; videos in `Videos/` as `<Job Name> - <What it shows>.mp4` (or original format).
- Full size originals for photos and videos (Nathan 2026-11-16). No resizing, no transcoding, except HEIC photos, which go as full resolution JPEG.
- Never sent to the FTP: vendor quotes, invoices, receipts, working markups, selection references, near duplicates, clips under a few seconds. Record them in `marketing_photo_assets` as excluded so they are not reconsidered.

## Copy step rules (Hub build, 2026-11-16)

How Step 3 sorts each new JobTread file. A file already in `marketing_photo_assets` (sent or excluded) is never looked at again.

- Sent:
  - Photos: images with a labeled name (`<Area> - <What> - <date>`), a description, or a name a person typed on upload (anything that is not a camera, phone or JobTread default such as `IMG_####`, `PXL_...`, `Photo 1`, `annotation_...`; Nathan 2026-11-16). Kind from the phase tag: Pre-construction is Before, Finish is Finished, otherwise Progress. Goes to `Photos/` as `<Job Name> - <What it shows> (<Kind>).<ext>`.
  - Renderings: images tagged `Design`, to `Plans & Renderings/` with Kind Rendering.
  - Plan sheets: images tagged `Documents/Plans`, and PDFs tagged `Documents/Plans` or `Design`, to `Plans & Renderings/`.
  - Videos: to `Videos/` as `<Job Name> - <What it shows>.<ext>` (`Site Video <date>` when unlabeled). Videos tagged `Design` are design walkthroughs, Kind Rendering.
- Excluded for good (recorded so they are not reconsidered): files attached to a document (bills, quotes), tags `Receipts`, `Selections`, `Bids-Pricing`, `Permits`, or only `X. Vendor`; screenshots; PDFs not tagged as plans; other file types; near duplicates (same name stem and size, the earliest is kept); videos under 3 seconds.
- Waiting: photos with no label yet. Not recorded, so they are picked up on a later run once the labeler has done them.
- Originals only, never resized. The one conversion (Nathan 2026-11-16): HEIC photos are sent as JPEG at the original resolution, quality 92, so Mike's site can show them. Nothing on the FTP is replaced: a taken name gets ` 2`, ` 3` and so on. Uploads go to a hidden temporary name and are renamed into place when complete.
- The job folder is created if missing and renamed when the JobTread Status changes; the Hub tables follow the rename.

## 3. Marketing Project Profile format (from the Henschel and Marrero profiles)

Word document, US Letter, 1 inch side margins, 0.83 inch top and bottom. Arial 11 pt. Header right aligned, bold blue 8 pt: `BRETT KING BUILDER  |  Marketing Project Profile`; footer centered, gray 8 pt: `Page N`. Section headings are Heading 1, 14 pt bold navy with a thin blue rule under them. The exact measurements (read from the live Marrero profile on 2026-11-16) are listed at the top of `app/api/lib/marketing/profile/render-docx.ts`. Colors: navy 1F3A5F, blue 2E75B6, caption gray 555555, table shading EEF3F8, table borders DDDDDD.

Order of the document:

1. Title: job name, 20 pt bold navy.
2. Subtitle: `Marketing Project Profile`, 13 pt blue.
3. Tagline: one italic gray line, the project in a phrase with place (`A Full-Home Renovation and Addition in Bucks County · Perkasie, PA`).
4. Facts table (label column shaded, bold navy): Project (`<Job name> (Job #<n>)`), Last Updated, Location, Project Type, Status, Standout Feature.
5. What's new lines, directly under the table: one 10 pt italic bold navy line per update, newest first: `What's new (<Month D, YYYY>): <one sentence>.` This is the single running log. (Henschel also carries an older "What's New" section with mixed bullets; the rebuild keeps only the top lines and folds the older section into them.)
6. Project Description: two paragraphs. What the project is and how it respects the house, then the materials and spaces that make it special. Name the architect or partner when the documents do.
7. Scope of Work: bold navy subheads (Structure & Site, Exterior, Systems, Interior Finishes, or what fits) with short bullets.
8. How the Project Evolved: approved change orders told as a story, no prices.
9. Challenges & Solutions: 2 to 4 pairs, bold `Challenge:` bullet then indented bold `Solution:`.
10. Suggested Marketing Angles: 4 to 6 bullets, bold lead phrase then a colon and one or two sentences.
11. Plans & Renderings: a short paragraph naming what is in that folder.
12. Video Walk-Throughs: a bullet per video, `<Title>: <what it shows>`.
13. Photo sections: `The Home Today` (before photos), `Design Vision` (renderings), `Photo Highlights` or `Progress Photos`, and one `Progress Update (<date>)` section per new batch. Each has an italic gray intro line ending "These photos are also saved in this folder." Images 4.9 inches wide, centered, each with a centered italic gray caption of one sentence.

Writing rules: BKB voice, warm and specific, written for a marketing team; no em or en dashes; no prices, margins or allowance figures; no client first names; name products and materials that are confirmed in JobTread; never invent features. Sources: the JobTread job (location, Status), budget scope and specifications, approved change orders, daily logs, and the labeled photo descriptions.

Location row keeps the full street address (Nathan 2026-11-16).

## Profile writer (Hub build, 2026-11-16)

- First run for a job: the Hub downloads the job's current profile .docx from the FTP, reads it into structured content (title, tagline, What's new lines, facts table, each section's text, photo sections with captions) and stores it in `marketing_photo_doc_state.content.profile` (Nathan 2026-11-16). Claude only says which blocks belong to which part; the text is copied from the document by code, so wording is kept exactly. Photos embedded in the old profile are kept in the private `marketing-profiles` storage bucket.
- Every run rebuilds the whole .docx from the stored content plus the new material. No editing in place.
- New material each run: one What's new line (newest first), Status and Last Updated, a `Progress Update (<date>)` section with the new photos, new renderings added to Design Vision, new videos added to Video Walk-Throughs (design walkthroughs as design concepts), a sentence for new plans, and a paragraph for new approved change orders. Which files and change orders are already shown is tracked in `content.shown_ids` and `content.shown_change_orders`.
- Counts in the prose (change orders, photos, videos, renderings) are given to the writer exactly and then checked: any number in front of those words is replaced with the real count of what was included (Nathan 2026-11-16).
- Existing sections keep the order they have in the original profile; new sections are only ever added, never moved.
- Sources are scrubbed of money before Claude sees them. After writing, every string is checked for em or en dashes, money and the client's first name; anything flagged gets one fix pass, then a hard scrub.
- Preview builds the profile and emails it to Nathan with nothing sent to the FTP. Publish backs up the current .docx to storage, then replaces it in the job folder root.

## Weekly email to Mike

From Nathan, to Mike at Lighthouse Digital, BCC Nathan. Subject `Marketing photos and updates - <Month D, YYYY>`. Body as in the Sept to Oct emails: "Hi Mike, I put a few project updates in the shared folder for you." then a short block per job (job name, counts of new photos, videos, profile updated), then "Let me know if you need anything else." Draft gate stays: settings `live_mode` plus env `MARKETING_PHOTO_ENGINE_LIVE`.

## Backlog at rebuild

Flagged since 2026-10-23: Berntsen, Edwards, Henschel, Loder, Marrero, Oakes, Zajick. Folders on the FTP also include Behmlander, Halvorsen, Hurley-Phase 2, Johnson, Nicols, Puglia, Wallace.
