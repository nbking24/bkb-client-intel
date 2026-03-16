# BKB Client Intel — Architecture & System Reference

> **IMPORTANT FOR AI ASSISTANTS:** Read this document at the START of every session before making any code changes. Update the changelog at the END of every session where files were modified.
>
> **Nathan:** If starting a new conversation, mention this doc or say "review the architecture doc" so the assistant knows to read it first.

**Last updated:** 2026-03-16
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
│   ├── invoicing/page.tsx             # Invoicing Health Dashboard (health-sorted cards, invoice details)
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
│   │   ├── invoicing/
│   │   │   ├── route.ts             # Invoicing health data endpoint (cached)
│   │   │   └── create-task/route.ts # Create $ schedule task for unmatched draft invoices
│   │   ├── projects/route.ts        # Active projects list
│   │   ├── tasks/route.ts           # Task list with urgency
│   │   ├── schedule/route.ts        # Schedule multi-view endpoint
│   │   └── schedule-setup/route.ts  # Survey-based schedule builder
│   ├── agent/
│   │   ├── design-manager/route.ts  # Design Manager analysis + actions
│   │   └── invoicing/route.ts       # Invoicing health Claude analysis
│   ├── cron/
│   │   ├── design-agent/route.ts    # Daily 6 AM — design analysis
│   │   ├── invoicing-health/route.ts # Daily 1 AM EST — invoicing data refresh
│   │   └── sync-incremental/route.ts # Daily 5 AM — incremental sync
│   ├── contacts/route.ts            # Contact search
│   ├── notes/route.ts               # Create contact notes (chunked)
│   ├── opportunities/route.ts       # Opportunities with pipeline data
│   ├── query/route.ts               # General-purpose Q&A endpoint
│   ├── debug/route.ts               # Environment health check
│   └── jobtread-test/route.ts       # PAVE API diagnostic
└── lib/
    ├── invoicing-health.ts           # Invoicing health analysis (contract + cost-plus, CC23 billable, released invoices)
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

## 6. Specs Agent (Project Details) — Data Flow

The **Project Details** agent (`project-details.ts`) answers spec/selection questions about a focused job. It uses a single tool `get_project_details` that fetches cost items from approved JobTread documents and returns them to Claude for answering.

### 6.1 Data Retrieval Pipeline

1. **Fetch all budget cost items** via `getCostItemsLightForJob(jobId)` — returns every cost item in the job's budget with cost groups, files, and document references
2. **Identify approved documents** — filters for customer orders/invoices with `status === 'approved'` or `status === 'pending'`
3. **Filter budget items** — keeps only items that reference an approved document ID
4. **Fetch document-level items** via `getDocumentCostItemsLightById(docId)` for each approved document — this catches Change Order items whose budget-level entries lack a document reference
5. **Filter out unselected options** — uses PAVE `isSelected` field to exclude items the client did NOT select (see below)
6. **Merge** — combines filtered budget items + selected document-level items (deduped by ID)
7. **Build context string** — formats items with names, descriptions, cost codes, cost groups, and file links
8. **Append file links** — file URLs use the JobTread CDN pattern: `https://cdn.jobtread.com/files/{fileId}` (appended server-side, not from PAVE URL field)

### 6.2 Document Options & `isSelected` Filtering

JobTread documents (estimates, contracts) can have **options** — alternative cost groups where the client selects which ones they want. For example, a flooring section might offer "Alpine Quartzite" and "Sterling Quartzite" as two options, but the client only selects one.

**Key PAVE API behavior:**
- `isSelected` is available on document-level cost items AND cost groups (via `getDocumentCostItemsLightById`)
- `isSelected: true` = client selected this option
- `isSelected: false` = client did NOT select this option (should be excluded from results)
- `isSelected` on budget-level (job) cost items always returns `false` — it's only meaningful at the document level
- `approvedPrice` does NOT exist in the PAVE API (not a valid field)

**Filtering logic** (in `project-details.ts`):
1. Fetch document items from all approved customer orders
2. Build a `unselectedItemIds` set from items where `isSelected === false`
3. Filter budget items to exclude IDs in that set
4. When processing document-level items, skip any where `isSelected === false`

### 6.3 File Links

File URLs in Specs agent responses use the CDN pattern `https://cdn.jobtread.com/files/{fileId}` rather than the PAVE `url` field. This is because:
- PAVE file URLs are short-lived signed URLs that expire
- The CDN URL pattern provides stable, permanent links
- File IDs are appended server-side in `project-details.ts` when building the context string

### 6.4 Key Files

| File | Role |
|------|------|
| `app/api/lib/agents/project-details.ts` | Specs agent — system prompt, `get_project_details` tool, context builder |
| `app/lib/jobtread.ts` (`getDocumentCostItemsLightById`) | Fetches cost items from a single document with `isSelected` field |
| `app/lib/jobtread.ts` (`getCostItemsLightForJob`) | Fetches all budget cost items for a job |

---

## 7. Invoicing Health Dashboard

The Invoicing Health Dashboard (`/dashboard/invoicing`) provides a centralized view of invoicing health across all active JobTread projects. It has a backend analysis layer, cached API endpoint, agent-powered recommendations, and a rich frontend with project cards.

### 6.1 Architecture

```
Daily 1 AM EST cron ──→ /api/cron/invoicing-health ──→ buildInvoicingContext() ──→ Supabase cache
                                                                                          ↓
User visits dashboard ──→ /api/dashboard/invoicing?cached=true ──→ reads Supabase cache ──→ UI
User clicks Refresh   ──→ /api/dashboard/invoicing?refresh=true ──→ fresh buildInvoicingContext() ──→ UI + cache
```

### 6.2 Data Layer (`app/lib/invoicing-health.ts`)

Core analysis function `buildInvoicingContext()` fetches all active jobs via PAVE API, classifies by native `priceType` field (`fixed` → Fixed-Price, `costPlus` → Cost-Plus), then runs type-specific analyzers:

**analyzeContractJob()** — Fixed-Price jobs:
- Milestone tracking via `$` prefix schedule tasks (approaching, overdue)
- Draft invoice ↔ `$` task matching (fuzzy name match, extracts parenthesized labels)
- Uninvoiced billable items (CC23 on vendor bills minus CC23 on customer invoices)
- Unbilled labor hours (CC23 time entries minus CC23 invoice quantities)
- Released invoices (approved → paid, pending → open) with amounts
- Health thresholds: milestone overdue (14d+ = critical), billable items ($200 warning / $800 overdue), labor hours (1h warning / 3h overdue)

**analyzeCostPlusJob()** — Cost-Plus jobs:
- Billing cadence tracking (days since last invoice, 14-day target)
- Unbilled costs (vendor bill costs minus invoiced costs)
- Unbilled hours (total time entries minus invoiced labor hours)
- Released invoices (approved → paid, pending → open) with amounts
- Health thresholds: 10d warning, 14d overdue, 28d critical, $100 unbilled

**findBillableItems()** — CC23 billable items panel (non-contract jobs only)

### 6.3 Frontend (`app/dashboard/invoicing/page.tsx`)

**Summary row:** 5 stat cards (Open Jobs, Alerts, Unbilled Items, Unbilled Hours, Overall Health)

**Search:** Real-time filter by job name, number, or client name across all sections

**Contract (Fixed-Price) Job Cards:**
- Header: job name + health badge (healthy/warning/overdue/critical)
- Subtitle: invoiced / contract total + unpaid amount (yellow, if any) + invoiced %
- Progress bar: invoiced % of contract value
- Inline stats: Billable items amount + unbilled labor hours
- Alerts: approaching milestones, overdue milestones, unmatched drafts (with Create Task button), pending invoices awaiting payment
- Collapsible invoice details: Draft (amber) / Paid (green) / Open (yellow) badges

**Cost Plus Job Cards:**
- Header: job name + health badge
- Subtitle: total invoiced + unbilled amount + unpaid amount (yellow, if any) + days since last invoice
- Progress bar: days since last invoice (colored by cadence health)
- Inline stats: unbilled costs + unbilled hours + total billed
- Alerts: billing cadence warnings
- Collapsible invoice details: Draft / Paid / Open badges

**Billable Items Section:** Expandable cards per job showing uninvoiced CC23 items and hours

**Agent Section:** Claude-generated summary and prioritized recommendations (from cached agent analysis)

### 6.4 Key Types

| Type | Purpose |
|------|---------|
| `ContractJobHealth` | Full health data for a Fixed-Price job (milestones, drafts, released invoices, CC23 billable, labor) |
| `CostPlusJobHealth` | Full health data for a Cost-Plus job (cadence, unbilled costs/hours, released invoices) |
| `ReleasedInvoiceInfo` | Paid or open invoice with status, amount, name, number |
| `DraftInvoiceInfo` | Draft invoice with task-matching flag |
| `PendingInvoiceInfo` | Sent but unpaid invoice with days pending |
| `MilestoneInfo` | `$` schedule task with due date, overdue flag |
| `BillableItemsSummary` | CC23 uninvoiced items and hours per job |

### 6.5 API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/dashboard/invoicing?cached=true` | Serve cached invoicing data from Supabase |
| `GET /api/dashboard/invoicing?refresh=true` | Run fresh analysis, update cache, return data |
| `POST /api/dashboard/invoicing/create-task` | Create `$` schedule task for unmatched draft invoice |
| `POST /api/agent/invoicing` | Run Claude analysis on invoicing data |
| `GET /api/cron/invoicing-health` | Daily 1 AM EST cron to refresh cache |

---

## 8. Database (Supabase)

### 7.1 Core Tables

| Table | Purpose |
|-------|---------|
| `users` | Platform users (Nathan, Terri, Evan, Josh, Dave, Brett) |
| `projects` | Maps JT jobs ↔ GHL contacts |
| `precon_phases` | 9-phase pre-construction tracking |
| `blockers` | Project impediments |
| `notifications` | User alerts (info, warning, urgent) |

### 7.2 Cache Tables (synced from APIs)

| Table | Source | Why Cached |
|-------|--------|-----------|
| `jt_comments` | JobTread | Full history exceeds API pagination |
| `jt_daily_logs` | JobTread | Full history exceeds API pagination |
| `ghl_messages` | GHL | Conversation threads exceed 40-item cap |
| `ghl_notes` | GHL | Notes exceed pagination |

### 7.3 Platform Feature Tables

| Table | Purpose |
|-------|---------|
| `chat_conversations` | Persistent Ask Agent conversation state |
| `chat_messages` | Individual messages within conversations |
| `agent_cache` | Design Manager analysis reports |
| `agent_dismissals` | Dismissed agent recommendations |
| `sync_log` | Audit trail of sync operations |
| `sync_state` | Active sync tracking with retry |

### 7.4 Document Intelligence (Future)

| Table | Purpose |
|-------|---------|
| `document_sources` | Document metadata |
| `document_chunks` | Vector embeddings (1536-dim, pgvector) |

---

## 9. Sync Pipeline

### 8.1 Automatic Sync
- **Daily 5 AM**: `/api/cron/sync-incremental` syncs all active JT jobs + GHL contacts
- **Daily 6 AM**: `/api/cron/design-agent` runs Design Manager analysis

### 8.2 Manual Sync
- **Force Sync button**: In Ask Agent UI header, calls `/api/sync/force`
- **Per-entity**: `/api/sync/job/[jobId]` or `/api/sync/ghl/[contactId]`

### 8.3 Data Flow
```
GHL API ──→ ghl_messages, ghl_notes (Supabase cache)
JT API  ──→ jt_comments, jt_daily_logs (Supabase cache)
                    ↓
         Know-it-All agent queries Supabase first,
         falls back to live API if needed
```

---

## 10. External Integrations

### 9.1 Go High Level (GHL)
- Base URL: `https://services.leadconnectorhq.com`
- Contacts, conversations, messages, notes, tasks, opportunities, pipelines
- Two service files: `app/api/lib/ghl.ts` (API routes) and `app/lib/ghl.ts` (expanded)

### 9.2 JobTread
- Base URL: `https://api.jobtread.com/pave`
- Jobs, tasks, cost items, documents, comments, daily logs, members
- Two service files: `app/api/lib/jobtread.ts` (API routes) and `app/lib/jobtread.ts` (expanded)

### 9.3 Anthropic Claude
- Used by: all agents, spec writers, design manager, query endpoint
- Model selection varies by endpoint

---

## 11. Environment Variables

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

## 12. Vercel Config

- All API routes: **60 second timeout**
- `/api/chat`: **1024 MB memory** (agent processing)
- Cron: design-agent at 6 AM UTC, sync-incremental at 5 AM UTC, invoicing-health at 6 AM UTC (1 AM EST)
- Auto-deploy on push to `main`

---

## 13. Team Members

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

## 14. Known Gotchas & Warnings

1. **Agent routing**: With two agents (Know-it-All + Project Details), routing is simpler but still score-based. Check both agents when modifying `canHandle()` scores.

2. **Two copies of service files**: GHL and JobTread each have TWO service files — one in `app/api/lib/` (for API routes) and one in `app/lib/` (for expanded platform use). They are NOT the same file.

3. **Spec Writer ≠ Chat Agents**: The Quick Spec Writer (`/dashboard/spec-writer`) has its own generate endpoint (`/api/spec-writer/generate`) with its own system prompt. It does NOT use the chat agent system. Don't modify agents when the spec writer needs fixing.

4. **PDF extraction has two endpoints**: `/api/extract-pdf` (shared, used by Ask Agent and Quick Spec Writer) and `/api/spec-writer/contract/extract-pdf` (contract-specific with page counting).

5. **Mobile page lives outside dashboard layout**: `/m/ask` is at `app/m/` NOT `app/dashboard/ask/mobile/`. This avoids the dashboard header/sidebar wrapper.

6. **Task confirmation is server-side**: The `@@TASK_CONFIRM@@` block is extracted in `/api/chat/route.ts`, NOT in the frontend. The frontend only sees `needsConfirmation: true`.

7. **Editable confirmation cards can cause stale data**: When the user edits the phase dropdown on a TaskConfirmCard, the `phaseId` from the original suggestion becomes stale. The hook deletes the old `phaseId` and sets `phaseChanged: true` — Know-it-All must then look up the correct phase ID via `get_job_schedule`. If this logic is bypassed, tasks get created as orphans.

8. **`create_phase_task` vs `create_jobtread_task`**: Always use `create_phase_task` (with `parentGroupId`) for approved tasks. Using `create_jobtread_task` creates orphan tasks with no phase assignment. The Know-it-All system prompt explicitly forbids `create_jobtread_task` for approved tasks.

9. **Tool param names don't match JSON keys**: The confirmation card JSON uses `assignee` but the tool expects `assignTo`. Similarly `phaseId` maps to `parentGroupId`. The Know-it-All system prompt has an explicit mapping table — if you modify the tool schema, update the mapping too.

10. **PAVE 413 errors are silent killers**: When a PAVE query is too large (too many nested fields/collections), it returns HTTP 413. If this happens inside `Promise.all`, ALL parallel calls fail and return empty arrays. The dashboard silently shows zeros everywhere with no visible error. **Rule: NEVER add a new PAVE query to an existing Promise.all without testing it in isolation first. Keep nested collection queries small (one document at a time, not bulk).**

11. **Budget-level ≠ Document-level cost items**: `job.costItems` (via `getCostItemsForJobLite`) returns ONLY budget/estimate line items. Vendor bill line items, invoice line items, and PO line items are separate **document-level** items accessible only via `document.costItems` (via `getDocumentCostItemsById`). If you need actual costs incurred or amounts billed, you MUST query document-level items. The deprecated `getDocumentCostItemsForJob()` tried to bulk-fetch these but caused 413 errors — do NOT use it.

12. **PAVE `isSelected` only works at document level**: The `isSelected` field on cost items and cost groups is only meaningful when queried from a document context (via `getDocumentCostItemsLightById`). At the budget level (`getCostItemsLightForJob`), `isSelected` returns `false` for everything — it cannot distinguish selected from unselected options. To filter out unselected document options, you MUST query document-level items, collect the unselected IDs, then use those IDs to filter budget-level results.

13. **PAVE field `approvedPrice` does not exist**: Despite being visible in the JobTread UI, `approvedPrice` is not a valid PAVE API field on either document or budget cost items. Do not attempt to use it for filtering. Use `isSelected` instead for option selection status.

14. **Contract vs Cost-Plus logic must stay separate**: Changes to `analyzeContractJob()` must NOT affect `analyzeCostPlusJob()` or vice versa. They interpret the same data differently — contract jobs only count `type === 'Billable'` time entries and CC23 costs; cost-plus jobs count ALL time entries and ALL vendor bill costs. Nathan has explicitly warned about this multiple times.

---

## 15. Changelog

All modifications to the codebase should be logged here with date, files changed, and what was done.

### 2026-03-16 — Fix: Filter Unselected Document Options from Specs Agent

**Problem:** The Specs agent was returning results for cost items that belonged to unselected document options. In JobTread, documents (estimates/contracts) can have multiple option groups (e.g., two flooring choices), and the client selects which ones they want. The agent was showing ALL options regardless of selection status — e.g., "Sterling Quartzite (AKT-LM51)" appeared in results even though only "Alpine Quartzite (AKT-LM50)" was selected.

**Root Cause:** The existing filtering only checked whether a document was approved, not whether individual options within that document were selected. Both selected and unselected option items exist in the budget referencing the same approved document ID.

**Solution:** Used the PAVE API `isSelected` field on document-level cost items to identify and exclude unselected options. The field returns `true` for selected options and `false` for unselected ones. After fetching document items, we build a set of unselected item IDs and filter them out of both the budget-level and document-level results before merging.

**Changes:**
- `app/lib/jobtread.ts` — Added `isSelected: {}` to both cost items and cost groups in the `getDocumentCostItemsLightById()` PAVE query; preserved `isSelected` in the mapped return objects
- `app/api/lib/agents/project-details.ts` — After fetching document items, builds `unselectedItemIds` set from items where `isSelected === false`; filters budget items to exclude unselected IDs; skips unselected items when processing document-level items

**Commits:** `0b8a64e`

---

### 2026-03-15 — Fix: Specs Agent File Links (CDN URLs)

**Problem:** The Specs agent was generating hallucinated file IDs in response links. File URLs pointed to non-existent resources because the AI was fabricating file IDs rather than using actual ones from the data.

**Solution:** Changed file link generation to be server-side rather than AI-generated. File URLs now use the stable CDN pattern `https://cdn.jobtread.com/files/{fileId}` with real file IDs from the PAVE API, appended in the context string that gets passed to Claude. This prevents hallucination since the AI never constructs file URLs — it only references pre-built links.

**Changes:**
- `app/api/lib/agents/project-details.ts` — Modified context builder to append CDN-based file links using actual file IDs from cost items, cost groups, and parent cost groups; updated system prompt to instruct Claude to use file links from the provided data rather than constructing them

**Commits:** `9ee8d33`

---

### 2026-03-13 — Feature: Unpaid Invoice Total on Project Cards

**Problem:** No at-a-glance visibility into how much money is outstanding (invoiced but not yet paid) per project. Users had to expand the invoice details list to mentally sum open invoices.

**Solution:** Added an inline "• $X,XXX unpaid" indicator in yellow (`#eab308`) to the subtitle row of both Contract and Cost Plus cards. Only appears when open (pending) invoices exist — keeps cards clean when everything is paid.

**Implementation:** Computes `unpaidTotal` from `releasedInvoices.filter(status === 'open')` at render time in both card components.

**Changes:**
- `app/dashboard/invoicing/page.tsx` — Added `unpaidTotal` calculation and conditional display to both `ContractJobCard` and `CostPlusJobCard`

**Commits:** `6646b67`

---

### 2026-03-12 — Feature: Collapsible Invoice Details (Draft + Paid + Open)

**Problem:** Project cards showed draft invoices but had no visibility into released invoices (paid or open/pending). Nathan requested a collapsible list showing all invoices with status badges, without making the cards too large.

**Solution:** Built a combined `InvoiceDetails` component replacing the previous `DraftInvoicesList`. Features:
- Single collapsible "Invoices (N)" toggle per card, collapsed by default
- Color-coded status badges: Draft (amber `#CDA274` on `#3a322b`), Paid (green `#4ade80` on `#1a2e1a`), Open (yellow `#eab308` on `#2e2a1a`)
- Shows invoice subject/name and amount for each invoice
- Added to both Contract and Cost Plus card types

**Backend changes:**
- Added `ReleasedInvoiceInfo` interface with `status: 'paid' | 'open'` field
- Added `releasedInvoices: ReleasedInvoiceInfo[]` to both `ContractJobHealth` and `CostPlusJobHealth`
- In `analyzeContractJob()`: builds `releasedInvoiceInfos` from approved (→paid) and pending (→open) customer invoices
- In `analyzeCostPlusJob()`: identical released invoice gathering

**Frontend changes:**
- Added `ReleasedInvoiceInfo` interface and `releasedInvoices` field to both frontend interfaces
- Replaced `DraftInvoicesList` with `InvoiceDetails` component combining drafts + released invoices
- Added `InvoiceDetails` to both `ContractJobCard` and `CostPlusJobCard`

**Changes:**
- `app/lib/invoicing-health.ts` — Added `ReleasedInvoiceInfo` interface, `releasedInvoices` to both job health interfaces, populated in both analyzer functions
- `app/dashboard/invoicing/page.tsx` — Added `ReleasedInvoiceInfo` interface, updated both job health interfaces, new `InvoiceDetails` component, replaced `DraftInvoicesList` usage

**Commits:** `7265a64`

---

### 2026-03-12 — Feature: Collapsible Draft Invoice List + Create $ Task Button

**Problem:** Draft invoices were mentioned in alerts but weren't individually visible on cards. Nathan needed to see each draft invoice and have the ability to create matching `$` schedule tasks directly from the card when a draft had no matching task.

**Solution:** Two additions:
1. `DraftInvoicesList` — collapsible list showing each draft invoice with name and amount
2. `CreateTaskRow` — inline button on unmatched draft invoices that calls `/api/dashboard/invoicing/create-task` to create a `$` schedule task in JobTread. Shows loading/success/error states. Includes duplicate detection.

**Changes:**
- `app/dashboard/invoicing/page.tsx` — Added `DraftInvoicesList` and `CreateTaskRow` components, added to `ContractJobCard`
- `app/api/dashboard/invoicing/create-task/route.ts` — **NEW** API endpoint for creating `$` schedule tasks from draft invoices

---

### 2026-03-12 — Fix: Contract Job Billable Costs & Labor Hours (413 Error Recovery)

**Problem:** Contract (Fixed-Price) jobs were showing $0 for billable costs and 0 hours for billable labor. Two separate issues needed solving:

1. **Billable labor hours** — The dashboard was counting ALL time entries, but contract jobs need to count only entries with `type === 'Billable'` (not `type === 'Standard'`). Standard hours are part of the contract; Billable hours need separate invoicing.

2. **Billable costs ($0)** — The `getCostItemsForJobLite()` function returns **budget-level** cost items only. CC23 costs on vendor bills (e.g., $254.50 + $100.00 = $354.50 on the Sines project) are **document-level** cost items that don't appear in `job.costItems`. A new approach was needed to fetch document-level items.

**Failed approaches (important for future reference):**
- ❌ **Attempt 1** (`a661920`): Changed to "vendor bill costs minus invoice costs" using budget-level `costItems` — still $0 because vendor bill line items aren't in `job.costItems`
- ❌ **Attempt 2** (`0307e88`): Created `getDocumentCostItemsForJob()` with nested query `job.documents.costItems` (50 docs × 50 items) — caused **413 Request Entity Too Large** errors. Since this was inside `Promise.all` with the other 3 API calls, ALL parallel calls failed, returning empty arrays. This broke the ENTIRE dashboard (all jobs showed zeros for everything).

**Final solution** (`bd452c7`):
- Removed `getDocumentCostItemsForJob` from the main batch fetch entirely (reverted to 3 parallel calls: documents, costItems, timeEntries)
- Added `getDocumentCostItemsById(documentId)` — fetches cost items for a single document (tiny query, no 413 risk)
- Inside `analyzeContractJob()` only, identifies vendor bills and customer invoices from the already-fetched `documents` array, then fetches each document's cost items individually
- Filters for CC23 items, sums vendor bill costs minus customer invoice costs = uninvoiced billable amount
- For labor hours: filters time entries by `type === 'Billable'`, sums hours, subtracts CC23 customer invoice quantities (hours already billed)

**Key architectural lesson — Budget-level vs Document-level cost items:**
- `job.costItems` (via `getCostItemsForJobLite`) = budget/estimate line items only
- `document.costItems` (via `getDocumentCostItemsById`) = vendor bill, invoice, PO line items
- To get actual costs incurred or billed, MUST query document-level items
- NEVER use a nested `job.documents.costItems` bulk query — it causes 413 errors

**Verified on Sines project:** $354.50 uninvoiced billable costs (Bill #14: $254.50 + Bill #22: $100.00), 3.9 unbilled labor hours (Cole Kleindienst, 1 Billable entry of 3h 52m)

**Changes:**
- `app/lib/jobtread.ts` — Added `getDocumentCostItemsById()` function for per-document cost item queries
- `app/lib/invoicing-health.ts` — Removed `getDocumentCostItemsForJob` from imports and main batch fetch; reverted to 3 parallel calls; updated `analyzeContractJob()` to fetch CC23 document cost items internally per-document; labor hours now filter by `type === 'Billable'`

**Commits:** `1172770` → `a661920` → `0307e88` (broken) → `bd452c7` (final fix)

---

### 2026-03-12 — UI: Health-Priority Sorting, Condensed Cards, Search

**Problem:** Jobs were grouped by status category (In-Design, Ready, In-Production, Final Billing) with collapsible sub-sections, which meant critical/overdue jobs could be buried inside collapsed groups. Job cards were also too tall, requiring excessive scrolling. No search functionality existed.

**Solution:** Three UI improvements to `app/dashboard/invoicing/page.tsx`:

1. **Health-priority sorting** — Jobs now sort by health severity (critical → overdue → warning → healthy) instead of status category. Removed `groupJobsByStatus()` sub-section grouping and `SubSectionHeader` component. Added `HEALTH_PRIORITY` lookup and `sortByHealthPriority()` helper.

2. **Condensed job cards** — Both `ContractJobCard` and `CostPlusJobCard` redesigned with:
   - Reduced padding (`p-4` → `px-3 py-2.5`)
   - Inline stats row instead of 3-column grid
   - Thinner progress bars (`h-2` → `h-1.5`)
   - Alert rows condensed to single-line `text-[11px]` with inline icons
   - Removed nested background boxes for stats

3. **Search box** — Added a search input that filters all three sections (contract, cost-plus, billable items) by job name, number, or client name. Real-time filtering with clear button.

**Files changed:**
- `app/dashboard/invoicing/page.tsx` — All three changes above
- `ARCHITECTURE.md` — Updated changelog

---

### 2026-03-12 — Revision: Invoicing Health Threshold Overhaul

**Problem:** The original invoicing health thresholds were too simplistic. Contract (Fixed-Price) jobs only tracked milestone due dates and draft invoices — they had no visibility into billable items (Cost Code 23) or billable labor hours accumulating without being invoiced. Draft invoices alone were triggering Warning status, which was noise. Cost-Plus jobs flagged "no invoices ever sent" as a Warning, which wasn't useful for new jobs. Additionally, there was no early warning when a payment milestone was approaching.

**Solution:** Comprehensive threshold revision for both Contract and Cost-Plus job types.

**Contract (Fixed-Price) — New Thresholds:**

| Condition | Status |
|-----------|--------|
| No issues across all checks | Healthy |
| Draft invoice exists with no matching `$` schedule task | Warning |
| `$` milestone task due within 2 days | Warning |
| Uninvoiced billable items (Cost Code 23) > $200 | Warning |
| Unbilled labor hours > 1 hr | Warning |
| Uninvoiced billable items (Cost Code 23) > $800 | Overdue |
| Unbilled labor hours > 3 hrs | Overdue |
| `$` milestone task 1–14 days past due | Overdue |
| `$` milestone task 14+ days past due | Critical |

**Contract — What Changed:**
- **Removed:** Draft invoices alone no longer trigger Warning
- **Added:** Draft invoice with no matching `$` schedule task → Warning (name-based fuzzy matching between draft invoice name and `$` task name minus the `$` prefix)
- **Added:** `$` milestone approaching (due within 2 days) → Warning
- **Added:** Billable items (Cost Code 23 cost items not on a document) → Warning at $200, Overdue at $800
- **Added:** Billable labor (time entries linked to Cost Code 23 items) → Warning at 1 hr, Overdue at 3 hrs
- **Added:** `uninvoicedBillableAmount` and `unbilledLaborHours` fields to `ContractJobHealth` interface
- **Added:** `approachingMilestones` and `unmatchedDraftInvoices` fields to `ContractJobHealth` interface

**Cost-Plus — What Changed:**
- **Removed:** "No invoices ever sent" no longer triggers Warning (was noise for new jobs)
- All other thresholds unchanged (10d warning, 14d overdue, 28d critical, $100 unbilled)

**Implementation Details:**
- `analyzeContractJob()` now accepts `costItems` and `timeEntries` parameters (previously only had `documents`)
- Billable items use same Cost Code 23 filtering as the existing `findBillableItems()` function
- Draft-to-task matching: compares draft invoice name (case-insensitive) against `$` task names with the `$` prefix stripped, using contains matching in both directions
- New `ALERT_THRESHOLDS` constants: `contractBillableWarning: 200`, `contractBillableOverdue: 800`, `contractLaborWarning: 1`, `contractLaborOverdue: 3`, `contractMilestoneApproachingDays: 2`

**Changes:**
- `app/lib/invoicing-health.ts` — Added 5 new threshold constants, 4 new fields to `ContractJobHealth` interface, rewrote `analyzeContractJob()` with new parameters and health logic (billable items, labor hours, approaching milestones, unmatched draft detection), removed "no invoices ever sent" Warning from `analyzeCostPlusJob()`
- `app/dashboard/invoicing/page.tsx` — Updated `ContractJobHealth` interface with 4 new fields, replaced 2-column invoice stats grid with 3-column grid (Approved Inv., Billable Items, Billable Labor), added approaching milestone display with yellow Clock icon, added unmatched draft invoice display, conditional Next Milestone display (hidden if already shown as approaching)

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

### 2026-03-11 — Fix: Use Native priceType Field for Job Classification

**Problem:** The invoicing dashboard was misclassifying most jobs as Cost-Plus when they were actually Fixed-Price. The original heuristic checked for "Billing Items Pending" cost groups and vendor bills to determine price type — this was unreliable and got the majority of jobs wrong (only ~3 Fixed-Price vs ~47 Cost-Plus, when the real split is ~27/23).

**Root Cause:** JobTread has a native `priceType` field on the job entity (values: `"fixed"` or `"costPlus"`) that was not being queried. This field is NOT a custom field — it's a first-class PAVE API field available on every job.

**Solution:** Replaced the ~100-line heuristic with a simple mapping of the native `priceType` field.

**Changes:**
- `app/lib/jobtread.ts` — Added `priceType?: string | null` to `JTJob` interface, added `priceType: {}` to the PAVE query in `getActiveJobs()`, mapped `priceType` in return object
- `app/lib/invoicing-health.ts` — Replaced heuristic classification block with native priceType mapping (`"fixed"` → Fixed-Price, `"costPlus"` → Cost-Plus), removed ~100 lines of dead heuristic code and unused `getJobPriceType()` function

**Commits:** `e30244a`

### 2026-03-11 — Feature: Group Jobs by Status Category with Collapsible Sections

**Problem:** The invoicing dashboard listed all jobs in a flat grid. Nathan needed jobs grouped by their project lifecycle stage (based on the custom "Status" field in JobTread) with the ability to collapse/expand each group.

**Solution:** Added status category grouping with collapsible sub-sections to both the Contract and Cost-Plus job panels.

**Status Categories (mapped from JT custom "Status" field):**
- In-Design = `"5. Design Phase"`
- Ready = `"10. Ready"`
- In-Production = `"6. In Production"`
- Final Billing = `"7. Final Billing"`
- Other = anything not matching above (auto-filtered if empty)

**Key Implementation Details:**
- Generic `groupJobsByStatus<T>()` helper works with any job type (Contract, CostPlus, Billable) as long as it has `customStatus`
- `SubSectionHeader` component with job count badge and expand/collapse toggle
- In-Production and Final Billing default to expanded; In-Design and Ready default to collapsed
- Empty categories are automatically hidden

**Changes:**
- `app/lib/invoicing-health.ts` — Added `customStatus: string | null` to `ContractJobHealth`, `CostPlusJobHealth`, and `BillableItemsSummary` interfaces; populated from `job.customStatus` in all three analysis functions
- `app/dashboard/invoicing/page.tsx` — Added `STATUS_CATEGORIES` constant, `getStatusCategory()` and `groupJobsByStatus()` helpers, `SubSectionHeader` component, sub-section expand/collapse state management; replaced flat job grids with grouped collapsible views in both Contract and Cost-Plus sections

**Commits:** `fb284b3`

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
