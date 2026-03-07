# BKB Client Intel — Architecture & System Reference

> **IMPORTANT FOR AI ASSISTANTS:** Read this document at the START of every session before making any code changes. Update the changelog at the END of every session where files were modified.
>
> **Nathan:** If starting a new conversation, mention this doc or say "review the architecture doc" so the assistant knows to read it first.

**Last updated:** 2026-03-06
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
│   │   │   ├── know-it-all.ts       # ★ General Q&A + task agent
│   │   │   ├── jt-entry.ts          # ★ JobTread task execution agent
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

This is the most important section. The agent system has three agents and a router. **Modifying one agent can break the others if routing scores overlap.**

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
| **Know-it-All** | `know-it-all.ts` | 0.05–0.95 | General Q&A, searches Supabase + GHL, creates tasks, drafts emails, writes material specs |
| **JT Entry** | `jt-entry.ts` | 0.05–0.95 | JobTread task mutations (create, update, apply templates) |
| **Project Details** | `project-details.ts` | 0.1–0.9 | Answers questions about specs from project's Specifications URL via PAVE cost items |

### 3.3 Routing Gotchas

- Know-it-All and JT Entry both handle task-related requests — the routing scores determine which one wins
- JT Entry has an **exclusion rule**: if the message matches `/(write|create|draft|generate).*(spec|specification|material)/i`, it returns 0.05 to avoid intercepting spec writing
- Know-it-All has a **boost**: same pattern returns 0.92 to grab spec writing requests
- The `forcedAgent` parameter from the Ask Agent UI (`'know-it-all'` or `'project-details'`) bypasses routing entirely

### 3.4 Task Confirmation Flow

When JT Entry wants to create/modify a task, it returns a confirmation block:

```
@@TASK_CONFIRM@@
{JSON with action details}
@@END_CONFIRM@@
```

The server-side `/api/chat/route.ts` extracts this block and sets `needsConfirmation: true` in the response. The frontend shows Approve/Cancel buttons. On approve, the user sends "Yes, proceed." which routes back to JT Entry.

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

1. **Agent routing is fragile**: Changing `canHandle()` scores in one agent can reroute messages away from another agent. Always check all three agents when modifying routing.

2. **Two copies of service files**: GHL and JobTread each have TWO service files — one in `app/api/lib/` (for API routes) and one in `app/lib/` (for expanded platform use). They are NOT the same file.

3. **Spec Writer ≠ Chat Agents**: The Quick Spec Writer (`/dashboard/spec-writer`) has its own generate endpoint (`/api/spec-writer/generate`) with its own system prompt. It does NOT use the chat agent system. Don't modify agents when the spec writer needs fixing.

4. **PDF extraction has two endpoints**: `/api/extract-pdf` (shared, used by Ask Agent and Quick Spec Writer) and `/api/spec-writer/contract/extract-pdf` (contract-specific with page counting).

5. **Mobile page lives outside dashboard layout**: `/m/ask` is at `app/m/` NOT `app/dashboard/ask/mobile/`. This avoids the dashboard header/sidebar wrapper.

6. **Task confirmation is server-side**: The `@@TASK_CONFIRM@@` block is extracted in `/api/chat/route.ts`, NOT in the frontend. The frontend only sees `needsConfirmation: true`.

---

## 13. Changelog

All modifications to the codebase should be logged here with date, files changed, and what was done.

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
