# BKB Client Intel — Architecture & System Reference

> **IMPORTANT FOR AI ASSISTANTS:** Read this document at the START of every session before making any code changes. Update the changelog at the END of every session where files were modified.
>
> **Nathan:** If starting a new conversation, mention this doc or say "review the architecture doc" so the assistant knows to read it first.

**Last updated:** 2026-03-11
**Repo:** `github.com/nbking24/bkb-client-intel`
**Deploy:** Vercel (auto-deploy on push to `main`)
**Live URL:** `https://bkb-client-intel.vercel.app`

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14.2.21 (App Router) |
| Language | TypeScript + React 18 |
| Database | Supabase (PostgreSQL + pgvector) |
| AI | Anthropic Claude (via @anthropic-ai/sdk) |
| CRM | Go High Level (GHL) API v2 |
| Job Mgmt | JobTread PAVE API |
| Styling | Tailwind CSS 3.4 + inline styles |
| Icons | lucide-react |
| PDF | pdf-parse |
| Deploy | Vercel (serverless, 60s timeout) |
| Auth | PIN-based Bearer tokens (APP_PIN env) |

---

## 2. Project Structure

```
app/
├── page.tsx                          # Root landing page (legacy chat UI)
├── layout.tsx                        # Root HTML layout + viewport meta
├── hooks/
│   └── useAskAgent.ts               # ★ Shared hook for Ask Agent (desktop + mobile)
├── m/                                # Mobile routes (NO dashboard chrome)
│   ├── layout.tsx                    # Minimal full-screen layout
│   └── ask/page.tsx                  # Mobile Ask Agent (/m/ask)
├── dashboard/
│   ├── layout.tsx                    # Dashboard shell (header + sidebar + nav)
│   ├── page.tsx                      # Overview — task cards, urgency badges
│   ├── ask/page.tsx                  # Desktop Ask Agent (/dashboard/ask)
│   ├── documents/page.tsx            # Document intelligence (placeholder)
│   ├── precon/                       # Pre-Construction module
│   │   ├── page.tsx                  # Agent recommendations + orphan panel
│   │   ├── [jobId]/page.tsx          # Individual job schedule/phases
│   │   ├── audit/page.tsx            # Audit — misplaced/orphan task analysis
│   │   ├── setup/page.tsx            # Survey-based schedule setup wizard
│   │   └── OrphanTaskPanel.tsx       # Orphan task reassignment component
│   └── spec-writer/
│       ├── page.tsx                  # Quick Spec Writer (upload + generate)
│       └── contract/page.tsx         # Contract Spec Builder (cost-item based)
├── api/
│   ├── chat/route.ts                 # ★ Main chat endpoint → agent router
│   ├── auth/route.ts                 # PIN auth token generation
│   ├── extract-pdf/route.ts          # PDF → text extraction (shared)
│   ├── conversations/
│   │   ├── route.ts                  # List/create conversations
│   │   ├── [id]/route.ts            # Get/add messages/delete conversation
│   │   └── setup/route.ts           # Initialize conversation tables
│   ├── lib/
│   │   ├── agents/
│   │   │   ├── router.ts            # ★ Agent routing — canHandle() scoring
│   │   │   ├── types.ts             # Shared types, stage mappings
│   │   │   ├── know-it-all.ts       # ★ Unified Ask agent (Q&A + JT read/write, 39 tools)
│   │   │   ├── jt-entry.ts          # (DEPRECATED — merged into know-it-all)
│   │   │   └── project-details.ts   # Project specs agent (PAVE cost items)
│   │   ├── auth.ts                  # validateAuth() helper
│   │   ├── ghl.ts                   # GHL API service (API routes)
│   │   ├── jobtread.ts              # JobTread PAVE service (API routes)
│   │   └── supabase.ts              # Supabase service-role client
│   ├── sync/
│   │   ├── route.ts                 # Main sync (GHL + JT → Supabase)
│   │   ├── force/route.ts           # Force-sync (bypass throttle)
│   │   ├── backfill/route.ts        # Historical batch sync
│   │   ├── ghl/[contactId]/route.ts # Single GHL contact sync
│   │   └── job/[jobId]/route.ts     # Single JT job sync
│   ├── spec-writer/
│   │   ├── generate/route.ts        # Quick spec generation
│   │   ├── questions/route.ts       # Category Q&A generation
│   │   └── contract/
│   │       ├── generate/route.ts    # Contract spec generation
│   │       ├── extract-pdf/route.ts # Contract PDF extraction
│   │       ├── budget/route.ts      # Cost hierarchy builder
│   │       ├── questions/route.ts   # Contract Q&A generation
│   │       └── save/route.ts        # Save spec to JT cost group
│   ├── dashboard/
│   │   ├── projects/route.ts        # Active projects list
│   │   ├── tasks/route.ts           # Task list with urgency
│   │   ├── schedule/route.ts        # Schedule multi-view endpoint
│   │   └── schedule-setup/route.ts  # Survey-based schedule builder
│   ├── agent/
│   │   └── design-manager/route.ts  # Design Manager analysis + actions
│   ├── cron/
│   │   ├── design-agent/route.ts    # Daily 6 AM — design analysis
│   │   └── sync-incremental/route.ts # Daily 5 AM — incremental sync
│   ├── contacts/route.ts            # Contact search
│   ├── notes/route.ts               # Create contact notes (chunked)
│   ├── opportunities/route.ts       # Opportunities with pipeline data
│   ├── query/route.ts               # General-purpose Q&A endpoint
│   ├── debug/route.ts               # Environment health check
│   └── jobtread-test/route.ts       # PAVE API diagnostic
└── lib/
    ├── bkb-spec-guide.ts            # BKB 23-category spec system + prompts
    ├── bkb-standards.ts             # Standard construction practices
    ├── bkb-brand-voice.ts           # Brand voice + email writing guide
    ├── cache.ts                     # Supabase cache read/write/clear
    ├── constants.ts                 # Colors, phases, statuses, rules
    ├── contact-mapper.ts            # Fuzzy name → GHL contact matching
    ├── design-agent.ts              # Design Manager data + analysis
    ├── ghl.ts                       # GHL API service (expanded)
    ├── jobtread.ts                  # JobTread PAVE service (expanded)
    ├── supabase.ts                  # Supabase client factory
    ├── schedule-templates.ts        # 9-phase schedule template + tasks
    └── survey-templates.ts          # Project scope survey definitions
```

---

## 3. Agent System — HOW IT WORKS

This is the most important section. The agent system has two agents and a router.

### 3.1 Routing Flow

```
User message → /api/chat → router.ts → canHandle() on each agent → highest score wins → agent.handle()
```

- Each agent has a `canHandle(message)` function returning a score 0–1
- The router picks the agent with the highest score
- The `forcedAgent` parameter can override routing (used by Ask Agent page)
- `lastAgent` provides sticky routing for follow-up messages

### 3.2 Agents

| Agent | File | Score Range | What It Does |
|-------|------|-------------|-------------|
| **Know-it-All** | `know-it-all.ts` | 0.05–0.95 | Unified Ask agent — full JT read+write (39 tools), Supabase + GHL search, email drafting, material specs, task creation/updates |
| **Project Details** | `project-details.ts` | 0.1–0.9 | Answers questions about specs from project's Specifications URL via PAVE cost items |

> **Note:** JT Entry (`jt-entry.ts`) was merged into Know-it-All as of 2026-03-07. The file still exists but is no longer registered in the router.

### 3.3 Routing Gotchas

- Know-it-All handles ALL task operations (read + write) — there is no separate write agent
- The `forcedAgent` parameter from the Ask Agent UI (`'know-it-all'` or `'project-details'`) bypasses routing entirely
- Know-it-All boosts to 0.95 for task mutations, email drafting, document analysis, and JT operations
- Know-it-All boosts to 0.92 for spec writing requests

### 3.4 Task Confirmation Flow

When Know-it-All wants to create/modify a task, it returns a confirmation block:

```
@@TASK_CONFIRM@@
{JSON with action details: name, phase, phaseId, description, assignee, startDate, endDate}
@@END_CONFIRM@@
```

The server-side `/api/chat/route.ts` extracts this block and sets `needsConfirmation: true` in the response. The frontend renders an **editable TaskConfirmCard** (both desktop and mobile) showing name, phase, assignee, dates, and description. The user can edit any field inline before approving.

**On Approve** the hook (`useAskAgent.ts`) sends:
```
Yes, proceed but [list of edits if any].

[APPROVED TASK DATA — execute this now using create_phase_task tool]
{"name":"...","phase":"...","phaseId":"...","assignee":"...","endDate":"..."}
```

**Field mapping** (JSON → `create_phase_task` tool params):
| JSON field | Tool param |
|------------|------------|
| `name` | `name` |
| `phaseId` | `parentGroupId` |
| `description` | `description` |
| `assignee` | `assignTo` |
| `startDate` | `startDate` |
| `endDate` | `endDate` |

**Phase change handling**: If the user edits the phase dropdown, `useAskAgent.ts` deletes the stale `phaseId` and sets `phaseChanged: true`. When Know-it-All sees `phaseChanged: true` with no `phaseId`, it calls `get_job_schedule` to look up the correct phase ID by name, then uses that as `parentGroupId` in `create_phase_task`. This prevents orphan tasks.

**Sticky routing**: The router has three patterns that keep confirmations with the last agent:
- `CONFIRMATION_PATTERN` — "yes", "ok", "proceed", etc.
- `EXTENDED_CONFIRM_PATTERN` — "Yes, proceed but ..."
- `APPROVED_TASK_PATTERN` — messages containing `[APPROVED TASK DATA`

---

## 4. Ask Agent — Shared Hook Architecture

Both the desktop (`/dashboard/ask`) and mobile (`/m/ask`) pages import from `app/hooks/useAskAgent.ts`.

**What's in the hook (change once, affects both pages):**
- All state (messages, jobs, conversations, files, sync, agent mode)
- Conversation CRUD (create, load, save, delete)
- Message sending + agent API calls
- File upload + PDF extraction
- Force sync
- Confirm/decline handlers
- Content formatting (markdown-lite parser)
- Suggestions, time formatting, auth token

**What's in each page (UI-specific):**
- Desktop: sidebar with conversation list, dropdown job selector, keyboard Enter-to-send
- Mobile: slide-over drawer for conversations, modal job picker, no Enter-to-send (tap Send button), sticky bottom input, safe-area padding

---

## 5. Spec Writer — Two Modes

### 5.1 Quick Spec Writer (`/dashboard/spec-writer`)
- User uploads files (PDF, TXT, MD) + types a prompt
- PDFs are extracted client-side via `/api/extract-pdf`
- Sent to `/api/spec-writer/generate` with system prompt containing BKB standards
- **Vendor Estimate Mode**: When a PDF is a vendor estimate/invoice, the system prompt instructs Claude to extract actual product names, sizes, colors — NOT generic "tbd per owner selection" boilerplate

### 5.2 Contract Spec Writer (`/dashboard/spec-writer/contract`)
- Works from JobTread cost items (budget hierarchy)
- Generates detailed contract specifications per BKB's 23-category system
- Can save specs back to JobTread cost groups

### 5.3 Key Files
- `app/lib/bkb-spec-guide.ts` — Categories 01–23, system prompts
- `app/lib/bkb-standards.ts` — Standard construction practices by category
- `app/api/spec-writer/generate/route.ts` — Quick spec endpoint (has vendor estimate mode)

---

## 6. Database (Supabase)

### 6.1 Core Tables

| Table | Purpose |
|-------|---------|
| `users` | Platform users (Nathan, Terri, Evan, Josh, Dave, Brett) |
| `projects` | Maps JT jobs ↔ GHL contacts |
| `precon_phases` | 9-phase pre-construction tracking |
| `blockers` | Project impediments |
| `notifications` | User alerts (info, warning, urgent) |

### 6.2 Cache Tables (synced from APIs)

| Table | Source | Why Cached |
|-------|--------|-----------|
| `jt_comments` | JobTread | Full history exceeds API pagination |
| `jt_daily_logs` | JobTread | Full history exceeds API pagination |
| `ghl_messages` | GHL | Conversation threads exceed 40-item cap |
| `ghl_notes` | GHL | Notes exceed pagination |

### 6.3 Platform Feature Tables

| Table | Purpose |
|-------|---------|
| `chat_conversations` | Persistent Ask Agent conversation state |
| `chat_messages` | Individual messages within conversations |
| `agent_cache` | Design Manager analysis reports |
| `agent_dismissals` | Dismissed agent recommendations |
| `sync_log` | Audit trail of sync operations |
| `sync_state` | Active sync tracking with retry |

### 6.4 Document Intelligence (Future)

| Table | Purpose |
|-------|---------|
| `document_sources` | Document metadata |
| `document_chunks` | Vector embeddings (1536-dim, pgvector) |

---

## 7. Sync Pipeline

### 7.1 Automatic Sync
- **Daily 5 AM**: `/api/cron/sync-incremental` syncs all active JT jobs + GHL contacts
- **Daily 6 AM**: `/api/cron/design-agent` runs Design Manager analysis

### 7.2 Manual Sync
- **Force Sync button**: In Ask Agent UI header, calls `/api/sync/force`
- **Per-entity**: `/api/sync/job/[jobId]` or `/api/sync/ghl/[contactId]`

### 7.3 Data Flow
```
GHL API ──→ ghl_messages, ghl_notes (Supabase cache)
JT API  ──→ jt_comments, jt_daily_logs (Supabase cache)
                    ↓
         Know-it-All agent queries Supabase first,
         falls back to live API if needed
```

---

## 8. External Integrations

### 8.1 Go High Level (GHL)
- Base URL: `https://services.leadconnectorhq.com`
- Contacts, conversations, messages, notes, tasks, opportunities, pipelines
- Two service files: `app/api/lib/ghl.ts` (API routes) and `app/lib/ghl.ts` (expanded)

### 8.2 JobTread
- Base URL: `https://api.jobtread.com/pave`
- Jobs, tasks, cost items, documents, comments, daily logs, members
- Two service files: `app/api/lib/jobtread.ts` (API routes) and `app/lib/jobtread.ts` (expanded)

### 8.3 Anthropic Claude
- Used by: all agents, spec writers, design manager, query endpoint
- Model selection varies by endpoint

---

## 9. Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase (bypasses RLS) |
| `ANTHROPIC_API_KEY` | Claude API |
| `GHL_API_KEY` | GHL API auth |
| `GHL_LOCATION_ID` | GHL business location |
| `GHL_PIPELINE_ID` | GHL sales pipeline |
| `JOBTREAD_API_KEY` | JobTread PAVE auth |
| `JOBTREAD_ORG_ID` | JobTread organization |
| `APP_PIN` | Application PIN for auth |
| `NEXT_PUBLIC_APP_PIN` | Client-side PIN |
| `CRON_SECRET` | Bearer token for cron endpoints |

---

## 10. Vercel Config

- All API routes: **60 second timeout**
- `/api/chat`: **1024 MB memory** (agent processing)
- Cron: design-agent at 6 AM UTC, sync-incremental at 5 AM UTC
- Auto-deploy on push to `main`

---

## 11. Team Members

| Name | Role | Notes |
|------|------|-------|
| Nathan King | Owner/Operator | Primary user, current user of this platform |
| Terri Dalavai | Team | |
| David Steich | Team | |
| Evan Harrington | Team | |
| John Molnar | Team | |
| Karen Molnar | Team | |
| Chrissy Zajick | Team | |

---

## 12. Known Gotchas & Warnings

1. **Agent routing**: With two agents (Know-it-All + Project Details), routing is simpler but still score-based. Check both agents when modifying `canHandle()` scores.

2. **Two copies of service files**: GHL and JobTread each have TWO service files — one in `app/api/lib/` (for API routes) and one in `app/lib/` (for expanded platform use). They are NOT the same file.

3. **Spec Writer ≠ Chat Agents**: The Quick Spec Writer (`/dashboard/spec-writer`) has its own generate endpoint (`/api/spec-writer/generate`) with its own system prompt. It does NOT use the chat agent system. Don't modify agents when the spec writer needs fixing.

4. **PDF extraction has two endpoints**: `/api/extract-pdf` (shared, used by Ask Agent and Quick Spec Writer) and `/api/spec-writer/contract/extract-pdf` (contract-specific with page counting).

5. **Mobile page lives outside dashboard layout**: `/m/ask` is at `app/m/` NOT `app/dashboard/ask/mobile/`. This avoids the dashboard header/sidebar wrapper.

6. **Task confirmation is server-side**: The `@@TASK_CONFIRM@@` block is extracted in `/api/chat/route.ts`, NOT in the frontend. The frontend only sees `needsConfirmation: true`.

7. **Editable confirmation cards can cause stale data**: When the user edits the phase dropdown on a TaskConfirmCard, the `phaseId` from the original suggestion becomes stale. The hook deletes the old `phaseId` and sets `phaseChanged: true` — Know-it-All must then look up the correct phase ID via `get_job_schedule`. If this logic is bypassed, tasks get created as orphans.

8. **`create_phase_task` vs `create_jobtread_task`**: Always use `create_phase_task` (with `parentGroupId`) for approved tasks. Using `create_jobtread_task` creates orphan tasks with no phase assignment. The Know-it-All system prompt explicitly forbids `create_jobtread_task` for approved tasks.

9. **Tool param names don't match JSON keys**: The confirmation card JSON uses `assignee` but the tool expects `assignTo`. Similarly `phaseId` maps to `parentGroupId`. The Know-it-All system prompt has an explicit mapping table — if you modify the tool schema, update the mapping too.

---

## 13. Changelog

All modifications to the codebase should be logged here with date, files changed, and what was done.

### 2026-03-11 — Session: Invoicing Health Dashboard + Agent

**Problem:** No centralized view of invoicing health across all open JobTread projects. Terry (office manager) and Nathan had to manually check each job for overdue milestones, unbilled cost-plus work, and pending billable items. The three invoicing profiles (Fixed-Price, Cost Plus, Billable Labor) each had different billing cadences and triggers, making it easy to miss billing windows.

**Solution:** Built a full Invoicing Health Dashboard with agent-powered analysis:
1. Core data layer (`invoicing-health.ts`) — queries JT for all active jobs, classifies them by Price Type (Fixed-Price vs Cost-Plus), analyzes invoicing health for each profile
2. Dashboard API (`/api/dashboard/invoicing`) — serves cached or fresh invoicing health data with Supabase caching
3. Dashboard UI (`/dashboard/invoicing/page.tsx`) — summary cards, contract job progress, cost-plus billing cadence indicators, billable items panel with expand/collapse
4. Agent analysis endpoint (`/api/agent/invoicing`) — runs Claude analysis on invoicing data, generates prioritized recommendations
5. Daily cron job (`/api/cron/invoicing-health`) — runs at 1 AM EST to refresh cached data

**Key Data Points:**
- Fixed-Price jobs: milestone tracking via `$` prefix schedule tasks, draft/approved invoices
- Cost Plus jobs: 14-day billing cadence, days-since-last-invoice indicator, unbilled costs/hours
- Billable items: Cost Code 23 ("Miscellaneous/Billable Labor"), billable time entries
- Health levels: healthy → warning → overdue → critical

**Changes:**
- `app/lib/invoicing-health.ts` — **NEW** Core invoicing health analysis logic
- `app/api/dashboard/invoicing/route.ts` — **NEW** Dashboard data endpoint with Supabase caching
- `app/dashboard/invoicing/page.tsx` — **NEW** Invoicing health dashboard UI
- `app/api/agent/invoicing/route.ts` — **NEW** Claude-powered agent analysis endpoint
- `app/api/cron/invoicing-health/route.ts` — **NEW** Daily 1 AM cron job
- `app/dashboard/layout.tsx` — Added "Invoicing" nav item with DollarSign icon
- `vercel.json` — Added invoicing-health cron schedule (0 6 * * * = 1 AM EST)
- `BUILD_PLAN_INVOICING_HEALTH.md` — **NEW** Build plan document for session continuity
- `ARCHITECTURE.md` — Updated changelog

### 2026-03-10 — Session: GHL → JobTread Meeting Sync

**Problem:** Client meetings entered in GHL (the source of truth) were not reflected in JobTread schedules. Team members looking at JT tasks wouldn't see upcoming client appointments, creating visibility gaps.

**Solution:** Built bidirectional sync infrastructure:
1. New `syncGHLMeetingsToJT()` function in GHL service layer — pulls GHL appointments, maps contacts to active JT jobs by client name, creates JT tasks for new meetings (with duplicate detection)
2. Added Phase 3 to daily cron sync (5 AM) — automatically syncs GHL meetings to JT each morning
3. New `sync_ghl_meetings_to_jt` agent tool — allows on-demand sync from the Ask Agent ("sync my meetings to JobTread")
4. Synced tasks are prefixed with 📅 and include meeting details (time, contact, notes) in the description

**Changes:**
- `app/lib/ghl.ts` — Added `syncGHLMeetingsToJT()` with contact→job mapping, duplicate detection, and dry-run support
- `app/api/cron/sync-incremental/route.ts` — Added Phase 3 for GHL meeting sync after existing message/note sync
- `app/api/lib/agents/know-it-all.ts` — Added `sync_ghl_meetings_to_jt` tool definition and handler, updated system prompt with sync info, expanded canHandle() for sync queries
- `ARCHITECTURE.md` — Updated changelog

### 2026-03-10 — Session: Add GHL Calendar Access to Ask Agent

**Problem:** The Ask Agent only had access to JobTread schedules (construction tasks/milestones) but not GoHighLevel (GHL) calendar events. Client meetings, consultations, and site visits are entered in GHL, which is the source of truth for client-facing appointments. When users asked about "my schedule" or "upcoming meetings," the agent could only show JT tasks.

**Solution:** Added GHL calendar read tools to the Know-it-All agent:
1. New `get_ghl_calendar` tool fetches appointments from GHL within a date range
2. New `get_ghl_calendars_list` tool lists available GHL calendars
3. Updated system prompt with SCHEDULE & CALENDAR rules: GHL = client meetings (source of truth), JT = construction tasks
4. Agent now presents both sources when asked about schedules

**Changes:**
- `app/lib/ghl.ts` — Added `getCalendars()`, `getAppointment()`, and `createAppointment()` functions to GHL service layer
- `app/api/lib/agents/know-it-all.ts` — Added GHL calendar imports, 2 new tool definitions (`get_ghl_calendar`, `get_ghl_calendars_list`), tool execution handlers, SCHEDULE & CALENDAR section in system prompt, canHandle() boost for meeting/appointment queries
- `ARCHITECTURE.md` — Updated changelog

### 2026-03-10 — Session: Fix Ask Agent Verbosity + Tool Loop Exhaustion

**Problem:** The Ask Agent would ask unnecessary clarifying questions on simple read queries (e.g., "Is there a task for Terri...?" would get back "Would you like me to set up the schedule structure first, or do you want to create specific tasks...?" instead of a direct answer). The agent also hit "No response generated" errors because the tool loop limit (3 iterations) was too tight for queries requiring multiple lookups. Additionally, the `needsConfirmation` regex was too broad, catching casual suggestions like "want me to create" as formal write confirmations.

**Solution:** Three targeted fixes:
1. Added explicit RESPONSE STYLE rules to the Know-it-All system prompt: answer read queries directly, no walls of text, no offering multiple options on lookups
2. Increased tool loop iterations from 3 to 5 (the 90-second safety timer is the real guard against Vercel timeouts)
3. Tightened `needsConfirmation` regex to only match explicit "shall/should I proceed?" patterns, not casual offers — the `@@TASK_CONFIRM@@` flow already handles structured confirmations separately

**Changes:**
- `app/api/lib/agents/know-it-all.ts` — Added RESPONSE STYLE section to system prompt: direct answers for reads, concise 2-4 sentence lookups, no "Would you like me to..." on simple queries
- `app/api/lib/agents/router.ts` — Increased `iterations < 3` to `iterations < 5`; tightened `needsConfirmation` regex to avoid false positives from casual suggestions

### 2026-03-07 — Session: Merge JT Entry into Know-it-All (Unified Ask Agent)

**Problem:** The two-agent architecture (Know-it-All for reads, JT Entry for writes) caused routing confusion. When a user asked to create tasks, Know-it-All had the read tools to look up data but no write tools to execute, causing a tool-use loop that exhausted all 5 iterations and returned "No response generated." The split also meant confirmations could get lost when routing switched between agents.

**Solution:** Merged JT Entry into Know-it-All, creating a single unified agent with 39 tools (23 read + 16 write). The router now only has two agents: Know-it-All and Project Details.

**Changes:**
- `app/api/lib/agents/know-it-all.ts` — Added all 20 write imports, 16 write tool definitions, 16 write executeTool handlers, comprehensive system prompt with task confirmation format + phase assignment rules + field mapping, updated canHandle() with write operation patterns
- `app/api/lib/agents/router.ts` — Removed jt-entry import and registration, simplified forcedAgent routing
- `ARCHITECTURE.md` — Updated agent table, routing docs, gotchas, project structure to reflect merge

**Commits:** `04758ec` (agent merge), next commit (architecture doc update)

### 2026-03-07 — Session: Fix Orphan Tasks + Date/Assignee Passthrough

**Problem 1:** When user edited the phase in the confirmation card dropdown, the stale `phaseId` from the original suggestion was still sent. Claude used the old phaseId, creating the task under the wrong phase — or as an orphan with no phase at all.

**Problem 2:** After fixing the phase issue, tasks were created in the right phase but with no assignee and no due date. Root cause: the `create_phase_task` tool definition was missing `startDate` and `endDate` parameters entirely. The system prompt also lacked explicit field mapping between JSON keys and tool params.

**Changes:**
- `app/hooks/useAskAgent.ts` — When user changes phase in dropdown, delete stale `phaseId` and set `phaseChanged: true` so Claude is forced to look up the correct phase ID via `get_job_schedule`
- `app/api/lib/agents/jt-entry.ts` — Added `startDate` and `endDate` to `create_phase_task` tool schema; updated execution code to pass them to `createPhaseTask()`; added explicit field mapping instructions and phase change handling steps to system prompt
- Updated ARCHITECTURE.md section 3.4 with full task confirmation flow documentation

**Commits:** `659d972` (orphan fix), `a0d86e9` (date/assignee fix)

### 2026-03-07 — Session: Fix Task Confirmation Card

**Problem:** When JT Entry generated a `@@TASK_CONFIRM@@` block, the server extracted it but: (1) `needsConfirmation` was `false` because the remaining reply text didn't match the regex, and (2) the frontend hook ignored the `taskConfirm` JSON entirely. Result: the user saw a partial message with no card and no Approve/Cancel buttons.

**Changes:**
- Fixed `app/api/chat/route.ts` — `needsConfirmation` now set to `true` when `taskConfirm` is parsed (`!!taskConfirm`)
- Added `TaskConfirmData` type to `app/hooks/useAskAgent.ts` + store `data.taskConfirm` in ChatMessage
- Added `TaskConfirmCard` component to `app/dashboard/ask/page.tsx` (desktop) — renders name, phase, assignee, dates, description
- Added `TaskConfirmCard` component to `app/m/ask/page.tsx` (mobile) — same data, mobile-optimized layout

**Commit:** `9d85940`

### 2026-03-06 — Session: Mobile Ask Agent + Shared Hook

**Changes:**
- Created `app/hooks/useAskAgent.ts` — shared hook for all Ask Agent logic
- Refactored `app/dashboard/ask/page.tsx` to use shared hook (6.95 KB → 4.76 KB)
- Created `app/m/ask/page.tsx` — mobile-friendly Ask Agent at `/m/ask`
- Created `app/m/layout.tsx` — minimal mobile layout (no dashboard chrome)
- Created `ARCHITECTURE.md` — this document

**Commits:** `fe2f195`, `1d04da3`

### 2026-03-06 — Session: Spec Writer PDF Fix

**Changes:**
- Fixed `app/dashboard/spec-writer/page.tsx` — added PDF extraction to file upload (was only reading text files, PDFs had no content)
- Updated `app/api/spec-writer/generate/route.ts` — added Vendor Estimate / Material Specification Mode to system prompt, increased file content cap 10K → 30K
- Updated `app/api/lib/agents/know-it-all.ts` — added material spec writing instructions + routing boost (0.92 for spec keywords)
- Updated `app/api/lib/agents/jt-entry.ts` — added spec writing exclusion rule (0.05 for spec keywords)

**Commits:** `ac97775`, `ba72352`

### 2026-03-06 — Session: Earlier fixes (from prior compacted session)

**Changes (partial list from git log):**
- Task confirmation card rendering fix + 1-day default duration (`b3f250b`)
- Server-side confirmation parsing moved to `/api/chat` (`29406c0`)
- Know-it-All temporal awareness (current date/time in system prompt) (`1cabcb9`)
- Force-sync button added to Ask Agent header (`821bffa`, `7e7041a`)
- Phase categorization + editable confirmation cards (`ff21aeb`, `fcbece7`)
- Agent identity fix (Nathan not Brett) (`e9fcab0`)
- Critical bug fix — confirmations routed to wrong agent (`3e982ac`)
- Conversation persistence + sidebar (`7cb7e89`, `e049068`)
- PDF upload to chat (`ba1e58a`)
- Email drafting with brand voice (`d64f3b0`, `d6f4bd9`, `c01b705`, `8b34c46`)
- Supabase-first contact tracking (`c6d035e`)
- Know-it-All data access limits removed (`870c971`)
- Backfill progress tracking fix (`5c3602a`)

---

*End of document. Keep this updated after every session.*
