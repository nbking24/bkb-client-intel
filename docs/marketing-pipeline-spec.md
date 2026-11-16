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

- Folder name: first space in the JobTread job name becomes a hyphen (`Marrero Kitchen Addition` to `Marrero-Kitchen Addition`), then the status in parentheses.
- Status in parentheses follows JobTread (job custom field Status, id `22P5SRxYPb7Q`) and the folder is renamed when it changes. Mapping (confirmed by Nathan 2026-11-16):
  - Status 5 and earlier, and `10. Ready` = `In Design`
  - `6. In Production` and `6.5 Ongoing / Punch List` = `In Progress`
  - job closed or later statuses (`7. Final Billing`, `11. Closed`) = `Completed`
  - `8. Lost` jobs are not included: no folder rename, no moves, no uploads.
- Photos move into `Photos/` (new). Existing folders are migrated once: root level photos move into `Photos/`; profile stays at the root. Tell Mike before the move in case his site links to file paths.
- File names: `<Job Name> - <What it shows> (<Kind>).jpg`, Kind one of Before, Progress, Finished, Rendering, Professional. Renderings and plan PDFs go in `Plans & Renderings/`; videos in `Videos/` as `<Job Name> - <What it shows>.mp4` (or original format).
- Full size originals for photos and videos (Nathan 2026-11-16). No resizing, no transcoding.
- Never sent to the FTP: vendor quotes, invoices, receipts, working markups, selection references, near duplicates, clips under a few seconds. Record them in `marketing_photo_assets` as excluded so they are not reconsidered.

## 3. Marketing Project Profile format (from the Henschel and Marrero profiles)

Word document, US Letter, 1 inch side margins. Header `BRETT KING BUILDER | Marketing Project Profile`; footer `Page N`. Colors: navy 1F3A5F, blue 2E75B6, caption gray 555555, table shading EEF3F8, table borders DDDDDD.

Order of the document:

1. Title: job name, 20 pt bold navy.
2. Subtitle: `Marketing Project Profile`, 13 pt blue.
3. Tagline: one italic gray line, the project in a phrase with place (`A Full-Home Renovation and Addition in Bucks County · Perkasie, PA`).
4. What's new lines: one italic bold navy line per update, newest first: `What's new (<Month D, YYYY>): <one sentence>.` This is the single running log. (Henschel also carries an older "What's New" section with mixed bullets; the rebuild keeps only the top lines and folds the older section into them.)
5. Facts table (label column shaded, bold navy): Project (`<Job name> (Job #<n>)`), Last Updated, Location, Project Type, Status, Standout Feature.
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

## Weekly email to Mike

From Nathan, to Mike at Lighthouse Digital, BCC Nathan. Subject `Marketing photos and updates - <Month D, YYYY>`. Body as in the Sept to Oct emails: "Hi Mike, I put a few project updates in the shared folder for you." then a short block per job (job name, counts of new photos, videos, profile updated), then "Let me know if you need anything else." Draft gate stays: settings `live_mode` plus env `MARKETING_PHOTO_ENGINE_LIVE`.

## Backlog at rebuild

Flagged since 2026-10-23: Berntsen, Edwards, Henschel, Loder, Marrero, Oakes, Zajick. Folders on the FTP also include Behmlander, Halvorsen, Hurley-Phase 2, Johnson, Nicols, Puglia, Wallace.
