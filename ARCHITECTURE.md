# BKB Client Intel ÃÂ¢ÃÂÃÂ Architecture & System Reference

> **IMPORTANT FOR AI ASSISTANTS:** Read this document at the START of every session before making any code changes. Update the changelog at the END of every session where files were modified.
>
> **Nathan:** If starting a new conversation, mention this doc or say "review the architecture doc" so the assistant knows to read it first.

**Last updated:** 2026-03-28
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
ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ page.tsx                          # Redirects to /dashboard (legacy chat UI at page-legacy.tsx)
ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ layout.tsx                        # Root HTML layout + viewport meta
ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ hooks/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ useAskAgent.ts               # ÃÂ¢ÃÂÃÂ Shared hook for Ask Agent (desktop + mobile)
ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ m/                                # Mobile routes (NO dashboard chrome)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ layout.tsx                    # Minimal full-screen layout
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ ask/page.tsx                  # Mobile Ask Agent (/m/ask)
ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ dashboard/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ layout.tsx                    # Dashboard shell (header + 4-item sidebar + Ask Agent button + auth gate)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ page.tsx                      # Overview ÃÂ¢ÃÂÃÂ time-aware AI briefing, tasks, calendar, email, chat
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ login/page.tsx                # Per-user PIN login (setup + sign-in flow)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ components/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ AskAgentPanel.tsx         # Slide-out Ask Agent panel (Know-it-All / Approved Specs toggle)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ ask/page.tsx                  # Desktop Ask Agent (/dashboard/ask)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ documents/page.tsx            # Document intelligence (placeholder)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ precon/                       # Pre-Construction module
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ page.tsx                  # Agent recommendations + orphan panel
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ [jobId]/page.tsx          # Individual job schedule/phases
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ audit/page.tsx            # Audit ÃÂ¢ÃÂÃÂ misplaced/orphan task analysis
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ setup/page.tsx            # Survey-based schedule setup wizard
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ OrphanTaskPanel.tsx       # Orphan task reassignment component
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ invoicing/page.tsx             # Invoicing Health Dashboard (health-sorted cards, invoice details)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ spec-writer/
ÃÂ¢ÃÂÃÂ       ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ page.tsx                  # Quick Spec Writer (upload + generate)
ÃÂ¢ÃÂÃÂ       ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ contract/page.tsx         # Contract Spec Builder (cost-item based)
ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ api/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ chat/route.ts                 # ÃÂ¢ÃÂÃÂ Main chat endpoint ÃÂ¢ÃÂÃÂ agent router
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ auth/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ route.ts                  # Per-user PIN auth (login, setup, check)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ google-callback/route.ts  # Google OAuth callback (one-time setup for Gmail/Calendar)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ extract-pdf/route.ts          # PDF ÃÂ¢ÃÂÃÂ text extraction (shared)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ conversations/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ route.ts                  # List/create conversations
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ [id]/route.ts            # Get/add messages/delete conversation
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ setup/route.ts           # Initialize conversation tables
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ lib/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ agents/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ router.ts            # ÃÂ¢ÃÂÃÂ Agent routing ÃÂ¢ÃÂÃÂ canHandle() scoring
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ types.ts             # Shared types, stage mappings
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ know-it-all.ts       # ÃÂ¢ÃÂÃÂ Unified Ask agent (Q&A + JT read/write, 39 tools)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ jt-entry.ts          # (DEPRECATED ÃÂ¢ÃÂÃÂ merged into know-it-all)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ project-details.ts   # Project specs agent (PAVE cost items)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ auth.ts                  # validateAuth() helper
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ ghl.ts                   # GHL API service (API routes)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ jobtread.ts              # JobTread PAVE service (API routes)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ supabase.ts              # Supabase service-role client
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ sync/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ route.ts                 # Main sync (GHL + JT ÃÂ¢ÃÂÃÂ Supabase)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ force/route.ts           # Force-sync (bypass throttle)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ backfill/route.ts        # Historical batch sync
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ ghl/[contactId]/route.ts # Single GHL contact sync
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ job/[jobId]/route.ts     # Single JT job sync
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ spec-writer/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ generate/route.ts        # Quick spec generation
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ questions/route.ts       # Category Q&A generation
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ contract/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ       ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ generate/route.ts    # Contract spec generation
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ       ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ extract-pdf/route.ts # Contract PDF extraction
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ       ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ budget/route.ts      # Cost hierarchy builder
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ       ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ questions/route.ts   # Contract Q&A generation
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ       ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ save/route.ts        # Save spec to JT cost group
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ dashboard/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ invoicing/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ route.ts             # Invoicing health data endpoint (cached)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ create-task/route.ts # Create $ schedule task for unmatched draft invoices
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ create-invoice/route.ts        # One-click draft invoice for Cost-Plus jobs (with AI descriptions)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ create-billable-invoice/route.ts # One-click draft invoice for Fixed-Price CC23 billable items
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ reorganize-invoice/route.ts    # Reorganize Cost-Plus invoice into BKB 3-group format
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ queue-invoice/route.ts         # Queue invoice creation request (Supabase ÃÂ¢ÃÂÃÂ scheduled task)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ projects/route.ts        # Active projects list
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ tasks/route.ts           # Task list + PATCH for complete/update
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ chat/route.ts           # Dashboard chat widget endpoint (separate from Ask Agent)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ inbox-cleanup/route.ts  # AI-powered email triage + archive
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ quick-action/route.ts   # Do Now action handler (Gmail draft creation)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ overview/route.ts       # Dashboard overview data + AI analysis (cached)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ schedule/route.ts        # Schedule multi-view endpoint
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ schedule-setup/route.ts  # Survey-based schedule builder
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ agent/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ design-manager/route.ts  # Design Manager analysis + actions
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ invoicing/route.ts       # Invoicing health Claude analysis
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ pml/                            # ÃÂ¢ÃÂÃÂ Project Memory Layer (PLANNED)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ route.ts                    # CRUD for project_events (GET list, POST create)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ [eventId]/route.ts          # GET/PATCH single event (resolve, update)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ open-items/route.ts         # GET all unresolved open items
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ cron/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ design-agent/route.ts    # Daily 6 AM ÃÂ¢ÃÂÃÂ design analysis
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ invoicing-health/route.ts # Daily 6 AM ÃÂ¢ÃÂÃÂ invoicing data refresh
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ inbox-cleanup/route.ts   # Hourly ÃÂ¢ÃÂÃÂ AI email triage + auto-archive
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ gmail-to-pml/route.ts    # ÃÂ¢ÃÂÃÂ Hourly ÃÂ¢ÃÂÃÂ Gmail sent+inbox ÃÂ¢ÃÂÃÂ project_events (PLANNED)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ sync-incremental/route.ts # Daily 5 AM ÃÂ¢ÃÂÃÂ incremental sync
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ contacts/route.ts            # Contact search
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ notes/route.ts               # Create contact notes (chunked)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ opportunities/route.ts       # Opportunities with pipeline data
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ query/route.ts               # General-purpose Q&A endpoint
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ debug/route.ts               # Environment health check
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ jobtread-test/route.ts       # PAVE API diagnostic
ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ lib/
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ project-memory.ts             # ÃÂ¢ÃÂÃÂ PML service: queries, event creation, resolution, matching (PLANNED)
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ gmail-sync.ts                 # ÃÂ¢ÃÂÃÂ Gmail sent+inbox sync, thread tracking, reply detection (PLANNED)
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ invoicing-health.ts           # Invoicing health analysis (contract + cost-plus, CC23 billable, released invoices)
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ google-api.ts                # Google OAuth2 helper ÃÂ¢ÃÂÃÂ Gmail inbox/archive/drafts + Calendar events
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ dashboard-data.ts            # Dashboard data aggregation (JT tasks, comments, Gmail, Calendar, time context)
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ dashboard-analysis.ts        # AI analysis engine ÃÂ¢ÃÂÃÂ time-aware briefings, quick actions, tomorrow preview
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ nathan-voice.ts              # Nathan's brand voice rules for AI writing (condensed from v5 doc)
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ nathan-brand-voice.md        # Full brand voice document (reference)
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ bkb-spec-guide.ts            # BKB 23-category spec system + prompts
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ bkb-standards.ts             # Standard construction practices
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ bkb-brand-voice.ts           # Brand voice + email writing guide
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ cache.ts                     # Supabase cache read/write/clear
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ constants.ts                 # Colors, phases, statuses, rules
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ contact-mapper.ts            # Fuzzy name ÃÂ¢ÃÂÃÂ GHL contact matching
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ design-agent.ts              # Design Manager data + analysis
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ ghl.ts                       # GHL API service (expanded)
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ jobtread.ts                  # JobTread PAVE service (expanded)
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ supabase.ts                  # Supabase client factory
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ schedule-templates.ts        # 9-phase schedule template + tasks
    ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ survey-templates.ts          # Project scope survey definitions
```

---

## 3. Agent System ÃÂ¢ÃÂÃÂ HOW IT WORKS

This is the most important section. The agent system has two agents and a router.

### 3.1 Routing Flow

```
User message ÃÂ¢ÃÂÃÂ /api/chat ÃÂ¢ÃÂÃÂ router.ts ÃÂ¢ÃÂÃÂ canHandle() on each agent ÃÂ¢ÃÂÃÂ highest score wins ÃÂ¢ÃÂÃÂ agent.handle()
```

- Each agent has a `canHandle(message)` function returning a score 0ÃÂ¢ÃÂÃÂ1
- The router picks the agent with the highest score
- The `forcedAgent` parameter can override routing (used by Ask Agent page)
- `lastAgent` provides sticky routing for follow-up messages

### 3.2 Agents

| Agent | File | Score Range | What It Does |
|-------|------|-------------|-------------|
| **Know-it-All** | `know-it-all.ts` | 0.05ÃÂ¢ÃÂÃÂ0.95 | Unified Ask agent ÃÂ¢ÃÂÃÂ full JT read+write (39 tools), Supabase + GHL search, email drafting, material specs, task creation/updates |
| **Project Details** | `project-details.ts` | 0.1ÃÂ¢ÃÂÃÂ0.9 | Answers questions about specs from project's Specifications URL via PAVE cost items |

> **Note:** JT Entry (`jt-entry.ts`) was merged into Know-it-All as of 2026-03-07. The file still exists but is no longer registered in the router.

### 3.3 Routing Gotchas

- Know-it-All handles ALL task operations (read + write) ÃÂ¢ÃÂÃÂ there is no separate write agent
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

[APPROVED TASK DATA ÃÂ¢ÃÂÃÂ execute this now using create_phase_task tool]
{"name":"...","phase":"...","phaseId":"...","assignee":"...","endDate":"..."}
```

**Field mapping** (JSON ÃÂ¢ÃÂÃÂ `create_phase_task` tool params):
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
- `CONFIRMATION_PATTERN` ÃÂ¢ÃÂÃÂ "yes", "ok", "proceed", etc.
- `EXTENDED_CONFIRM_PATTERN` ÃÂ¢ÃÂÃÂ "Yes, proceed but ..."
- `APPROVED_TASK_PATTERN` ÃÂ¢ÃÂÃÂ messages containing `[APPROVED TASK DATA`

---

## 4. Ask Agent ÃÂ¢ÃÂÃÂ Shared Hook Architecture

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

## 5. Spec Writer ÃÂ¢ÃÂÃÂ Two Modes

### 5.1 Quick Spec Writer (`/dashboard/spec-writer`)
- User uploads files (PDF, TXT, MD) + types a prompt
- PDFs are extracted client-side via `/api/extract-pdf`
- Sent to `/api/spec-writer/generate` with system prompt containing BKB standards
- **Vendor Estimate Mode**: When a PDF is a vendor estimate/invoice, the system prompt instructs Claude to extract actual product names, sizes, colors ÃÂ¢ÃÂÃÂ NOT generic "tbd per owner selection" boilerplate

### 5.2 Contract Spec Writer (`/dashboard/spec-writer/contract`)
- Works from JobTread cost items (budget hierarchy)
- Generates detailed contract specifications per BKB's 23-category system
- Can save specs back to JobTread cost groups

### 5.3 Key Files
- `app/lib/bkb-spec-guide.ts` ÃÂ¢ÃÂÃÂ Categories 01ÃÂ¢ÃÂÃÂ23, system prompts
- `app/lib/bkb-standards.ts` ÃÂ¢ÃÂÃÂ Standard construction practices by category
- `app/api/spec-writer/generate/route.ts` ÃÂ¢ÃÂÃÂ Quick spec endpoint (has vendor estimate mode)

---

## 6. Specs Agent (Project Details) ÃÂ¢ÃÂÃÂ Data Flow

The **Project Details** agent (`project-details.ts`) answers spec/selection questions about a focused job. It uses a single tool `get_project_details` that fetches cost items from approved JobTread documents and returns them to Claude for answering.

### 6.1 Data Retrieval Pipeline

1. **Fetch all budget cost items** via `getCostItemsLightForJob(jobId)` ÃÂ¢ÃÂÃÂ returns every cost item in the job's budget with cost groups, files, and document references
2. **Identify approved documents** ÃÂ¢ÃÂÃÂ filters for customer orders/invoices with `status === 'approved'` or `status === 'pending'`
3. **Filter budget items** ÃÂ¢ÃÂÃÂ keeps only items that reference an approved document ID
4. **Fetch document-level items** via `getDocumentCostItemsLightById(docId)` for each approved document ÃÂ¢ÃÂÃÂ this catches Change Order items whose budget-level entries lack a document reference
5. **Filter out unselected options** ÃÂ¢ÃÂÃÂ uses PAVE `isSelected` field to exclude items the client did NOT select (see below)
6. **Merge** ÃÂ¢ÃÂÃÂ combines filtered budget items + selected document-level items (deduped by ID)
7. **Build context string** ÃÂ¢ÃÂÃÂ formats items with names, descriptions, cost codes, cost groups, and file links
8. **Append file links** ÃÂ¢ÃÂÃÂ file URLs use the JobTread CDN pattern: `https://cdn.jobtread.com/files/{fileId}` (appended server-side, not from PAVE URL field)

### 6.2 Document Options & `isSelected` Filtering

JobTread documents (estimates, contracts) can have **options** ÃÂ¢ÃÂÃÂ alternative cost groups where the client selects which ones they want. For example, a flooring section might offer "Alpine Quartzite" and "Sterling Quartzite" as two options, but the client only selects one.

**Key PAVE API behavior:**
- `isSelected` is available on document-level cost items AND cost groups (via `getDocumentCostItemsLightById`)
- `isSelected: true` = client selected this option
- `isSelected: false` = client did NOT select this option (should be excluded from results)
- `isSelected` on budget-level (job) cost items always returns `false` ÃÂ¢ÃÂÃÂ it's only meaningful at the document level
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
| `app/api/lib/agents/project-details.ts` | Specs agent ÃÂ¢ÃÂÃÂ system prompt, `get_project_details` tool, context builder |
| `app/lib/jobtread.ts` (`getDocumentCostItemsLightById`) | Fetches cost items from a single document with `isSelected` field |
| `app/lib/jobtread.ts` (`getCostItemsLightForJob`) | Fetches all budget cost items for a job |

---

## 7. Invoicing Health Dashboard

The Invoicing Health Dashboard (`/dashboard/invoicing`) provides a centralized view of invoicing health across all active JobTread projects. It has a backend analysis layer, cached API endpoint, agent-powered recommendations, and a rich frontend with project cards.

### 6.1 Architecture

```
Daily 1 AM EST cron ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ /api/cron/invoicing-health ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ buildInvoicingContext() ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Supabase cache
                                                                                          ÃÂ¢ÃÂÃÂ
User visits dashboard ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ /api/dashboard/invoicing?cached=true ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ reads Supabase cache ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ UI
User clicks Refresh   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ /api/dashboard/invoicing?refresh=true ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ fresh buildInvoicingContext() ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ UI + cache
```

### 6.2 Data Layer (`app/lib/invoicing-health.ts`)

Core analysis function `buildInvoicingContext()` fetches all active jobs via PAVE API, classifies by native `priceType` field (`fixed` ÃÂ¢ÃÂÃÂ Fixed-Price, `costPlus` ÃÂ¢ÃÂÃÂ Cost-Plus), then runs type-specific analyzers:

**analyzeContractJob()** ÃÂ¢ÃÂÃÂ Fixed-Price jobs:
- Milestone tracking via `$` prefix schedule tasks (approaching, overdue)
- Draft invoice ÃÂ¢ÃÂÃÂ `$` task matching (fuzzy name match, extracts parenthesized labels)
- Uninvoiced billable items: CC23 items with costType "Materials" or "Subcontractor" on vendor bills minus same on customer invoices (costCode + costType filter, not name prefix)
- Unbilled labor hours: CC23 time entries minus CC23 invoice items where name contains "labor" (name-based filter ÃÂ¢ÃÂÃÂ labor invoice items use costType "Other", not "Labor")
- Denied vendor bills (deleted in JobTread) are excluded via `status !== 'denied'`
- Released invoices (approved ÃÂ¢ÃÂÃÂ paid, pending ÃÂ¢ÃÂÃÂ open) with amounts
- Health thresholds: milestone overdue (14d+ = critical), billable items ($200 warning / $800 overdue), labor hours (1h warning / 3h overdue)

**analyzeCostPlusJob()** ÃÂ¢ÃÂÃÂ Cost-Plus jobs:
- Billing cadence tracking (days since last invoice, 14-day target)
- Unbilled costs (vendor bill costs minus invoiced costs)
- Unbilled hours (total time entries minus invoiced labor hours)
- Released invoices (approved ÃÂ¢ÃÂÃÂ paid, pending ÃÂ¢ÃÂÃÂ open) with amounts
- Health thresholds: 10d warning, 14d overdue, 28d critical, $100 unbilled

**findBillableItems()** ÃÂ¢ÃÂÃÂ CC23 billable items panel (non-contract jobs only)

### 6.3 Frontend (`app/dashboard/invoicing/page.tsx`)

**Summary row:** 5 stat cards (Open Jobs, Alerts, Unbilled Items, Unbilled Hours, Overall Health)

**Search:** Real-time filter by job name, number, or client name across all sections

**Contract (Fixed-Price) Job Cards:**
- Header: job name + health badge (healthy/warning/overdue/critical)
- Subtitle: invoiced / contract total + unpaid amount (yellow, if any) + invoiced %
- Progress bar: invoiced % of contract value
- Inline stats: Billable items amount + unbilled labor hours
- Alerts: approaching milestones, overdue milestones, unmatched drafts (with Create Task button), pending invoices awaiting payment
- **"Create Billable Invoice" button**: One-click creates a draft customer invoice from CC23 billable items (materials/subs on vendor bills not yet on customer invoices) plus unbilled CC23 labor hours. Sub-grouped by vendor bill source. Labor billed at $85/$115 per hour with worker breakdown in description.
- Collapsible invoice details: Draft (amber) / Paid (green) / Open (yellow) badges

**Cost Plus Job Cards:**
- Header: job name + health badge
- Subtitle: total invoiced + unbilled amount + unpaid amount (yellow, if any) + days since last invoice
- Progress bar: days since last invoice (colored by cadence health)
- Inline stats: unbilled costs + unbilled hours + total billed
- Alerts: billing cadence warnings
- **"Create Draft Invoice" button**: One-click creates a draft customer invoice in JobTread with all unbilled budget items (excludes $0.00 placeholders). Groups: Materials first ÃÂ¢ÃÂÃÂ Admin ÃÂ¢ÃÂÃÂ Subcontractor ÃÂ¢ÃÂÃÂ Other ÃÂ¢ÃÂÃÂ Labor last. Material items get auto-generated descriptions from cost code info.
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
| `POST /api/dashboard/invoicing/create-invoice` | Create draft Cost-Plus invoice with AI-rewritten descriptions (vendor bills + time entries) |
| `POST /api/dashboard/invoicing/create-billable-invoice` | Create draft Fixed-Price invoice (CC23 billable items + labor) with AI descriptions |
| `POST /api/dashboard/invoicing/reorganize-invoice` | Reorganize Cost-Plus invoice into BKB 3-group format (Trade Partners / Materials / BKB Labor) |
| `POST /api/dashboard/invoicing/queue-invoice` | Queue invoice creation request into Supabase for scheduled task processing |
| `POST /api/agent/invoicing` | Run Claude analysis on invoicing data |
| `GET /api/cron/invoicing-health` | Daily 1 AM EST cron to refresh cache |

---

## 8. Database (Supabase)

### 7.1 Core Tables

| Table | Purpose |
|-------|---------|
| `users` | Platform users (Nathan, Terri, Evan, Josh, Dave, Brett) |
| `projects` | Maps JT jobs ÃÂ¢ÃÂÃÂ GHL contacts |
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

### 7.4 Project Memory Layer (Planned)

| Table | Purpose |
|-------|---------|
| `project_events` | Unified project communication events from all channels (Gmail, JT, texts, phone, meetings, manual notes). See Section 15 for full schema. |

### 7.5 Document Intelligence (Future)

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
GHL API ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ ghl_messages, ghl_notes (Supabase cache)
JT API  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ jt_comments, jt_daily_logs (Supabase cache)
                    ÃÂ¢ÃÂÃÂ
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

2. **Two copies of service files**: GHL and JobTread each have TWO service files ÃÂ¢ÃÂÃÂ one in `app/api/lib/` (for API routes) and one in `app/lib/` (for expanded platform use). They are NOT the same file.

3. **Spec Writer ÃÂ¢ÃÂÃÂ  Chat Agents**: The Quick Spec Writer (`/dashboard/spec-writer`) has its own generate endpoint (`/api/spec-writer/generate`) with its own system prompt. It does NOT use the chat agent system. Don't modify agents when the spec writer needs fixing.

4. **PDF extraction has two endpoints**: `/api/extract-pdf` (shared, used by Ask Agent and Quick Spec Writer) and `/api/spec-writer/contract/extract-pdf` (contract-specific with page counting).

5. **Mobile page lives outside dashboard layout**: `/m/ask` is at `app/m/` NOT `app/dashboard/ask/mobile/`. This avoids the dashboard header/sidebar wrapper.

6. **Task confirmation is server-side**: The `@@TASK_CONFIRM@@` block is extracted in `/api/chat/route.ts`, NOT in the frontend. The frontend only sees `needsConfirmation: true`.

7. **Editable confirmation cards can cause stale data**: When the user edits the phase dropdown on a TaskConfirmCard, the `phaseId` from the original suggestion becomes stale. The hook deletes the old `phaseId` and sets `phaseChanged: true` ÃÂ¢ÃÂÃÂ Know-it-All must then look up the correct phase ID via `get_job_schedule`. If this logic is bypassed, tasks get created as orphans.

8. **`create_phase_task` vs `create_jobtread_task`**: Always use `create_phase_task` (with `parentGroupId`) for approved tasks. Using `create_jobtread_task` creates orphan tasks with no phase assignment. The Know-it-All system prompt explicitly forbids `create_jobtread_task` for approved tasks.

9. **Tool param names don't match JSON keys**: The confirmation card JSON uses `assignee` but the tool expects `assignTo`. Similarly `phaseId` maps to `parentGroupId`. The Know-it-All system prompt has an explicit mapping table ÃÂ¢ÃÂÃÂ if you modify the tool schema, update the mapping too.

10. **PAVE 413 errors are silent killers**: When a PAVE query is too large (too many nested fields/collections), it returns HTTP 413. If this happens inside `Promise.all`, ALL parallel calls fail and return empty arrays. The dashboard silently shows zeros everywhere with no visible error. **Rule: NEVER add a new PAVE query to an existing Promise.all without testing it in isolation first. Keep nested collection queries small (one document at a time, not bulk).**

11. **Budget-level ÃÂ¢ÃÂÃÂ  Document-level cost items**: `job.costItems` (via `getCostItemsForJobLite`) returns ONLY budget/estimate line items. Vendor bill line items, invoice line items, and PO line items are separate **document-level** items accessible only via `document.costItems` (via `getDocumentCostItemsById`). If you need actual costs incurred or amounts billed, you MUST query document-level items. The deprecated `getDocumentCostItemsForJob()` tried to bulk-fetch these but caused 413 errors ÃÂ¢ÃÂÃÂ do NOT use it.

12. **PAVE `isSelected` only works at document level**: The `isSelected` field on cost items and cost groups is only meaningful when queried from a document context (via `getDocumentCostItemsLightById`). At the budget level (`getCostItemsLightForJob`), `isSelected` returns `false` for everything ÃÂ¢ÃÂÃÂ it cannot distinguish selected from unselected options. To filter out unselected document options, you MUST query document-level items, collect the unselected IDs, then use those IDs to filter budget-level results.

13. **PAVE field `approvedPrice` does not exist**: Despite being visible in the JobTread UI, `approvedPrice` is not a valid PAVE API field on either document or budget cost items. Do not attempt to use it for filtering. Use `isSelected` instead for option selection status.

14. **Contract vs Cost-Plus logic must stay separate**: Changes to `analyzeContractJob()` must NOT affect `analyzeCostPlusJob()` or vice versa. They interpret the same data differently ÃÂ¢ÃÂÃÂ contract jobs only count `type === 'Billable'` time entries and CC23 costs; cost-plus jobs count ALL time entries and ALL vendor bill costs. Nathan has explicitly warned about this multiple times.

15. **Fixed-Price billable detection uses costCode + costType, NOT name prefix**: For Fixed-Price jobs (`analyzeContractJob`), billable items are identified by `costCode.number === '23'` AND `costType.name` being "Materials" or "Subcontractor". Do NOT use `name.startsWith('23 Billable')` ÃÂ¢ÃÂÃÂ that misses items with non-standard names. Cost-Plus jobs (`analyzeCostPlusJob`) and `findBillableItems()` still use the old name prefix filter `BILLABLE_NAME_PREFIX`.

16. **Labor hours on invoices use costType "Other", not "Labor"**: When deducting billed labor hours from the total, match by item **name** (contains "labor"), NOT by `costType.name === 'Labor'`. In BKB's JobTread setup, billable labor line items on customer invoices are created with costType "Other". The costType "Labor" is for internal labor costs on vendor bills.

17. **Deleted vendor bills have `status: 'denied'`**: When bills are deleted in JobTread, they aren't removed from the API ÃÂ¢ÃÂÃÂ they get `status: 'denied'`. All analysis functions must filter these out with `status !== 'denied'` to avoid counting deleted bill costs in totals.

18. **PAVE `createDocument` required fields**: `jobId`, `type`, `name` (must be exactly "Deposit", "Invoice", or "Progress Invoice"), `fromName`, `toName`, `taxRate`, `jobLocationName`, `jobLocationAddress`, `dueDays` (or `dueDate`). Omitting `jobLocationName`/`jobLocationAddress` or `dueDays` produces cryptic errors. BKB defaults: `fromName: 'Terri (Brett King Builder-Contractor Inc.)'`, `dueDays: 2`, `taxRate: '0'`.

19. **PAVE `createCostItem` on customer invoices requires `jobCostItemId`**: When adding cost items to a customer invoice, you MUST provide `jobCostItemId` (the ID of the budget cost item this line links to). Without it, creation fails. This is NOT required for vendor bills or estimates.

20. **No bulk/copy PAVE mutations**: There are no bulk-create or document-copy mutations. Creating a draft invoice with 50+ items requires sequential calls: one `createDocument`, then N `createCostGroup` + M `createCostItem` calls. Use `maxDuration = 60` on the API route.

21. **PAVE `document.costItems` vs `job.costItems`**: A budget item (from `job.costItems`) can be referenced by multiple document items. The PAVE `document` field on a budget item returns only ONE linked document. To check if a budget item appears on a customer invoice, query the customer invoice's `costItems` and check their `jobCostItem.id` values against the budget item ID.

22. **Cost-Plus = ALL hours billable, Fixed-Price = ONLY CC23 hours**: This is a critical business rule. Cost-Plus jobs bill all time entries regardless of cost code. Fixed-Price jobs ONLY bill time entries tagged to Cost Code 23. Nathan has explicitly corrected this twice ÃÂ¢ÃÂÃÂ do not change this behavior.

23. **PML: Never auto-send follow-up emails**: The Project Memory Layer may surface open items where an email was sent but no reply received. Follow-up draft emails must ALWAYS be suggested as "Do Now" actions requiring Nathan's approval ÃÂ¢ÃÂÃÂ NEVER auto-sent. The system cannot know if the answer came via phone call, text, or in-person conversation. This is a hard rule.

24. **PML: Gmail deduplication uses `source_ref.message_id`**: Each Gmail message has a unique message ID. The sync must check for existing `project_events` with matching `source_ref.message_id` before creating new entries. Without this, re-syncs create duplicate events.

25. **PML: `project_events` is append-mostly**: Events should rarely be deleted. Resolution is done by setting `resolved: true`, not by removing the event. The full history is valuable for project status analysis. Only deduplication cleanup should delete rows.

26. **PML: Email-to-project matching is probabilistic**: Not every email will match a project. Events with `job_id: null` are valid ÃÂ¢ÃÂÃÂ they still appear in global agent context. Nathan can manually link them later via conversation. Do not force-match ambiguous emails.

27. **PAVE sub-collections cap at 100 entries, oldest-first, no sort/offset**: `job.timeEntries`, `job.costItems`, and similar sub-collections return a maximum of 100 entries in creation order (oldest first). PAVE does NOT support `offset`, `after`, `pageInfo`, `sort`, or `orderBy` on these sub-collections. To paginate, use `where: ["id", ">", lastId]` which exploits PAVE's deterministic ID ordering. Always paginate any sub-collection that could exceed 100 entries ÃÂ¢ÃÂÃÂ silently losing the newest entries causes subtle data bugs (e.g., Halvorsen's 102.5 CC23 hours showing as 0 because all 18 entries fell past position 100).

---

## 15. Project Memory Layer (PML)

> **Status:** Architecture approved, not yet implemented. This section defines the target design for a unified project communication intelligence system.

### 15.1 Problem Statement

Project communication at BKB is fragmented across multiple channels: Gmail (sent and received), JobTread comments, iMessages/texts, phone calls, in-person conversations, and client meetings. Currently:

- The dashboard briefing only sees the last 3 days of inbox emails and 7 days of JT comments ÃÂ¢ÃÂÃÂ no persistent memory
- Sent emails are invisible to the system (Gmail integration is inbox-only)
- There is no way to link an email thread or text conversation to a specific JT job
- Meeting transcripts (from Plaud.ai) have no storage location and are lost after the meeting
- Phone call outcomes and in-person decisions are completely invisible to the AI
- Nathan must manually search Gmail, then JobTread, then recall conversations to piece together a project's current status

The Project Memory Layer (PML) solves this by creating a single unified knowledge base where every meaningful project event is captured, regardless of channel. The AI agent queries this one layer to have the full story on any project.

### 15.2 Core Design: `project_events` Table

One Supabase table captures all project communication and context:

```sql
create table project_events (
  id uuid primary key default gen_random_uuid(),
  job_id text,                          -- linked JT job ID
  job_name text,                        -- denormalized for display
  job_number text,                      -- denormalized for display
  channel text not null,                -- 'gmail' | 'jobtread' | 'text' | 'phone' | 'in_person' | 'meeting' | 'manual_note'
  event_type text not null,             -- 'message_sent' | 'message_received' | 'meeting_held' | 'decision_made' |
                                        -- 'question_asked' | 'question_answered' | 'commitment_made' | 'status_update' | 'note'
  summary text not null,                -- AI-generated or human-written short summary (1-2 sentences)
  detail text,                          -- full content (email body, transcript text, note)
  participants text[],                  -- who was involved (names)
  source_ref jsonb,                     -- channel-specific reference:
                                        --   gmail: { thread_id, message_id, subject, from, to }
                                        --   jobtread: { comment_id, daily_log_id }
                                        --   text: { contact_id, contact_display }
                                        --   meeting: { transcript_length, plaud_source: true }
  related_event_id uuid references project_events(id),  -- links answerÃÂ¢ÃÂÃÂquestion, replyÃÂ¢ÃÂÃÂoriginal
  open_item boolean default false,      -- is this waiting on something?
  open_item_description text,           -- "Waiting on closet pricing from supplier"
  resolved boolean default false,
  resolved_at timestamptz,
  resolved_note text,                   -- "Supplier called with pricing, $4,200"
  auto_resolved boolean default false,  -- true when resolved by Gmail reply detection vs manual
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes for common query patterns
create index idx_project_events_job_id on project_events(job_id);
create index idx_project_events_open_items on project_events(open_item, resolved) where open_item = true and resolved = false;
create index idx_project_events_channel on project_events(channel);
create index idx_project_events_created on project_events(created_at desc);
create index idx_project_events_source_ref on project_events using gin(source_ref);
```

### 15.3 Data Flows ÃÂ¢ÃÂÃÂ How Information Enters PML

#### Auto-Synced Channels (no user action required)

**Gmail Sync (sent + received)**
- Extend `google-api.ts` to fetch sent mail in addition to inbox
- A cron job (extend the existing hourly inbox cleanup or 5 AM sync) reads both inbox and sent folders
- AI classifies each email: which project does it relate to? Is it asking a question that expects a reply? What's the summary?
- Project matching: cross-reference sender/recipient email addresses and names against JT job accounts and contacts
- Creates `project_events` entries with `channel: 'gmail'`
- Outbound emails asking questions get `open_item: true` with AI-estimated `reply_by` (default: 3 business days)
- When a reply is detected on a watched thread (matched by `source_ref.thread_id`), the original open item is auto-resolved with `auto_resolved: true`
- Deduplication: `source_ref.message_id` prevents duplicate entries on re-sync

**JobTread Comments & Daily Logs**
- Already synced to `jt_comments` and `jt_daily_logs` cache tables
- Additionally write to `project_events` with `channel: 'jobtread'` during the existing sync
- Existing cache tables remain for backward compatibility with current dashboard queries

**iMessages/Texts**
- Already synced via Mac LaunchAgent to `agent_cache` key `nathan-recent-texts`
- Additionally write to `project_events` with `channel: 'text'` during sync
- AI-based project matching using contact name/number against JT job accounts

#### Manual Channels (Nathan tells the agent)

**Meeting Transcripts (from Plaud.ai)**
- Nathan copy/pastes transcript into the Ask Agent: "Here's the transcript from the Oakes client meeting on Tuesday"
- Agent identifies the project (by name or asks Nathan to confirm)
- Agent processes the transcript with Claude to extract:
  - `summary`: 2-3 sentence meeting summary
  - `key_decisions`: extracted as separate `decision_made` events
  - `action_items`: offered as JT task creation (with confirmation flow)
  - `commitments`: things promised to the client or by the client ÃÂ¢ÃÂÃÂ logged as open items if follow-up is needed
- Creates a `project_events` entry with `channel: 'meeting'`, full transcript in `detail`
- Decision and commitment sub-events link back via `related_event_id`

**Phone Calls & In-Person Conversations**
- Nathan tells the agent: "I spoke with the tile supplier about Oakes, they said closet pricing is $4,200 and lead time is 6 weeks"
- Agent logs as `project_events` with `channel: 'phone'` or `channel: 'in_person'`
- If there's an existing open item about that topic, the agent marks it `resolved: true` with the resolution note
- This is the key mechanism for the "I got the answer on the phone" scenario

**Manual Notes**
- Nathan tells the agent anything to remember: "The Oakes client mentioned they might want a wet bar in the basement"
- Logged as `channel: 'manual_note'`, `event_type: 'note'`

### 15.4 Agent Integration ÃÂ¢ÃÂÃÂ Know-it-All Tools

Two new tools added to Know-it-All (in addition to existing 39 tools):

**`get_project_memory`**
- Input: `jobId` (required), `channel` (optional filter), `event_type` (optional filter), `include_resolved` (boolean, default false), `days_back` (number, default 30)
- Returns: chronological list of `project_events` for that job
- Use case: "What's happening with Oakes?" ÃÂ¢ÃÂÃÂ agent pulls full communication timeline

**`log_project_event`**
- Input: `jobId`, `channel`, `event_type`, `summary`, `detail` (optional), `participants` (optional), `open_item` (boolean), `open_item_description` (optional), `resolves_event_id` (optional ÃÂ¢ÃÂÃÂ marks an existing open item as resolved)
- Use case: Nathan says "I talked to Dave, the permit is approved" ÃÂ¢ÃÂÃÂ agent logs the event and resolves any open item about the permit

**`get_open_items`**
- Input: `jobId` (optional ÃÂ¢ÃÂÃÂ if omitted, returns all open items across all projects)
- Returns: all unresolved open items, sorted by age (oldest first)
- Use case: dashboard briefing pulls all open items to show "Pending Follow-Ups" section

**`resolve_open_item`**
- Input: `eventId`, `resolved_note`
- Use case: Nathan says "The supplier got back to me on that" ÃÂ¢ÃÂÃÂ agent resolves the specific open item

### 15.5 Dashboard Integration

**Dashboard Briefing (`dashboard-analysis.ts`)**
New sections added to the AI analysis prompt:

- **PENDING FOLLOW-UPS**: All open items across projects from `get_open_items()`, with age in days. AI incorporates these into the briefing: "You're still waiting on closet pricing from [supplier] for Oakes ÃÂ¢ÃÂÃÂ sent 4 days ago, no reply yet."
- **RECENT PROJECT ACTIVITY**: Significant events from the last 24h across all active projects (new emails, meeting decisions, manual notes). Replaces/augments the current JT comments section with richer multi-channel context.

**Do Now Actions (`dashboard-analysis.ts`)**
- Suggested follow-up actions for overdue open items: "Follow up on Oakes closet pricing? (5 days, no reply)" ÃÂ¢ÃÂÃÂ action creates a Gmail draft for review, NEVER auto-sends
- Resolution actions: "Mark as resolved" button on open items in the dashboard (for when Nathan resolved something outside the agent)

**Project Status Intelligence**
The Design Manager agent and overview analysis can now answer:
- "Which projects have gone quiet?" ÃÂ¢ÃÂÃÂ no events in 7+ days
- "What's stalled?" ÃÂ¢ÃÂÃÂ open items unresolved for 5+ business days
- "What happened this week on Oakes?" ÃÂ¢ÃÂÃÂ full event timeline
- "What did we decide about the kitchen layout?" ÃÂ¢ÃÂÃÂ searches meeting transcripts and decision events
- "Give me a project summary for Oakes" ÃÂ¢ÃÂÃÂ combines JT budget/schedule data with PML communication timeline

### 15.6 Open Item Lifecycle

```
Email sent / Question asked / Commitment made
  ÃÂ¢ÃÂÃÂ
open_item: true, resolved: false
  ÃÂ¢ÃÂÃÂ
Surfaces in dashboard briefing + agent context
  ÃÂ¢ÃÂÃÂ
Resolution happens via ONE of:
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Gmail reply detected ÃÂ¢ÃÂÃÂ auto_resolved: true (automatic)
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Nathan tells agent "they called me back" ÃÂ¢ÃÂÃÂ resolved: true (conversational)
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Nathan clicks "Resolve" in dashboard ÃÂ¢ÃÂÃÂ resolved: true (manual)
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Nathan tells agent to dismiss ÃÂ¢ÃÂÃÂ resolved: true, resolved_note: "dismissed"
  ÃÂ¢ÃÂÃÂ
Item no longer appears in active open items
(Still queryable in project history with include_resolved: true)
```

**Critical rule:** Follow-up draft emails are SUGGESTED, never auto-sent. Nathan may have received the answer via phone, text, or in-person ÃÂ¢ÃÂÃÂ channels the system cannot automatically verify. All follow-up actions require Nathan's approval.

### 15.7 Cron Jobs

| Cron | Schedule | Purpose |
|------|----------|---------|
| `gmail-to-pml` | Hourly during work hours (7am-9pm ET) | Sync inbox + sent mail ÃÂ¢ÃÂÃÂ `project_events`, check for replies on open threads |
| `pml-open-items-digest` | Daily 6 AM ET | Generate open items summary for dashboard briefing context |

These piggyback on existing Vercel cron infrastructure. The Gmail sync can be combined with the existing `inbox-cleanup` cron to avoid redundant Gmail API calls.

### 15.8 Email-to-Project Matching

AI-based matching using this priority order:

1. **Exact email match**: Sender/recipient email address matches a contact on a JT job account
2. **Name match**: Sender/recipient name fuzzy-matches a JT job account contact name (reuse existing `contact-mapper.ts` logic)
3. **Subject line match**: Subject contains a job name, job number, or project address
4. **Thread continuity**: If a previous message in the same Gmail thread was already matched to a project, inherit that match
5. **Unmatched**: If no match found, store with `job_id: null` ÃÂ¢ÃÂÃÂ still visible in the agent's global context, and Nathan can manually link it later via conversation ("that email about the tile was for Oakes")

### 15.9 Meeting Transcript Processing Pipeline

```
Nathan pastes transcript into Ask Agent
  ÃÂ¢ÃÂÃÂ
Agent confirms project: "This looks like the Oakes meeting. Correct?"
  ÃÂ¢ÃÂÃÂ
Claude processes transcript ÃÂ¢ÃÂÃÂ extracts:
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ summary (2-3 sentences)
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ key_decisions[] ÃÂ¢ÃÂÃÂ each becomes a 'decision_made' event
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ action_items[] ÃÂ¢ÃÂÃÂ offered as JT task creation (standard confirmation flow)
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ commitments[] ÃÂ¢ÃÂÃÂ logged as open items if follow-up needed
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ participants[] (extracted from transcript context)
  ÃÂ¢ÃÂÃÂ
Creates project_events:
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ 1 primary event (channel: 'meeting', event_type: 'meeting_held', detail: full transcript)
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ N decision events (related_event_id ÃÂ¢ÃÂÃÂ primary)
  ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ M commitment events (open_item: true, related_event_id ÃÂ¢ÃÂÃÂ primary)
```

### 15.10 Build Plan (Priority Order)

| Phase | What | Why First | Depends On |
|-------|------|-----------|------------|
| 1 | Supabase `project_events` table + `log_project_event` API endpoint | Foundation ÃÂ¢ÃÂÃÂ enables manual event logging immediately via Ask Agent | Nothing |
| 2 | Know-it-All tools: `log_project_event`, `get_project_memory`, `get_open_items`, `resolve_open_item` | Nathan can start logging phone calls, notes, and querying project context | Phase 1 |
| 3 | Meeting transcript processing in Know-it-All | Nathan is ready to paste from Plaud now ÃÂ¢ÃÂÃÂ immediate value | Phase 1, 2 |
| 4 | Gmail sent mail sync ÃÂ¢ÃÂÃÂ `project_events` + reply detection | Auto-captures outbound email context, biggest gap in current system | Phase 1 |
| 5 | Open items in dashboard briefing + Do Now follow-up actions | Proactive reminders surface in daily workflow | Phase 1, 4 |
| 6 | Backfill existing sources (JT comments, daily logs, iMessages) into `project_events` | Unified timeline includes all channels | Phase 1 |
| 7 | Project intelligence: stalled detection, weekly summaries, "what's the status" answers | Full value of the unified memory layer | Phase 1-6 |

### 15.11 What Doesn't Change

- Existing JT comment and daily log sync continues (cache tables remain for backward compatibility)
- iMessage Mac sync script continues (also writes to PML)
- Gmail inbox read + cleanup continues (extended to also track sent mail)
- Know-it-All's existing 39 tools stay ÃÂ¢ÃÂÃÂ PML adds 4 new tools
- Dashboard briefing structure stays ÃÂ¢ÃÂÃÂ gains richer context from PML
- All existing cron jobs continue on current schedules

### 15.12 New Files (Planned)

```
app/
ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ api/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ pml/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ route.ts                    # CRUD for project_events (GET list, POST create)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ [eventId]/route.ts          # GET/PATCH single event (resolve, update)
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ open-items/route.ts         # GET all unresolved open items
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ cron/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ gmail-to-pml/route.ts       # Hourly Gmail ÃÂ¢ÃÂÃÂ project_events sync
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ sync/
ÃÂ¢ÃÂÃÂ       ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ pml-backfill/route.ts       # One-time backfill of JT/text data into PML
ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ lib/
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ project-memory.ts               # PML service: queries, event creation, resolution, project matching
ÃÂ¢ÃÂÃÂ   ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ gmail-sync.ts                   # Gmail sent+inbox sync, thread tracking, reply detection
```

---

## 16. Field Staff Dashboard

The Field Hub is a mobile-optimized dashboard for field crew members (e.g., Evan) designed for quick-glance reference during morning/evening admin time. Informed by Evan's workflow questionnaire — he rarely uses a laptop mid-day and tracks day-to-day items in handwritten notebooks, so the dashboard focuses on schedule visibility and lightweight task management.

### Route
- **Page**: `/dashboard/field` (`app/dashboard/field/page.tsx`)
- **Auth**: Token-based via localStorage, bypasses Supabase (field staff don't have Supabase accounts)
- **Test auth**: `btoa('test:evan:' + Date.now())` stored in localStorage key `bkb_field_token`

### Features

#### Inline Ask Agent (Top of Dashboard)
- Collapsible chat widget embedded directly at the top of the dashboard (replaces the old pop-out link to `/dashboard/ask`)
- Uses the `field-staff` agent backend (forced via role-based auth) — restricted to specs + task CRUD only
- **Capabilities**: Create tasks, edit tasks, update task progress, query approved document specs, view schedules
- **Job selector dropdown**: Pre-populated with all PM jobs; scopes queries to a specific project
- **Confirmation workflow**: Task creation shows an Approve/Cancel prompt before executing
- **Suggested queries**: Quick-tap buttons for common questions (specs, overdue tasks, task creation, schedule)
- **RenderContent component**: Inline markdown-lite renderer (bold, headers, bullets, code blocks, links)
- Imports `formatContent`, `ChatMessage`, and `TaskConfirmData` types from `useAskAgent.ts`
- Auth token generated via `getAuthToken()` using `NEXT_PUBLIC_APP_PIN`

#### Three Task Cards
- **Job Overdue** (orange): Overdue tasks on PM jobs NOT assigned to the user
- **My Overdue** (red): Overdue tasks assigned to the user (including from non-PM jobs)
- **My Upcoming** (gold): Upcoming tasks assigned to the user that are not overdue
- Task categories are mutually exclusive (no overlap between categories)
- Each card is expandable to show the task list with completion toggles and JT links

#### Your Tasks This Week
- Blue-themed highlight section showing tasks assigned to the user in the next 7 days
- Only appears when such tasks exist
- Links directly to JT schedule for each task

#### 2-Week Calendar View
- Forward-looking from upcoming Monday: shows "Upcoming Week" and "Following Week" in 7-column grid
- Each day cell shows scheduled tasks as colored pills with left-border accent
- Tasks are **color-coded by job** using a 12-color hash-based palette (deterministic from job number)
- Today's cell is highlighted with a golden background
- Assigned tasks get a highlighted box-shadow in Week 1
- Clicking a task opens a detail popup with date editing and completion toggle
- Completed tasks shown with green "done" count

#### MY JOBS Section
- Condensed clickable chip list of all PM jobs (currently 21 for Evan)
- Each chip links directly to the JT schedule for that job
- Color dots match the calendar color palette

#### Task Detail Popup
- Modal overlay when clicking a calendar task
- Shows task name, job info with color dot, and assignment status
- Inline date picker with Save button for rescheduling
- Mark Complete / Reopen toggle button
- Direct "View in JobTread" link

### API Endpoints
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/field-dashboard` | GET | Briefing, 2-week calendar tasks, three-category overdue/upcoming tasks, PM jobs list, recent comments |
| `/api/field-dashboard` | PATCH | Mark task complete/incomplete (`{ taskId, complete }`) or update due date (`{ taskId, endDate }`) |
| `/api/chat` | POST | Inline Ask Agent chat — auto-routes to `field-staff` agent for field staff users |
| `/api/field-job-schedule` | GET | Schedule phases/tasks for a specific job (legacy, still available) |
| `/api/field-schedule-task-update` | POST | Update schedule task completion or due date (legacy, still available) |

### API Response Shape
```typescript
{
  userName: string;
  briefing: string;
  week1Start: string;      // YYYY-MM-DD, upcoming Monday
  todayDate: string;        // YYYY-MM-DD
  jobOverdueTasks: OdTask[];   // PM job overdue, NOT assigned to user
  myOverdueTasks: OdTask[];    // Overdue, assigned to user (all jobs)
  myUpcomingTasks: UpcomingTask[]; // Upcoming, assigned to user
  calendarTasks: CalTask[];    // 2-week window tasks
  recentComments: Comment[];   // Last 30 days
  activeJobCount: number;
  pmJobs: PmJob[];            // All PM jobs for job navigation
}
```

### Key Implementation Details
- **PM filtering**: `getActiveJobs` extracts `projectManager` from JobTread custom field values; API route filters jobs where `projectManager === user.name`
- **Calendar data**: API fetches all tasks per PM job via `getTasksForJob()`, filters to 2-week forward window, groups by date
- **Task categorization**: Cross-references `getOpenTasksForMember()` with PM job tasks to split into three non-overlapping categories. Non-PM job overdue tasks (e.g., Hurley Phase 2) are caught in a second pass.
- **Job color mapping**: Hash-based 12-color PALETTE, deterministic from job number (`jobColor(number)`)
- **Inline Ask Agent**: Uses `/api/chat` which forces `field-staff` agent for users with `field_sup` or `field` role. The `InlineAskAgent` component manages its own state (messages, loading, job selection) independently from the main dashboard state.
- **Comment window**: 30 days (widened from 7 due to sparse activity)
- **PAVE limitation**: `user` relation does NOT work on comment queries — removed from `commentFields` in `jobtread.ts`
- JT membership IDs: nathan=`22P5SRwhLaYf`, evan=`22P5nJ7ncFj4`, terri=`22P5SpJkype2`
---

## 17. Changelog

### 2026-03-30 — Inline Ask Agent on Field Dashboard
- **Incorporated Ask Agent directly into the field dashboard** as a collapsible inline chat widget at the top
  - Removed the old "Ask Agent" pop-out link from the header
  - New `InlineAskAgent` component with job selector dropdown, message thread, confirmation workflow
  - Imports `formatContent`, `ChatMessage`, `TaskConfirmData` from `useAskAgent.ts`
  - Uses `/api/chat` endpoint which auto-routes to `field-staff` agent for field staff users
  - Supports: task creation/editing, approved spec queries, schedule lookups
  - Suggested query buttons for quick access
  - `RenderContent` component for markdown-lite rendering in compact chat bubbles
- **Files changed**: `app/dashboard/field/page.tsx`
- **Tested**: Dashboard API (all data categories validated, no overlaps), chat API (field-staff agent responds correctly), task creation with confirmation, PATCH endpoint for task completion

### 2026-03-30 — Field Dashboard Iterative Improvements (earlier session)
- Removed AI briefing section from dashboard (not working well)
- Split task cards into three mutually exclusive categories: Job Overdue, My Overdue, My Upcoming
- Added "Your Tasks This Week" blue highlight section (conditional, next 7 days)
- Added PM Jobs clickable chip list with JT schedule links
- Moved calendar views above MY JOBS section
- Widened comment window from 7 to 30 days
- Fixed PAVE `user` relation breaking all comment queries (removed from `commentFields`)
- Fixed overdue tasks from non-PM jobs falling into "My Upcoming" instead of "My Overdue"

### 2026-03-29
- Added Project Manager custom field extraction to `getActiveJobs` in `jobtread.ts`
- Field dashboard API now filters active jobs by PM assignment (only shows jobs where user is Project Manager)
- **Redesigned field dashboard** based on Evan's workflow questionnaire:
  - Removed all task list sections (overdue/today/upcoming/other task cards with Start/Done buttons)
  - Removed stats cards (total/overdue/today/this week counters)
  - Added briefing summary text at top
  - Added 2-week calendar view (this week + next week) with day-by-day task layout
  - Tasks color-coded by job using 8-color palette with job legend
  - Overdue items shown in dedicated red alert section
  - Active jobs section with upcoming task counts and direct JT links
  - Ask Agent quick-access button in header
- API rewritten: now returns `{ briefing, weekStartDate, todayDate, overdueTasks, calendarTasks, activeJobs }`
  - Fetches tasks per job via `getTasksForJob()` and filters to 2-week window
  - Groups tasks by date for calendar rendering


All modifications to the codebase should be logged here with date, files changed, and what was done.


### 2026-03-28 â Field Staff Dashboard (Schedule Task Management)
- Added task completion checkboxes to schedule tasks in Field Hub
- Added inline due date editing with pencil icon and date picker
- New API endpoint: `/api/field-schedule-task-update` for updating task completion and due dates
- Fixed phase collapse bug: lifted open state from PhaseRow to parent component
- Schedule tasks now show due dates and completion status with visual indicators
- Previous session: Added My Jobs section with expandable schedules, search, and on-demand schedule loading

### 2026-03-28 - Feature: Agent Mode Toggle on Slide-Out Panel

**Problem:** The Ask Agent slide-out panel only used Know-it-All agent. The Approved Specs (project-details) agent was only accessible from the full-screen /dashboard/ask page, creating inconsistency.

**Solution:** Added a Know-it-All / Approved Specs toggle to AskAgentPanel.tsx. Sends `forcedAgent` parameter to /api/chat which the router already supports. Switching modes clears chat, updates suggestions, placeholder text, and empty state messaging.

**Files changed:**
- `app/dashboard/components/AskAgentPanel.tsx` - Added agentMode state, toggle buttons (Brain/FileSearch icons), mode-dependent suggestions & placeholder, forcedAgent in API call

---

### 2026-03-28 - UI Unification: Dashboard-First Layout

**Problem:** Multiple entry points for asking agents (root page chat UI + dashboard pages) caused confusion about where to go for what.

**Solution:** Made dashboard the home page. Root URL (/) redirects to /dashboard. Sidebar trimmed to 4 modules: Overview, Pre-Construction, Estimating, Invoicing. Spec Writer and Documents hidden. Added Ask Agent slide-out panel accessible from header button and sidebar shortcut on every page. Old root page chat UI preserved as page-legacy.tsx.

**Files changed:**
- `app/page.tsx` - **REPLACED** with redirect to /dashboard
- `app/page-legacy.tsx` - **NEW** backup of original root page
- `app/dashboard/layout.tsx` - Reduced NAV_ITEMS from 7 to 4, added chatOpen state, Ask Agent button in header + sidebar, AskAgentPanel import
- `app/dashboard/components/AskAgentPanel.tsx` - **NEW** Slide-out chat panel (420px desktop, full-width mobile), job selector, suggestion chips, markdown rendering
- `app/dashboard/page.tsx` - Removed DashboardChat component import

---

### 2026-03-28 - Fix: Know-it-All Agent Routing for PML Logging

**Problem:** Two routing bugs prevented conversational event logging from working:
1. Regex `i spoke` didn't match "i just spoke" (word "just" in between)
2. canHandle returned first match not highest - fixture pattern (0.9) fired before PML pattern (0.95) because it appeared earlier in the code

**Solution:**
1. Updated PML regex to allow optional "just": `i\s+(?:just\s+)?spoke`
2. Moved entire PML canHandle block ABOVE the selections/fixture pattern block with comment explaining ordering dependency

**Files changed:**
- `app/api/lib/agents/know-it-all.ts` - PML regex fix + pattern ordering fix (PML patterns now before fixture/selection patterns)

---

### 2026-03-27 - Feature: Project Memory Layer (PML) Implementation

**Problem:** Project communications were scattered across emails, phone calls, texts, meetings, and daily logs with no unified timeline or follow-up tracking.

**Solution:** Implemented PML (Section 15 of this doc) with project_events table in Supabase, auto-sync from emails/daily logs via cron, manual logging via Ask Agent ("I just spoke with..."), and dashboard briefing integration. Know-it-All agent gained PML tools: log_project_event, get_project_timeline, get_open_items, resolve_open_item.

**Files changed:**
- `app/lib/project-memory.ts` - **NEW** PML core functions (logEvent, getTimeline, getOpenItems, resolveItem, getProjectIntelligence)
- `app/lib/project-intelligence.ts` - **NEW** Dashboard briefing PML integration
- `app/api/lib/agents/know-it-all.ts` - Added PML tools and canHandle patterns
- `app/api/cron/sync-events/route.ts` - **NEW** Cron endpoint for email/daily-log sync
- Supabase migration: `project_events` table with indexes

---


### 2026-03-21 ÃÂ¢ÃÂÃÂ Feature: Nathan's Brand Voice for AI Writing

**Problem:** The chat assistant and email drafts didn't sound like Nathan. AI-generated content was generic instead of matching Nathan's actual writing style.

**Solution:** Created `nathan-voice.ts` with condensed brand voice rules derived from Nathan's comprehensive Brand Voice & Correspondence Guide (v5). Full document stored at `nathan-brand-voice.md`. The voice rules cover: writing characteristics, always/never use rules, email patterns by situation, key relationships, and content philosophy. Key rule: NEVER use em dashes - always use regular dashes.

**Files changed:**
- `app/lib/nathan-voice.ts` ÃÂ¢ÃÂÃÂ **NEW** Condensed NATHAN_BRAND_VOICE constant for system prompts
- `app/lib/nathan-brand-voice.md` ÃÂ¢ÃÂÃÂ **NEW** Full brand voice document (1375 lines)
- `app/api/dashboard/chat/route.ts` ÃÂ¢ÃÂÃÂ Imports and injects NATHAN_BRAND_VOICE into chat system prompt
- `app/lib/dashboard-analysis.ts` ÃÂ¢ÃÂÃÂ Email draft voice rules added to suggestedActions prompt

### 2026-03-21 ÃÂ¢ÃÂÃÂ Feature: Dashboard Chat Widget

**Problem:** Nathan had to leave the Overview dashboard to ask questions or get help. The existing Ask Agent at `/dashboard/ask` works well but requires navigating away.

**Solution:** Built a self-contained floating chat widget on the Overview page. Completely separate from the existing Ask Agent - does not touch `/api/chat`, `useAskAgent.ts`, or any Ask Agent files.

- Floating gold "Ask Assistant" button in bottom-right corner
- Opens to a chat panel (full-screen mobile, 520px on desktop)
- Suggestion chips for common questions (project status, email drafts, schedule, tasks)
- Full context of dashboard data: JT tasks, Gmail, Calendar, active jobs, JT comments
- Maintains conversation history (last 10 messages)
- Eastern timezone aware
- Dark theme matching dashboard
- Uses Claude Sonnet for responses

**Files changed:**
- `app/api/dashboard/chat/route.ts` ÃÂ¢ÃÂÃÂ **NEW** Chat endpoint with dashboard context + brand voice
- `app/dashboard/components/DashboardChat.tsx` ÃÂ¢ÃÂÃÂ **NEW** Floating chat widget component
- `app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ Added DashboardChat import and render

### 2026-03-21 ÃÂ¢ÃÂÃÂ Feature: AI-Powered Inbox Cleanup + Auto-Archive

**Problem:** Nathan spends significant time deleting junk emails. Marketing, automated notifications, social media alerts, and cold outreach clutter the inbox.

**Solution ÃÂ¢ÃÂÃÂ Manual Cleanup:**
- "Clean Inbox" button on the dashboard Inbox section
- Click to scan ÃÂ¢ÃÂÃÂ AI classifies each email as keep/archive ÃÂ¢ÃÂÃÂ preview list ÃÂ¢ÃÂÃÂ confirm to archive
- Uses Claude to classify based on BKB-specific rules (keep client/vendor/team emails, archive newsletters/promos/notifications)
- `archiveEmails()` batch-removes INBOX label (emails move to All Mail, not deleted)
- `fetchFullInbox()` fetches all categories (not just primary) for thorough cleanup

**Solution ÃÂ¢ÃÂÃÂ Automated Cleanup:**
- Vercel cron job runs hourly (`/api/cron/inbox-cleanup`)
- Dashboard auto-refresh (every 15 min when open) also triggers cleanup silently
- Only processes during work hours (7am-9pm ET)
- Combined: hourly background + 15-min when dashboard is open

**OAuth Scope Upgrade:** Gmail scope upgraded from `gmail.readonly` to `gmail.modify` to enable archiving. Required re-authorization via `/api/auth/google-callback`.

**Files changed:**
- `app/lib/google-api.ts` ÃÂ¢ÃÂÃÂ Added `archiveEmails()`, `fetchFullInbox()`, `createGmailDraft()`
- `app/api/dashboard/inbox-cleanup/route.ts` ÃÂ¢ÃÂÃÂ **NEW** POST endpoint (preview + execute modes)
- `app/api/cron/inbox-cleanup/route.ts` ÃÂ¢ÃÂÃÂ **NEW** Hourly cron for automated cleanup
- `app/api/dashboard/quick-action/route.ts` ÃÂ¢ÃÂÃÂ **NEW** POST endpoint for Do Now actions (draft-email)
- `app/api/auth/google-callback/route.ts` ÃÂ¢ÃÂÃÂ Upgraded scope to gmail.modify
- `app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ Clean Inbox button, scanning/preview/cleaning states
- `vercel.json` ÃÂ¢ÃÂÃÂ Added hourly inbox-cleanup cron

### 2026-03-21 ÃÂ¢ÃÂÃÂ Feature: Do Now Email Drafts via Gmail API

**Problem:** The "Do Now" email action buttons opened Gmail compose URLs which didn't reliably carry pre-filled text, especially on mobile.

**Solution:** Email actions now create real Gmail drafts via the API. Click a "Reply to..." button ÃÂ¢ÃÂÃÂ API creates a draft with AI-written text ÃÂ¢ÃÂÃÂ Gmail opens directly to that draft ÃÂ¢ÃÂÃÂ review and send. Falls back to compose URL if draft creation fails.

**Files changed:**
- `app/lib/google-api.ts` ÃÂ¢ÃÂÃÂ Added `createGmailDraft()` (RFC 2822 format, base64url encode)
- `app/api/dashboard/quick-action/route.ts` ÃÂ¢ÃÂÃÂ **NEW** Handles draft-email action type
- `app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ Updated action handler to call quick-action API for email drafts

### 2026-03-21 ÃÂ¢ÃÂÃÂ Enhancement: Mobile Optimization

**Problem:** Dashboard was functional on mobile but touch targets were too small and some elements lacked tap feedback.

**Solution:** Responsive improvements using Tailwind `md:` prefixes so all changes apply to both desktop and mobile from the same component:
- Task complete button: 28px on mobile (was 20px), checkmark always visible (was hover-only)
- Task rows: increased vertical padding on mobile
- Due date button: added padding for easier tapping
- +1d reschedule button: larger touch target
- Do Now actions: full-width on mobile, increased padding, active states for tap feedback
- Email rows: increased vertical padding

**Files changed:**
- `app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ Responsive class updates throughout

### 2026-03-21 ÃÂ¢ÃÂÃÂ Fix: Timezone Bug (Server UTC vs Eastern Time)

**Problem:** Vercel servers run in UTC. When Nathan checked the dashboard at 8pm ET Saturday, the server thought it was 1am Sunday (UTC). This caused wrong day-of-week, wrong time period, wrong "tomorrow" calculation, and calendar times displayed 4-5 hours off.

**Solution:** All time context logic now uses `Intl.DateTimeFormat` with `timeZone: 'America/New_York'`. Calendar time formatting in AI prompt also forces Eastern timezone. Weekend handling fixed: Saturday and Sunday both show "Monday" as tomorrowLabel.

**Files changed:**
- `app/lib/dashboard-data.ts` ÃÂ¢ÃÂÃÂ `getTimeContext()` rewritten with Eastern timezone
- `app/lib/dashboard-analysis.ts` ÃÂ¢ÃÂÃÂ All date/time formatting uses `timeZone: 'America/New_York'`

### 2026-03-19 ÃÂ¢ÃÂÃÂ Feature: Time-Aware Daily Operations Assistant + Tomorrow Preview

**Problem:** The dashboard showed the same data regardless of when Nathan looked at it. He uses it at three times: morning (what's ahead), during the day (updates), and evening (tomorrow prep). The AI briefing and UI needed to adapt to these usage patterns.

**Solution ÃÂ¢ÃÂÃÂ Time-Aware Briefings:**
- Added `TimeContext` to dashboard data: `period` (morning/midday/evening), `tomorrowLabel` ("tomorrow" or "Monday" on Fridays), `tomorrowDate`
- AI prompt now includes time-period-specific instructions:
  - **Morning**: "First look at the day" ÃÂ¢ÃÂÃÂ prioritizes today's calendar, urgent tasks, same-day email replies
  - **Midday**: "Quick status check" ÃÂ¢ÃÂÃÂ focuses on what needs attention right now, new messages
  - **Evening**: "Tomorrow prep" ÃÂ¢ÃÂÃÂ emphasizes tomorrow's schedule and what to prepare tonight
- Summary and action items adapt to the time period (evening actions say "prepare for tomorrow")

**Solution ÃÂ¢ÃÂÃÂ Tomorrow Preview:**
- Dashboard data layer fetches tomorrow's calendar events specifically (`fetchCalendarEvents` with custom date range)
- Filters tasks due tomorrow from the existing task list
- AI generates `tomorrowBriefing` object with:
  - `headline`: "What tomorrow looks like overall"
  - `calendarWalkthrough`: Chronological events with AI-generated prep notes ("Review plans, bring budget spreadsheet")
  - `tasksDue`: Tasks due tomorrow with job names
  - `prepTonightOrAM`: Specific prep actions for tonight or first thing tomorrow
- Friday evening automatically shows Monday's preview (not Saturday)

**Solution ÃÂ¢ÃÂÃÂ Time-Aware UI:**
- Header changes by time: "Good morning ÃÂ¢ÃÂÃÂ Your day ahead" / "Afternoon check-in" / "Evening prep ÃÂ¢ÃÂÃÂ Preparing for tomorrow"
- Tomorrow Preview section with two-column layout: SCHEDULE (chronological walkthrough) + PREP (tonight's checklist + tasks due)
- Evening mode highlights tomorrow preview with purple accent border
- Calendar events include AI-generated prep notes per event

**Files changed:**
- `app/lib/google-api.ts` ÃÂ¢ÃÂÃÂ `fetchCalendarEvents()` now accepts custom start/end Date params for tomorrow-specific queries
- `app/lib/dashboard-data.ts` ÃÂ¢ÃÂÃÂ Added `TimeContext` type, `getTimeContext()` function, `tomorrowTasks`, `tomorrowCalendarEvents`, `tasksTomorrow` and `tomorrowEventsCount` stats
- `app/lib/dashboard-analysis.ts` ÃÂ¢ÃÂÃÂ Added `TomorrowBriefing` interface, time-period-specific prompt instructions (morning/midday/evening), `tomorrowBriefing` in AI output with calendar walkthrough and prep actions, increased max_tokens to 3000
- `app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ Time-aware header with `getSubGreeting()`, `TomorrowBriefing` interface, Tomorrow Preview section with schedule walkthrough and prep checklist, time context variables

### 2026-03-19 ÃÂ¢ÃÂÃÂ Feature: Smart Quick Actions ("Do Now" Section)

**Problem:** The dashboard showed what needs attention but didn't help Nathan take action quickly. He had to mentally parse the briefing, then navigate to Gmail/JT/Calendar separately to act on each item.

**Solution ÃÂ¢ÃÂÃÂ AI-Suggested Quick Actions:**
- AI now generates 3-5 `suggestedActions` based on analysis of tasks, emails, calendar, and messages
- Each action has a type that determines one-click behavior:
  - `reply-email`: Opens Gmail compose (`mail.google.com/?view=cm`) with pre-drafted reply text, recipient, and subject pre-filled
  - `complete-task`: Marks JT task as done (finds matching task by name, calls existing PATCH endpoint)
  - `follow-up`: Opens Gmail compose for follow-up email with AI-drafted body
  - `prep-meeting`: Opens JT job page for the relevant project
  - `review-document`: Opens JT job page for document review
  - `reschedule-task`: (future) inline date picker for overdue tasks
- AI generates `suggestedText` for email actions ÃÂ¢ÃÂÃÂ 2-3 sentence professional drafts in BKB voice

**Solution ÃÂ¢ÃÂÃÂ "Do Now" UI Section:**
- Green-themed section right after AI Briefing, before insights grid
- 2-3 column responsive grid of clickable action cards
- Each card shows: action type emoji, title, job name, priority dot (red/yellow/green)
- Clicking performs the action immediately ÃÂ¢ÃÂÃÂ no confirmation for non-destructive actions

**Files changed:**
- `app/lib/dashboard-analysis.ts` ÃÂ¢ÃÂÃÂ Added `SuggestedAction` interface with actionType/context/priority, added to AI prompt with detailed instructions per action type, added to response parser and fallback
- `app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ Added `SuggestedAction` interface, "Do Now" section with action handler logic (Gmail compose URLs, task completion, JT job navigation), priority indicators

### 2026-03-19 ÃÂ¢ÃÂÃÂ Feature: Meeting Prep Notes, Deadline Alerts, Auto-Refresh

**Problem:** Calendar events showed times and locations but no context about what Nathan should prepare. Overdue tasks required multiple clicks to reschedule. Dashboard data went stale unless manually refreshed.

**Solution ÃÂ¢ÃÂÃÂ Meeting Prep Notes:**
- AI generates `meetingPrepNotes` for each upcoming meeting/consultation in today's calendar
- Each note includes: event name, time, 1-2 sentence prep tip (what to review, bring, or discuss), related BKB job name
- Shown as purple badges directly under calendar events in the Upcoming Schedule section
- Matches events by name to find the corresponding prep note from AI
- Skips generic events like "Out of Office"

**Solution ÃÂ¢ÃÂÃÂ Deadline Quick-Reschedule:**
- Overdue tasks now show a "+1d" button that pushes the task to tomorrow with one click
- Updates both startDate and endDate in JT via existing PATCH endpoint
- Combines with the existing inline date picker for custom date selection

**Solution ÃÂ¢ÃÂÃÂ Auto-Refresh:**
- Dashboard auto-refreshes every 15 minutes during work hours (8am-6pm EST)
- Uses `setInterval` with hour check ÃÂ¢ÃÂÃÂ no unnecessary API calls outside work hours
- Refresh runs silently in background without spinner (uses `fetchOverview(true)`)

**Files changed:**
- `app/lib/dashboard-analysis.ts` ÃÂ¢ÃÂÃÂ Added `MeetingPrepNote` interface, `meetingPrepNotes` to AI output and prompt rules, added to response parser and fallback
- `app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ Calendar events now show AI prep notes as purple badges, overdue tasks show "+1d" quick-reschedule button, added 15-minute auto-refresh interval during work hours, added `MeetingPrepNote` and `activeJobs` to client-side types

### 2026-03-19 ÃÂ¢ÃÂÃÂ Feature: Gmail Inbox + Google Calendar Integration for Dashboard

**Problem:** The dashboard AI briefing only had JT data (tasks, comments, daily logs). Nathan wanted Gmail and Calendar context so the AI knows what emails need replies and what meetings are coming up.

**Solution ÃÂ¢ÃÂÃÂ Google Cloud OAuth Setup:**
- Created Google Cloud project "My Project 54683" (project ID: `bold-tooling-490717-n5`) under brettkingbuilder.com organization
- Enabled Gmail API and Google Calendar API
- Configured OAuth consent screen (Internal audience, app name "BKB Client Hub")
- Created OAuth2 web application credentials with redirect URIs for both OAuth Playground and BKB callback
- Built `/api/auth/google-callback` endpoint that handles the full OAuth flow: redirects to Google consent, exchanges code for tokens, displays refresh token for admin setup
- Obtained refresh token with scopes: `gmail.readonly` + `calendar.readonly`
- Stored credentials as Vercel env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

**Solution ÃÂ¢ÃÂÃÂ Google API Helper (`app/lib/google-api.ts`):**
- OAuth2 token refresh using stored refresh token (auto-caches access token until expiry)
- `fetchGmailInbox(maxResults)`: Fetches recent primary inbox emails (last 3 days), skips promotions/social/updates. Returns from, subject, snippet, date, unread status.
- `fetchCalendarEvents(daysAhead)`: Fetches upcoming calendar events for next N days. Returns summary, start/end times, location, attendee count.

**Solution ÃÂ¢ÃÂÃÂ Dashboard Data Layer Updates:**
- `buildUserDashboardData()` now fetches Gmail + Calendar in addition to JT data
- Added `calendarEvents` array and `upcomingEventsCount` stat to `UserDashboardData`
- `recentEmails` now populated from live Gmail API (was empty placeholder)
- `unreadEmailCount` stat now computed from actual Gmail data

**Solution ÃÂ¢ÃÂÃÂ AI Analysis Prompt Updates:**
- Added CALENDAR section with event details (day, time, location, attendee count)
- Prompt instructs AI to mention prep needed, conflicts, and follow-ups for calendar events
- Improved GMAIL section prompt to "identify which ones need a reply or action"
- Added `upcomingEventsCount` to stats summary

**Environment Variables Added:**
| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth2 client ID for Google APIs |
| `GOOGLE_CLIENT_SECRET` | OAuth2 client secret |
| `GOOGLE_REFRESH_TOKEN` | Long-lived token for server-side API access |

**Files changed:**
- `app/lib/google-api.ts` ÃÂ¢ÃÂÃÂ **NEW** Google OAuth2 helper with Gmail inbox and Calendar events fetchers
- `app/api/auth/google-callback/route.ts` ÃÂ¢ÃÂÃÂ **NEW** OAuth callback endpoint for one-time token setup
- `app/lib/dashboard-data.ts` ÃÂ¢ÃÂÃÂ Added Gmail + Calendar fetching, new calendarEvents field, updated stats
- `app/lib/dashboard-analysis.ts` ÃÂ¢ÃÂÃÂ Added CALENDAR section to AI prompt, improved email prompt

### 2026-03-19 ÃÂ¢ÃÂÃÂ Feature: AI Description Rewriting for Cost-Plus Invoices

**Problem:** Cost-Plus invoices created via `createDraftCostPlusInvoice()` had raw, internal-facing descriptions ÃÂ¢ÃÂÃÂ vendor sub-groups showed "Bill 1 - Vendor Name" and labor line items showed raw date breakdowns like "Mar 13: 2.0h". The Fixed-Price/Billable flow already had AI description rewriting, but Cost-Plus did not.

**Solution ÃÂ¢ÃÂÃÂ AI Descriptions at Creation Time (`createDraftCostPlusInvoice`):**

1. **Vendor sub-group descriptions**: After creating each vendor group, fetches the original vendor bill's cost item descriptions from JT via PAVE, sends them to Claude Sonnet (`claude-sonnet-4-20250514`), and gets back a 1-2 sentence client-facing summary. Same prompt pattern as the billable flow.

2. **BKB Labor group description**: Collects unique time entry notes from all uninvoiced time entries, sends to Claude for bullet-point rewriting, sets as the labor group description. Added `notes` field to the time entry PAVE query (was missing).

3. **Worker labor line item descriptions**: Each worker's time entry notes are collected and rewritten by Claude into a 1-2 sentence professional description of work performed. Falls back to date breakdown if no notes exist or AI call fails.

All AI calls gracefully degrade ÃÂ¢ÃÂÃÂ if Anthropic API fails, the invoice still creates with original/fallback descriptions.

**Solution ÃÂ¢ÃÂÃÂ Reorganize Step Fix:**

The `reorganizeCostPlusInvoice()` function was designed for JT's native "Bills & Time" UI which creates flat "Time Cost for [date]" and "Vendor Bill XXX" groups. When our API creates invoices with structured "Vendor Bills" and "BKB Labor" parent groups, the reorganize step's idempotency cleanup (line ~4084) was deleting these groups and their AI descriptions.

Added early detection: if the invoice has "Vendor Bills" or "BKB Labor" parent groups WITHOUT "Time Cost for..." groups, it's an API-created invoice. In this case, the reorganize function uses a lighter-touch path that:
- Preserves existing group structure and AI descriptions
- Renames "Vendor Bills" ÃÂ¢ÃÂÃÂ "Trade Partners" or "Materials" based on cost code/type classification
- Splits into both Trade Partners + Materials if mixed vendor types
- Sets `showChildren: false` on vendor sub-groups
- Runs AI category-level description rewriting on top-level groups

**End-to-end flow (Cost-Plus one-click invoice):**
1. Dashboard button ÃÂ¢ÃÂÃÂ `POST /api/dashboard/invoicing/create-invoice` ÃÂ¢ÃÂÃÂ creates invoice with AI descriptions on all groups and line items
2. Reorganize ÃÂ¢ÃÂÃÂ `POST /api/dashboard/invoicing/reorganize-invoice` ÃÂ¢ÃÂÃÂ renames Vendor Bills to Trade Partners/Materials, preserves AI descriptions

**Files changed:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added AI description rewriting to `createDraftCostPlusInvoice()`: vendor sub-groups (bill description lookup + Claude rewrite), BKB Labor group (time entry notes + Claude rewrite), worker labor line items (per-worker notes + Claude rewrite); added `notes` to time entry PAVE query; added `notes` to `TEInfo` type; fixed `Set` spread for TypeScript compatibility (`Array.from()`); added API-created invoice detection + light-touch reorganization path in `reorganizeCostPlusInvoice()`
- `ARCHITECTURE.md` ÃÂ¢ÃÂÃÂ Updated project structure (added reorganize-invoice + queue-invoice routes), API endpoints table, changelog

### 2026-03-19 ÃÂ¢ÃÂÃÂ Feature: Dashboard Overhaul ÃÂ¢ÃÂÃÂ Per-User PIN Auth, Live Tasks, JT Comments, Task Actions

**Problem:** The dashboard had multiple fundamental issues:
1. No login page ÃÂ¢ÃÂÃÂ navigating to `/dashboard` on a fresh browser showed infinite "Loading" because `useAuth()` returned no userId and there was no redirect to a login page
2. The single shared PIN (APP_PIN env var) meant nobody knew their PIN and there was no way to create one
3. Tasks showed 0 ÃÂ¢ÃÂÃÂ two bugs: the org-level PAVE query capped at 100 results (oldest first, Nathan's tasks on newer jobs were excluded), and tasks with `progress: null` (unstarted schedule tasks) were excluded by the `progress < 1` filter
4. JT comments showed "Unknown" author and empty job names because they were read from a stale Supabase cache that didn't store those fields
5. Users had to re-login every page load because the auth check ran async after the redirect had already fired

**Solution ÃÂ¢ÃÂÃÂ Per-User PIN Authentication:**
- Created `/dashboard/login` page with 4-step flow: select user ÃÂ¢ÃÂÃÂ enter PIN (if exists) ÃÂ¢ÃÂÃÂ or create PIN (4+ digits) ÃÂ¢ÃÂÃÂ confirm PIN
- PINs stored per-user in Supabase `agent_cache` table with key pattern `user-pin:{userId}`
- Auth API (`/api/auth`) updated with 3 flows: login (validate per-user PIN), setup (create/update PIN), check (has PIN?)
- Legacy shared APP_PIN still works for backward compatibility
- `validateAuth()` updated to accept both per-user tokens and legacy tokens

**Solution ÃÂ¢ÃÂÃÂ Persistent Login:**
- Added `loading` state to `useAuth()` hook ÃÂ¢ÃÂÃÂ initial state is `loading: true`
- Dashboard layout waits for `auth.loading` to be `false` before redirecting to login
- Token stored in `localStorage` persists across browser sessions ÃÂ¢ÃÂÃÂ no re-login required

**Solution ÃÂ¢ÃÂÃÂ Task Query Fix (12ÃÂ¢ÃÂÃÂ14 tasks found):**
- Changed from org-level query (100-item cap, oldest first) to per-active-job scan
- Queries each active job's tasks in parallel batches of 5 (lightweight: IDs + memberships only)
- Filters client-side for `progress < 1 OR progress === null` to catch unstarted schedule tasks
- Pass 2 fetches full details (name, dates, assignees) only for matched tasks (~14)
- Skips closed jobs entirely ÃÂ¢ÃÂÃÂ only scans the ~49 active jobs
- Added `job.number` to task query for display

**Solution ÃÂ¢ÃÂÃÂ Live JT Comments with Author Names:**
- Replaced stale Supabase cache query with live PAVE queries per active job
- Fetches `createdByMembership.user.name` for real author names
- Filters to messages mentioning the user's first name (directed at them)
- Excludes messages written by the user themselves
- Returns job name and number for each comment

**Solution ÃÂ¢ÃÂÃÂ AI Analysis Improvements:**
- Role-specific prompts rewritten for Nathan (owner) and Terri (admin) with specific context about their responsibilities
- Daily logs: AI instructed to only surface actionable items, not summarize routine logs
- Added `emailsNeedingReply` section to analysis output (data model ready, Gmail integration pending)
- Task summaries include assignee names so AI knows who's responsible
- All prompt sections explicitly reference the user's name and use actual job names/numbers from data

**Solution ÃÂ¢ÃÂÃÂ Task Actions from Dashboard:**
- Added complete button (circle checkbox) on each task ÃÂ¢ÃÂÃÂ click marks as done in JT (progress=1)
- Task fades out and removes from list immediately on completion
- Added clickable due date that opens inline date picker ÃÂ¢ÃÂÃÂ updates both startDate and endDate in JT
- Urgency badge recalculates locally after date change
- New PATCH endpoint at `/api/dashboard/tasks` handles both `complete` and `update` actions

**API Changes:**
| Endpoint | Change |
|----------|--------|
| `POST /api/auth` | Added per-user PIN flows: login, setup, check |
| `PATCH /api/dashboard/tasks` | **NEW** ÃÂ¢ÃÂÃÂ Complete tasks and update due dates |
| `GET /api/dashboard/overview` | Now returns live JT data with author names and all user tasks |

**Files changed:**
- `app/api/auth/route.ts` ÃÂ¢ÃÂÃÂ Rewritten for per-user PIN auth with Supabase storage
- `app/api/lib/auth.ts` ÃÂ¢ÃÂÃÂ Updated `validateAuth()` to accept per-user tokens
- `app/api/dashboard/tasks/route.ts` ÃÂ¢ÃÂÃÂ Added PATCH handler for complete/update actions
- `app/dashboard/login/page.tsx` ÃÂ¢ÃÂÃÂ **NEW** Per-user PIN login page with setup flow
- `app/dashboard/layout.tsx` ÃÂ¢ÃÂÃÂ Added auth gate with loading state, login page bypass
- `app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ Added task complete button, due date editor, `emailsNeedingReply` type
- `app/hooks/useAuth.ts` ÃÂ¢ÃÂÃÂ Added `loading` state for persistent login
- `app/lib/dashboard-data.ts` ÃÂ¢ÃÂÃÂ Rewritten: live PAVE comments, per-job task scan, Gmail/email data model
- `app/lib/dashboard-analysis.ts` ÃÂ¢ÃÂÃÂ Rewritten: role-specific prompts for Nathan/Terri, daily log actionable-only, email section
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added `getOpenTasksForMemberAcrossJobs()` (paginated per-job scan with null progress handling), exported `pave()`, increased `getAllOpenTasks` to 100 with null progress filter
- `ARCHITECTURE.md` ÃÂ¢ÃÂÃÂ Added login page to project structure, full changelog entry

### 2026-03-18 ÃÂ¢ÃÂÃÂ Feature: User Login with Team Selection + Personalized AI Dashboard

**Problem:** The app used a single shared PIN with no user identity tracking. The dashboard was hardcoded to Nathan's data. All team members saw the same view regardless of their role.

**Solution ÃÂ¢ÃÂÃÂ User Login (Phase 1-3):**

1. **Token format**: Extended from `base64(pin:timestamp)` to `base64(pin:userId:timestamp)`. Backward compatible ÃÂ¢ÃÂÃÂ old tokens still validate but return no userId. Updated all 11 API routes to use `validateAuth().valid` instead of boolean.

2. **User selection screen**: After PIN entry, shows "Who are you?" with 5 team member buttons. Each shows name, role, and initials. Selected userId is embedded in the auth token.

3. **TEAM_USERS config** (in `constants.ts`): Maps userId ÃÂ¢ÃÂÃÂ name, initials, role, membershipId. Roles: Nathan (owner), Terri (admin), Evan (field_sup), Josh (field_sup), Dave (field).

4. **useAuth() hook** (`app/hooks/useAuth.ts`): Client-side hook that decodes the token to extract userId, looks up full user profile from TEAM_USERS, returns `{ userId, user, role, membershipId, permissions, isAuthenticated }`.

5. **Dashboard layout**: Shows current user's initials in avatar (was hardcoded "NK"). Uses useAuth() hook.

**Solution ÃÂ¢ÃÂÃÂ Personalized AI Dashboard (Phase 4):**

1. **Data aggregation** (`app/lib/dashboard-data.ts`): `buildUserDashboardData(userId)` fetches per-user tasks (via `getOpenTasksForMember`), active jobs, recent JT comments and daily logs from Supabase cache (last 7 days). Tasks classified by urgency (urgent/high/normal) with days-until-due.

2. **AI analysis** (`app/lib/dashboard-analysis.ts`): `analyzeUserDashboard(data)` calls Claude with role-specific prompts. Returns structured JSON: `{ summary, urgentItems, upcomingDeadlines, flaggedMessages, actionItems }`. Includes fallback rule-based analysis when AI unavailable. Role prompts:
   - Owner: business health, team performance, cross-project insights
   - Admin: billing priorities, AP/AR, documents
   - Field sup: today's priorities, material needs, schedule conflicts
   - Field: simple task checklist

3. **API endpoint** (`app/api/dashboard/overview/route.ts`): Per-user caching via `agent_cache` table with key `dashboard-overview-{userId}`. Supports `?cached=true` and `?refresh=true`. maxDuration: 60.

4. **Dashboard page** (`app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ complete rewrite): Personalized greeting, 4 stat cards (Urgent, High Priority, Due Today, Open Tasks), AI Briefing panel, Needs Immediate Attention section, Action Items, Upcoming Deadlines, Messages to Review, Task list, Quick Actions (role-based nav links). Refresh button for fresh analysis.

**Key architectural decisions:**
- All roles use `getOpenTasksForMember(membershipId)` instead of `getAllOpenTasks()` to avoid PAVE 413 errors on the org-wide task query
- Per-user cache keys isolate each user's dashboard analysis
- Role-based RBAC uses existing `ROLE_CONFIG` from constants.ts
- Dashboard page uses `useAuth()` for all personalization ÃÂ¢ÃÂÃÂ no hardcoded values

**New files:**
- `app/hooks/useAuth.ts` ÃÂ¢ÃÂÃÂ Client-side auth hook
- `app/lib/dashboard-data.ts` ÃÂ¢ÃÂÃÂ Per-user data aggregation
- `app/lib/dashboard-analysis.ts` ÃÂ¢ÃÂÃÂ AI analysis engine with role-specific prompts
- `app/api/dashboard/overview/route.ts` ÃÂ¢ÃÂÃÂ Cached dashboard API endpoint

**Modified files:**
- `app/api/auth/route.ts` ÃÂ¢ÃÂÃÂ Token includes userId
- `app/api/lib/auth.ts` ÃÂ¢ÃÂÃÂ Returns `{ valid, userId }` instead of boolean
- `app/lib/constants.ts` ÃÂ¢ÃÂÃÂ Added TEAM_USERS config
- `app/page.tsx` ÃÂ¢ÃÂÃÂ Two-step login: PIN ÃÂ¢ÃÂÃÂ user selection
- `app/dashboard/layout.tsx` ÃÂ¢ÃÂÃÂ Dynamic user initials in avatar
- `app/dashboard/page.tsx` ÃÂ¢ÃÂÃÂ Complete rewrite with AI-powered personalized dashboard
- 11 API routes ÃÂ¢ÃÂÃÂ Updated `validateAuth()` call sites to use `.valid`

**Commits:** `2ef8f51`, `b45bdef`, `6b3ff74`

---

### 2026-03-18 ÃÂ¢ÃÂÃÂ Fix: Time Entry Pagination for Jobs with >100 Entries

**Problem:** The Invoicing Health Dashboard showed 0 billable labor hours for Halvorsen Roof/Exterior (Job #154), despite 102.5 hours of CC23 "23 Billable" time entries visible in JobTread. The dashboard's summary cards, alerts, and invoice creation all reported zero unbilled hours.

**Root Cause:** `getTimeEntriesForJob()` called PAVE with `size: 100`, but PAVE returns entries **oldest-first** and has a hard cap of 100 per query. Halvorsen has 145 time entries total. The first 100 entries (June 2025 ÃÂ¢ÃÂÃÂ Jan 9, 2026) were returned, but all 18 CC23 billable entries (Jan 21 ÃÂ¢ÃÂÃÂ Feb 20, 2026) fell in positions 101ÃÂ¢ÃÂÃÂ145 and were silently dropped. The `analyzeContractJob()` filter `entry.costItem?.costCode?.number === '23'` found zero matches, producing 0 hours.

**Solution:** Rewrote `getTimeEntriesForJob()` to paginate through ALL time entries using PAVE's `where: ["id", ">", lastId]` filter. Each page fetches up to 100 entries; subsequent pages use the last entry's ID as a cursor. Loop continues until fewer than 100 entries are returned or a safety cap of 10 pages (1,000 entries) is reached. Removed the `limit` parameter entirely ÃÂ¢ÃÂÃÂ the function always fetches all entries for a job. Initial deploy had a bug where `limit=100` caused `allEntries.length >= limit` to break after page 1 (100 >= 100), preventing page 2 from ever running.

**PAVE pagination discovery:** PAVE does NOT support `offset`, `after`, `pageInfo`, `sort`, or `orderBy` on `job.timeEntries`. The only working pagination approach is `where: ["id", ">", lastId]` which exploits PAVE's deterministic ID ordering (same as creation order, which matches the oldest-first default sort).

**Verified on Halvorsen Roof/Exterior (Job #154):** Page 1 returns 100 entries, page 2 returns 45 entries (total 145). All 18 CC23 entries now included, totaling 102.5 hours ÃÂ¢ÃÂÃÂ matching JobTread UI exactly.

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Rewrote `getTimeEntriesForJob()`: paginated fetch loop using `["id", ">", lastId]` cursor, safety cap of 10 pages, falls back to org-level query on failure
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Removed explicit `100` limit arg (uses default with pagination)

---

### 2026-03-18 ÃÂ¢ÃÂÃÂ Enhancement: Fixed-Price Invoice Template, Custom Field Pricing, QTY Hidden

**Problem:** Fixed-Price billable invoices were missing company contact info (phone, email, address were blank), showed the QTY column unnecessarily, used hardcoded 25% markup and $115/hr rate instead of project-specific pricing, and the main group was named "Trade Partners" instead of "Billable Items."

**Solution:**
1. **Company info**: Sets `fromAddress` ("7843 Richlandtown Rd, Quakertown, PA 18951, USA") and `fromOrganizationName` ("Brett King Builder-Contractor Inc.") via `updateDocument` after creation. Phone/email fields don't exist on PAVE documents ÃÂ¢ÃÂÃÂ they come from the JT template when created through the UI.

2. **Hide QTY column**: Sets `showQuantity: false` via `updateDocument` after creation. The field exists on documents and persists correctly.

3. **Custom field pricing**: Reads job custom fields "Margin" (ID: `22PAE53xn6XJ`) and "Hourly Rate" (ID: `22PAE4yybHpg`) from the job's `customFieldValues`. Materials/subs use `cost ÃÂÃÂ (1 + margin/100)` for pricing (e.g., 30% margin = 1.30ÃÂÃÂ multiplier). Labor uses the hourly rate directly as `unitPrice`. Defaults if fields not set: 25% margin, $115/hr.

4. **Renamed group**: "Trade Partners" ÃÂ¢ÃÂÃÂ "Billable Items" for Fixed-Price invoices (Cost-Plus still uses "Trade Partners")

5. **Customer contact info**: Fetches phone and email from the job's account contacts via `location.account.contacts.customFieldValues` for internal reference

**Bill/labor tracking (preventing duplicate billing):**
The FIFO deduction system handles this automatically. Each time "Create Billable Invoice" is run, it compares CC23 vendor bill costs against CC23 customer invoice costs per budget item. Items already on approved/pending invoices are deducted. Draft invoices are filtered out (`status !== 'draft'`), so creating and deleting drafts has no effect on the tracking. Source bill references are embedded in each line item's description (hidden from client via `showChildren: false`, visible to team when expanding) ÃÂ¢ÃÂÃÂ e.g., "Source: Bill 187-14 | 01-Gen Supplies, Admin Costs."

**Verified on Sines Add Powder Room (Job #187, Margin=30%, Hourly Rate=$125):**
- Doylestown Borough Bill: $254.50 ÃÂÃÂ 1.30 = $330.85 ÃÂ¢ÃÂÃÂ
- Middle Department Inspection: $100 ÃÂÃÂ 1.30 = $130.00 ÃÂ¢ÃÂÃÂ
- BKB Labor: 2h ÃÂÃÂ $125 = $250.00 ÃÂ¢ÃÂÃÂ
- Total: $710.85 ÃÂ¢ÃÂÃÂ
- Company address populated, QTY hidden, "Billable Items" group name ÃÂ¢ÃÂÃÂ
- After draft deletion, numbers return to $354.50 + 2h ÃÂ¢ÃÂÃÂ

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Updated `createDraftBillableInvoice()`: reads Margin/Hourly Rate custom fields, sets fromAddress/fromOrganizationName/showQuantity via updateDocument, renamed group to "Billable Items", margin-based pricing for materials/subs, hourly rate for labor

**Commits:** `8ef842f`

---

### 2026-03-18 ÃÂ¢ÃÂÃÂ Feature: Fixed-Price Billable Invoice with BKB 3-Group Format

**Problem:** The Fixed-Price "Create Billable Invoice" button had two issues: (1) it used budget-item-ID presence to determine what's been invoiced (same bug as the old Cost-Plus code ÃÂ¢ÃÂÃÂ fails when multiple vendor bill items share a budget ID), and (2) it created invoices with a flat structure instead of the BKB 3-group format with AI descriptions.

**Solution ÃÂ¢ÃÂÃÂ FIFO deduction fix:** Replaced the `billedBudgetItemIds` Set-based filter with per-budget-item FIFO deduction (same approach as Cost-Plus). Groups CC23 vendor bill costs by budget item, deducts invoiced amounts from oldest items first, includes items not fully covered.

**Solution ÃÂ¢ÃÂÃÂ 3-group format:** Rewrote the invoice creation to use the same Trade Partners / Materials / BKB Labor structure as Cost-Plus:
- **Trade Partners**: CC23 subcontractor items from vendor bills, grouped by vendor, with AI-rewritten bill descriptions and `showChildren: false`
- **Materials**: CC23 material items from vendor bills, same formatting
- **BKB Labor**: CC23 time entries with AI-rewritten notes from time entry descriptions, worker breakdown in hidden line item description

**Pricing fix:** Vendor bill items have `unitPrice: 0` (bills don't have sell prices). Now falls back to `cost ÃÂÃÂ 1.25` markup when unitPrice is missing.

**AI prompt fix:** Category-level AI description prompts were too open-ended ÃÂ¢ÃÂÃÂ Claude sometimes returned conversational text instead of bullet points. Updated prompts to explicitly say "Output ONLY the bullet points, nothing else."

**Bill references:** Each line item's description includes the source bill reference (e.g., "Source: Bill 187-14 | 01-Gen Supplies, Admin Costs"). Hidden from client since `showChildren: false`, but visible to team when expanding.

**Draft deletion tracking:** Confirmed working ÃÂ¢ÃÂÃÂ the analysis filters customer invoices with `status !== 'draft'`, so drafts never affect unbilled calculations. Creating and deleting a draft leaves the numbers unchanged.

**Verified on Sines Add Powder Room (Job #187):**
- Dashboard: Billable $354.50 + Labor 2h (matches JT)
- Draft Invoice 71: 3 items totaling $673.13 (bills with 25% markup + 2h ÃÂÃÂ $115)
- Trade Partners: Doylestown Borough ($318.13) + Middle Department Inspection ($125.00) with AI descriptions
- BKB Labor: $230.00 with AI-rewritten time entry notes
- After draft deletion: numbers return to $354.50 + 2h

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Rewrote `createDraftBillableInvoice()`: FIFO deduction for CC23 items, BKB 3-group format with AI descriptions, 25% markup on bills, bill references in line items, `showChildren: false`, fixed AI prompts for all description generation

**Commits:** `576ccd8`, `4508e7d`

---

### 2026-03-17 ÃÂ¢ÃÂÃÂ Feature: Invoice Reorganization into BKB 3-Group Format with AI Descriptions

**Problem:** Invoices created through JT's Bills & Time UI have a flat structure ÃÂ¢ÃÂÃÂ all vendor bill groups and time cost groups are at the top level with no categorization. Descriptions default to generic bill subjects like "Edwards - ongoing". The Behmlander Invoice 199-15 established the BKB standard: three parent categories with bullet-point descriptions, vendor bills grouped under Trade Partners or Materials, and labor under BKB Labor with work descriptions from time entry notes.

**Solution:** Added `reorganizeCostPlusInvoice()` function that restructures a JT-created invoice into the BKB 3-group format via PAVE API after the Bills & Time UI creates it:

1. **Trade Partners** ÃÂ¢ÃÂÃÂ subcontractor and admin vendor bills (cost codes 1, 18, 20-23)
   - Parent group gets AI-written summary of trade partner types
   - Each bill sub-group gets AI-rewritten description from the original vendor bill's cost item descriptions (replaces generic subjects like "Edwards - ongoing")

2. **Materials** ÃÂ¢ÃÂÃÂ material vendor bills (cost type "Materials")
   - Parent group gets AI-written summary of materials purchased
   - Each bill sub-group gets AI-rewritten description from the bill's item list

3. **BKB Labor** ÃÂ¢ÃÂÃÂ all time entry groups
   - Parent group gets AI-written work description built from time entry notes (only entries whose dates match the invoice's "Time Cost for [date]" groups, not all job entries)
   - Time cost sub-groups kept as-is ("Time Cost for Wed, Nov 12, 2025" etc.)

**Key technical details:**
- `showChildren: false` on ALL sub-groups (hides individual line items, matching Behmlander pattern where only group headers show)
- Bill descriptions fetched by matching group name bill numbers to vendor bill documents (required `String(d.number)` coercion ÃÂ¢ÃÂÃÂ PAVE returns numbers as number type, not string)
- AI rewriting uses Claude Sonnet via Anthropic API for both category-level and bill-level descriptions
- Function is idempotent ÃÂ¢ÃÂÃÂ deletes existing category groups before recreating (safe to run twice)
- JT Bills & Time creates ALL groups flat at the top level (no nesting) ÃÂ¢ÃÂÃÂ function re-parents them under new category groups using `updateCostGroup` with `parentCostGroupId`

**API endpoint:** `POST /api/dashboard/invoicing/reorganize-invoice` ÃÂ¢ÃÂÃÂ takes `{ documentId, jobId }`, calls `reorganizeCostPlusInvoice()`, returns success with descriptions

**Full invoice creation flow:**
1. Dashboard button ÃÂ¢ÃÂÃÂ queues request in Supabase
2. Scheduled task ÃÂ¢ÃÂÃÂ creates invoice through JT Bills & Time UI (Chrome automation)
3. Reorganize API ÃÂ¢ÃÂÃÂ restructures into 3 categories, hides line items, AI-rewrites all descriptions

**Verified on Edwards Ongoing (Invoice 170-28):**
- Olde Town Painting: "Prepared and painted basement walls and ceiling in areas where horizontal chase was replaced, including trim preparation using premium Benjamin Moore Regal eggshell finish."
- Reeds Appliance Repair: "Replaced electrode assembly on front left burner and conducted testing to ensure proper operation."
- Wehrung's Lumber: "Supplied primed lumber materials including 1x8 boards, quarter round molding, and base shoe trim."
- BKB Labor: Three polished bullet points from time entry notes

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added `reorganizeCostPlusInvoice()`, `deleteJTCostGroup()`, `updateJTCostGroup()` helper functions; bill description fetching + AI rewriting per sub-group; `showChildren: false` on all sub-groups; idempotency (deletes old category groups); `String()` coercion for bill number matching
- `app/api/dashboard/invoicing/reorganize-invoice/route.ts` ÃÂ¢ÃÂÃÂ **NEW** POST endpoint (maxDuration=60)

**Commits:** `446947d`, `a687a8f`, `448940a`, `1ed3045`, `6ced968`, `4ab0ba0`

---

### 2026-03-17 ÃÂ¢ÃÂÃÂ Feature: Queue-Based Invoice Creation via JT Bills & Time UI

**Problem:** When invoices are created via the PAVE API (createDocument + createCostItem), JT's native "Not Invoiced" tracking in the Bills and Time tab doesn't update ÃÂ¢ÃÂÃÂ bills and time entries still show as uninvoiced. Only invoices created through JT's own UI Bills & Time flow properly mark items as invoiced (even in draft status). Exhaustive testing confirmed there is no PAVE API method to replicate this linkage ÃÂ¢ÃÂÃÂ `sourceCostItemId` on createCostItem is accepted but doesn't persist, `updateCostItem` rejects it as "invalid", and no document-level or time-entry-level linkage fields exist.

**Solution:** Replaced direct PAVE invoice creation with a queue-based system that uses Chrome browser automation to drive JT's native Bills & Time UI flow:

1. **Dashboard button** ÃÂ¢ÃÂÃÂ writes a request to Supabase `invoice_creation_requests` table (with duplicate detection)
2. **Claude scheduled task** ("create-jt-invoice") ÃÂ¢ÃÂÃÂ reads pending requests from Supabase, opens Chrome to JT, navigates through + Document ÃÂ¢ÃÂÃÂ Invoice ÃÂ¢ÃÂÃÂ Bills and Time ÃÂ¢ÃÂÃÂ Select All ÃÂ¢ÃÂÃÂ Create
3. **JT marks items as invoiced** because the invoice was created through the native UI flow

**Supabase table:** `invoice_creation_requests` ÃÂ¢ÃÂÃÂ columns: id (UUID), job_id, job_name, job_number, client_name, status (pending/processing/completed/failed), invoice_number, invoice_id, error, created_at, updated_at, completed_at

**Changes:**
- `app/api/dashboard/invoicing/queue-invoice/route.ts` ÃÂ¢ÃÂÃÂ **NEW** POST endpoint that inserts into `invoice_creation_requests` with duplicate detection for pending/processing requests
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ Changed `CostPlusJobCard` button handler from direct PAVE call (`/api/dashboard/invoicing/create-invoice`) to queue call (`/api/dashboard/invoicing/queue-invoice`); updated success message to instruct user to run the scheduled task

**Scheduled task:** `create-jt-invoice` (on-demand, no cron) ÃÂ¢ÃÂÃÂ reads pending requests from Supabase REST API, processes each via Chrome browser automation through JT's Bills & Time flow, updates Supabase with result. Located at `~/Documents/Claude/Scheduled/create-jt-invoice/SKILL.md`.

**Verified on Edwards Ongoing (Job #170):** Dashboard button queued request ÃÂ¢ÃÂÃÂ scheduled task created Invoice 170-23 through JT UI ÃÂ¢ÃÂÃÂ Bills & Time "Not Invoiced" list cleared to empty ÃÂ¢ÃÂÃÂ Supabase request marked as completed.

**Key finding ÃÂ¢ÃÂÃÂ PAVE API has NO Bills & Time linkage support:**
- `sourceCostItemId` on `createCostItem`: accepted silently but `sourceCostItem` reads back as null
- `sourceCostItemId` on `updateCostItem`: rejected with "The source cost item ID provided is invalid"
- `timeEntryIds` on `createCostItem`: rejected with "no value is ever expected there"
- No document-level bill linkage fields exist (tested: bills, vendorBills, linkedDocuments, sourceDocuments, etc.)
- No time entry update fields exist for marking as invoiced (tested: invoiced, isInvoiced, documentId, invoiceId, etc.)
- No dedicated mutations exist (tested: linkBillToInvoice, invoiceBills, addBillToInvoice, etc.)
- Even UI-created invoices have `sourceCostItem: null` and `timeEntries: {nodes: []}` on all cost items ÃÂ¢ÃÂÃÂ the linkage is completely internal to JT

**Commits:** `b5bbbd0`

### 2026-03-17 ÃÂ¢ÃÂÃÂ Fix: Cost-Plus Invoicing Rewritten to Use Bills & Time (Not Budget Items)

**Problem:** The Cost-Plus analysis (`analyzeCostPlusJob`) and invoice creation (`createDraftCostPlusInvoice`) were fundamentally wrong. They used `jobCostItemId` presence to determine what's been billed, but multiple vendor bills can share the same budget item ÃÂ¢ÃÂÃÂ causing false matches. For example, on Edwards Ongoing, Wehrung's Lumber ($24.56) and Freedom Millwork ($911.39) both referenced the same "14-Trim, Finish:1403 - Materials" budget item. Since Freedom's bill was invoiced, Wehrung's was falsely flagged as invoiced too. The invoice creation function also pulled from budget items instead of actual vendor bills and time entries, which doesn't match JT's "Bills and Time" model for Cost-Plus.

**Root Cause:** The old approach matched vendor bill cost items to invoice cost items by `jobCostItemId` (budget item bridge). This works when each bill maps to a unique budget item, but fails when multiple bills share one. JT's native Cost-Plus billing works from vendor bills and time entries directly, not budget estimates.

**Solution ÃÂ¢ÃÂÃÂ Analysis (`analyzeCostPlusJob`):**
- Fetch vendor bill cost items per-document (one document at a time via `getDocumentCostItemsById` to avoid 413 errors)
- Group vendor bill costs by `jobCostItemId`, then use per-budget-item **FIFO deduction**: sum invoiced amounts from customer invoices for each budget item, then deduct from the oldest vendor bills first. Bills not fully covered = uninvoiced.
- For time entries: group by budget cost item (`costItem.id`), deduct invoiced hours (from invoice line item quantities) per budget item, oldest entries first.
- Added `cost` field to time entry PAVE queries and `JTTimeEntry` interface.
- Added `jobCostItem: { id: {} }` to `getDocumentCostItemsById` query.

**Solution ÃÂ¢ÃÂÃÂ Invoice Creation (`createDraftCostPlusInvoice`):**
- Complete rewrite: now pulls from uninvoiced vendor bills + time entries instead of budget items.
- Uses the same FIFO deduction logic to determine which bills and time entries are uninvoiced.
- Groups vendor bill items by vendor name on the invoice (sub-groups under "Vendor Bills").
- Groups time entries by worker under "BKB Labor" with date breakdown in description.
- Uses 25% markup on bills, $115/hr (Master Craftsman) and $55/hr (Journeyman) billing rates for labor.

**Verified on Edwards Ongoing (Job #170):**
- Dashboard unbilled costs: $808.66 ÃÂ¢ÃÂÃÂ exact match with JT "Not Invoiced" view (Olde Town $270 + Wehrung's $24.56 + Reeds $514.10)
- Draft Invoice #15 created with 5 items ($1,803.33): 3 vendor bill items + 2 labor items
- Old code would have shown Wehrung's as already invoiced (wrong) and pulled budget items instead of actual bills

**Key Architectural Lesson ÃÂ¢ÃÂÃÂ Per-Budget-Item FIFO Deduction:**
- Multiple vendor bills can reference the same `jobCostItemId` (budget item)
- You CANNOT determine if a specific bill is invoiced by checking if its `jobCostItemId` appears on any customer invoice
- Instead: sum all vendor bill costs per budget item, sum all invoiced costs per budget item, deduct from oldest bills first
- PAVE `sourceCostItemId` on `createCostItem` is accepted as a parameter but doesn't persist the linkage (tested and confirmed null on read-back)
- PAVE `timeEntryIds` is NOT a valid `createCostItem` parameter (returns "no value is ever expected there")

**Changes:**
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Rewrote `analyzeCostPlusJob()`: removed `getDocumentCostItemsForJob` call, added per-document vendor bill fetching via `getDocumentCostItemsById`, implemented FIFO deduction for both bills and time entries
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Rewrote `createDraftCostPlusInvoice()`: pulls from uninvoiced vendor bills and time entries instead of budget items; added `jobCostItem: { id: {} }` to `getDocumentCostItemsById` query; added `cost` field to time entry PAVE query and `JTTimeEntry` interface; fixed PAVE query size limit (200 ÃÂ¢ÃÂÃÂ 100)

**Commits:** `3e6dc4c`, `235bbec`

---

### 2026-03-17 ÃÂ¢ÃÂÃÂ Feature: One-Click Billable Invoice for Fixed-Price Contract Jobs

**Problem:** Fixed-Price (contract) jobs on the dashboard showed uninvoiced CC23 billable items and labor hours, but creating an invoice required manually entering everything in JobTread.

**Solution:** Added "Create Billable Invoice" button to ContractJobCard. Creates a draft customer invoice containing CC23 materials/subcontractor items from vendor bills (not yet on customer invoices) and unbilled CC23 labor hours. Items are matched by `jobCostItemId` to prevent double-billing. Labor billed at $85/$115 per hour with worker breakdown in description.

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added `createDraftBillableInvoice()` function (~250 lines). Queries vendor bill CC23 items, customer invoice CC23 items, matches by jobCostItemId, fetches CC23 time entries, creates document shell + groups (Materials & Subs ÃÂ¢ÃÂÃÂ Labor) + items
- `app/api/dashboard/invoicing/create-billable-invoice/route.ts` ÃÂ¢ÃÂÃÂ **NEW** POST endpoint for fixed-price billable invoice creation
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ Added state, handler, and button UI to `ContractJobCard` (mirrors CostPlusJobCard pattern)

### 2026-03-17 ÃÂ¢ÃÂÃÂ Revert: Cost-Plus Unbilled Hours (Count All, Not Just CC23)

**Problem:** Incorrectly changed `analyzeCostPlusJob()` to only count CC23 time entries (commit `4d92522`). This broke Cost-Plus reporting ÃÂ¢ÃÂÃÂ Silver Maintenance dropped from 18.3h to 10.3h.

**Root Cause:** Misunderstood the business rule. Cost-Plus jobs count ALL hours as billable. ONLY Fixed-Price/contract jobs restrict to CC23.

**Solution:** Immediately reverted to original code that sums all time entries for cost-plus jobs (commit `e607ab5`).

### 2026-03-17 ÃÂ¢ÃÂÃÂ Enhancement: Invoice Group Ordering + Material Descriptions

**Problem:** Cost-Plus draft invoices had items in arbitrary order. Nathan wanted Materials at top, Labor at bottom, matching the Behmlander Invoice 199-15 pattern. Also wanted short descriptions on material items.

**Solution:** Added explicit `categoryOrder` array: materials ÃÂ¢ÃÂÃÂ admin ÃÂ¢ÃÂÃÂ subcontractor ÃÂ¢ÃÂÃÂ other ÃÂ¢ÃÂÃÂ labor. Added `buildItemDescription()` helper that generates descriptions from cost code info (e.g., "03-Concrete, Stone/Block Work") for material items.

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added `categoryOrder`, `categoryNames`, `buildItemDescription()` in `createDraftCostPlusInvoice()`

### 2026-03-17 ÃÂ¢ÃÂÃÂ Enhancement: Exclude $0.00 Placeholder Items from Cost-Plus Invoices

**Problem:** Draft invoices included $0.00 budget items that were just placeholders, cluttering the invoice.

**Solution:** Added filter after fetching unbilled items: skip any item where cost, price, unitCost, and unitPrice are all zero.

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added zero-value filter at line ~2952 in `createDraftCostPlusInvoice()`

### 2026-03-16 ÃÂ¢ÃÂÃÂ Feature: One-Click Draft Invoice for Cost-Plus Jobs

**Problem:** Creating invoices for Cost-Plus jobs required manually copying dozens of budget items into a new invoice in JobTread, a tedious process taking 30+ minutes per job.

**Solution:** Added "Create Draft Invoice" button to CostPlusJobCard on the Invoicing Health Dashboard. One click creates a complete draft customer invoice in JobTread with all unbilled budget items, properly organized into cost groups. Uses paginated lean PAVE queries (PAGE_SIZE=30) to avoid 413 errors, creates document shell with BKB-standard settings, then sequentially creates cost groups and items with `jobCostItemId` links.

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added `createDraftCostPlusInvoice()`, `createJTDocument()`, `createJTCostGroup()`, `createJTCostItem()` PAVE mutation functions
- `app/api/dashboard/invoicing/create-invoice/route.ts` ÃÂ¢ÃÂÃÂ **NEW** POST endpoint (maxDuration=60)
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ Added state, handler, and button UI to `CostPlusJobCard`

**Tested:** Edwards Ongoing (Invoice 170-13, 66 items, $3,784.15) ÃÂ¢ÃÂÃÂ created and cleaned up successfully.

### 2026-03-16 ÃÂ¢ÃÂÃÂ Fix: Labor Hours Deduction (Name vs CostType)

**Problem:** After switching Fixed-Price billable detection to costType-based filtering (commit `b04f7ee`), the labor hours deduction broke. The Sines project had 3.9 billable hours, and Invoice #69 billed 2.9 of those hours, but the dashboard still showed 3.9 unbilled. The 2.9 hours were never deducted.

**Root Cause:** The labor line item on Invoice #69 ("23 Billable Labor") has `costType: "Other"`, not `costType: "Labor"`. The costType-based filter `item.costType?.name === 'Labor'` didn't match, so billed hours were always zero. In BKB's JobTread setup, the "Labor" costType is for internal labor on vendor bills, while billable labor on customer invoices uses "Other".

**Solution:** Reverted labor hour deduction filter from costType-based (`costType.name === 'Labor'`) back to name-based (`name.toLowerCase().includes('labor')`), which correctly matches items like "23 Billable Labor" regardless of their costType.

**Changes:**
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Changed `cc23LaborOnInvoices` filter from `costType?.name === 'Labor'` to `name?.toLowerCase().includes('labor')`

**Commits:** `c45971a`

---

### 2026-03-16 ÃÂ¢ÃÂÃÂ Fix: CostCode + CostType Filter for Fixed-Price Billable Items

**Problem:** The Sines Powder Room project had two vendor bills coded to Cost Code 23 with costType "Subcontractor" ($100 and $254.50), but the dashboard showed Billable: $0. These items had names like "01-Gen Supplies, Admin Costs:0102 - Sub" that didn't match the `name.startsWith('23 Billable')` prefix filter.

**Solution:** For Fixed-Price jobs only, switched billable detection from name-prefix to costCode + costType:
- **Billable costs:** `costCode.number === '23'` + `costType.name` in `['Materials', 'Subcontractor']`
- **Labor hours:** Kept separate ÃÂ¢ÃÂÃÂ uses name-based filter (see commit `c45971a`)
- Cost-Plus jobs and `findBillableItems()` still use the old name prefix filter

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added `costType: { id: {}, name: {} }` to `getDocumentCostItemsById` PAVE query
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Added `BILLABLE_COST_TYPE_NAMES` constant; rewrote `analyzeContractJob()` billable cost calculation to use costCode + costType filter; separated `allCC23` (all CC23 items) from `cc23Billable` (Materials/Subcontractor only)

**Commits:** `b04f7ee`

---

### 2026-03-16 ÃÂ¢ÃÂÃÂ Fix: Exclude Denied (Deleted) Vendor Bills from Dashboard

**Problem:** The Sines Powder Room project had several vendor bills that were deleted in JobTread, but the dashboard still counted their costs in billable totals. This inflated the Unbilled Items amount (showed $773.85 instead of the correct amount).

**Root Cause:** Deleted bills in JobTread get `status: 'denied'` rather than being removed from the API. The code filtered documents by `type === 'vendorBill'` but never checked the `status` field.

**Solution:** Added `status !== 'denied'` filter in three places:
1. `analyzeContractJob()` ÃÂ¢ÃÂÃÂ vendor bill selection for CC23 cost analysis
2. `analyzeCostPlusJob()` ÃÂ¢ÃÂÃÂ builds a set of denied bill IDs, excludes their cost items
3. `buildInvoicingContext()` ÃÂ¢ÃÂÃÂ pre-filters cost items before passing to `findBillableItems()`

**Changes:**
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Added denied bill filtering in `analyzeContractJob()`, `analyzeCostPlusJob()`, and `buildInvoicingContext()`

**Commits:** `939ec82`

---

### 2026-03-16 ÃÂ¢ÃÂÃÂ Fix: Filter Unselected Document Options from Specs Agent

**Problem:** The Specs agent was returning results for cost items that belonged to unselected document options. In JobTread, documents (estimates/contracts) can have multiple option groups (e.g., two flooring choices), and the client selects which ones they want. The agent was showing ALL options regardless of selection status ÃÂ¢ÃÂÃÂ e.g., "Sterling Quartzite (AKT-LM51)" appeared in results even though only "Alpine Quartzite (AKT-LM50)" was selected.

**Root Cause:** The existing filtering only checked whether a document was approved, not whether individual options within that document were selected. Both selected and unselected option items exist in the budget referencing the same approved document ID.

**Solution:** Used the PAVE API `isSelected` field on document-level cost items to identify and exclude unselected options. The field returns `true` for selected options and `false` for unselected ones. After fetching document items, we build a set of unselected item IDs and filter them out of both the budget-level and document-level results before merging.

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added `isSelected: {}` to both cost items and cost groups in the `getDocumentCostItemsLightById()` PAVE query; preserved `isSelected` in the mapped return objects
- `app/api/lib/agents/project-details.ts` ÃÂ¢ÃÂÃÂ After fetching document items, builds `unselectedItemIds` set from items where `isSelected === false`; filters budget items to exclude unselected IDs; skips unselected items when processing document-level items

**Commits:** `0b8a64e`

---

### 2026-03-15 ÃÂ¢ÃÂÃÂ Fix: Specs Agent File Links (CDN URLs)

**Problem:** The Specs agent was generating hallucinated file IDs in response links. File URLs pointed to non-existent resources because the AI was fabricating file IDs rather than using actual ones from the data.

**Solution:** Changed file link generation to be server-side rather than AI-generated. File URLs now use the stable CDN pattern `https://cdn.jobtread.com/files/{fileId}` with real file IDs from the PAVE API, appended in the context string that gets passed to Claude. This prevents hallucination since the AI never constructs file URLs ÃÂ¢ÃÂÃÂ it only references pre-built links.

**Changes:**
- `app/api/lib/agents/project-details.ts` ÃÂ¢ÃÂÃÂ Modified context builder to append CDN-based file links using actual file IDs from cost items, cost groups, and parent cost groups; updated system prompt to instruct Claude to use file links from the provided data rather than constructing them

**Commits:** `9ee8d33`

---

### 2026-03-13 ÃÂ¢ÃÂÃÂ Feature: Unpaid Invoice Total on Project Cards

**Problem:** No at-a-glance visibility into how much money is outstanding (invoiced but not yet paid) per project. Users had to expand the invoice details list to mentally sum open invoices.

**Solution:** Added an inline "ÃÂ¢ÃÂÃÂ¢ $X,XXX unpaid" indicator in yellow (`#eab308`) to the subtitle row of both Contract and Cost Plus cards. Only appears when open (pending) invoices exist ÃÂ¢ÃÂÃÂ keeps cards clean when everything is paid.

**Implementation:** Computes `unpaidTotal` from `releasedInvoices.filter(status === 'open')` at render time in both card components.

**Changes:**
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ Added `unpaidTotal` calculation and conditional display to both `ContractJobCard` and `CostPlusJobCard`

**Commits:** `6646b67`

---

### 2026-03-12 ÃÂ¢ÃÂÃÂ Feature: Collapsible Invoice Details (Draft + Paid + Open)

**Problem:** Project cards showed draft invoices but had no visibility into released invoices (paid or open/pending). Nathan requested a collapsible list showing all invoices with status badges, without making the cards too large.

**Solution:** Built a combined `InvoiceDetails` component replacing the previous `DraftInvoicesList`. Features:
- Single collapsible "Invoices (N)" toggle per card, collapsed by default
- Color-coded status badges: Draft (amber `#CDA274` on `#3a322b`), Paid (green `#4ade80` on `#1a2e1a`), Open (yellow `#eab308` on `#2e2a1a`)
- Shows invoice subject/name and amount for each invoice
- Added to both Contract and Cost Plus card types

**Backend changes:**
- Added `ReleasedInvoiceInfo` interface with `status: 'paid' | 'open'` field
- Added `releasedInvoices: ReleasedInvoiceInfo[]` to both `ContractJobHealth` and `CostPlusJobHealth`
- In `analyzeContractJob()`: builds `releasedInvoiceInfos` from approved (ÃÂ¢ÃÂÃÂpaid) and pending (ÃÂ¢ÃÂÃÂopen) customer invoices
- In `analyzeCostPlusJob()`: identical released invoice gathering

**Frontend changes:**
- Added `ReleasedInvoiceInfo` interface and `releasedInvoices` field to both frontend interfaces
- Replaced `DraftInvoicesList` with `InvoiceDetails` component combining drafts + released invoices
- Added `InvoiceDetails` to both `ContractJobCard` and `CostPlusJobCard`

**Changes:**
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Added `ReleasedInvoiceInfo` interface, `releasedInvoices` to both job health interfaces, populated in both analyzer functions
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ Added `ReleasedInvoiceInfo` interface, updated both job health interfaces, new `InvoiceDetails` component, replaced `DraftInvoicesList` usage

**Commits:** `7265a64`

---

### 2026-03-12 ÃÂ¢ÃÂÃÂ Feature: Collapsible Draft Invoice List + Create $ Task Button

**Problem:** Draft invoices were mentioned in alerts but weren't individually visible on cards. Nathan needed to see each draft invoice and have the ability to create matching `$` schedule tasks directly from the card when a draft had no matching task.

**Solution:** Two additions:
1. `DraftInvoicesList` ÃÂ¢ÃÂÃÂ collapsible list showing each draft invoice with name and amount
2. `CreateTaskRow` ÃÂ¢ÃÂÃÂ inline button on unmatched draft invoices that calls `/api/dashboard/invoicing/create-task` to create a `$` schedule task in JobTread. Shows loading/success/error states. Includes duplicate detection.

**Changes:**
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ Added `DraftInvoicesList` and `CreateTaskRow` components, added to `ContractJobCard`
- `app/api/dashboard/invoicing/create-task/route.ts` ÃÂ¢ÃÂÃÂ **NEW** API endpoint for creating `$` schedule tasks from draft invoices

---

### 2026-03-12 ÃÂ¢ÃÂÃÂ Fix: Contract Job Billable Costs & Labor Hours (413 Error Recovery)

**Problem:** Contract (Fixed-Price) jobs were showing $0 for billable costs and 0 hours for billable labor. Two separate issues needed solving:

1. **Billable labor hours** ÃÂ¢ÃÂÃÂ The dashboard was counting ALL time entries, but contract jobs need to count only entries with `type === 'Billable'` (not `type === 'Standard'`). Standard hours are part of the contract; Billable hours need separate invoicing.

2. **Billable costs ($0)** ÃÂ¢ÃÂÃÂ The `getCostItemsForJobLite()` function returns **budget-level** cost items only. CC23 costs on vendor bills (e.g., $254.50 + $100.00 = $354.50 on the Sines project) are **document-level** cost items that don't appear in `job.costItems`. A new approach was needed to fetch document-level items.

**Failed approaches (important for future reference):**
- ÃÂ¢ÃÂÃÂ **Attempt 1** (`a661920`): Changed to "vendor bill costs minus invoice costs" using budget-level `costItems` ÃÂ¢ÃÂÃÂ still $0 because vendor bill line items aren't in `job.costItems`
- ÃÂ¢ÃÂÃÂ **Attempt 2** (`0307e88`): Created `getDocumentCostItemsForJob()` with nested query `job.documents.costItems` (50 docs ÃÂÃÂ 50 items) ÃÂ¢ÃÂÃÂ caused **413 Request Entity Too Large** errors. Since this was inside `Promise.all` with the other 3 API calls, ALL parallel calls failed, returning empty arrays. This broke the ENTIRE dashboard (all jobs showed zeros for everything).

**Final solution** (`bd452c7`):
- Removed `getDocumentCostItemsForJob` from the main batch fetch entirely (reverted to 3 parallel calls: documents, costItems, timeEntries)
- Added `getDocumentCostItemsById(documentId)` ÃÂ¢ÃÂÃÂ fetches cost items for a single document (tiny query, no 413 risk)
- Inside `analyzeContractJob()` only, identifies vendor bills and customer invoices from the already-fetched `documents` array, then fetches each document's cost items individually
- Filters for CC23 items, sums vendor bill costs minus customer invoice costs = uninvoiced billable amount
- For labor hours: filters time entries by `type === 'Billable'`, sums hours, subtracts CC23 customer invoice quantities (hours already billed)

**Key architectural lesson ÃÂ¢ÃÂÃÂ Budget-level vs Document-level cost items:**
- `job.costItems` (via `getCostItemsForJobLite`) = budget/estimate line items only
- `document.costItems` (via `getDocumentCostItemsById`) = vendor bill, invoice, PO line items
- To get actual costs incurred or billed, MUST query document-level items
- NEVER use a nested `job.documents.costItems` bulk query ÃÂ¢ÃÂÃÂ it causes 413 errors

**Verified on Sines project:** $354.50 uninvoiced billable costs (Bill #14: $254.50 + Bill #22: $100.00), 3.9 unbilled labor hours (Cole Kleindienst, 1 Billable entry of 3h 52m)

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added `getDocumentCostItemsById()` function for per-document cost item queries
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Removed `getDocumentCostItemsForJob` from imports and main batch fetch; reverted to 3 parallel calls; updated `analyzeContractJob()` to fetch CC23 document cost items internally per-document; labor hours now filter by `type === 'Billable'`

**Commits:** `1172770` ÃÂ¢ÃÂÃÂ `a661920` ÃÂ¢ÃÂÃÂ `0307e88` (broken) ÃÂ¢ÃÂÃÂ `bd452c7` (final fix)

---

### 2026-03-12 ÃÂ¢ÃÂÃÂ UI: Health-Priority Sorting, Condensed Cards, Search

**Problem:** Jobs were grouped by status category (In-Design, Ready, In-Production, Final Billing) with collapsible sub-sections, which meant critical/overdue jobs could be buried inside collapsed groups. Job cards were also too tall, requiring excessive scrolling. No search functionality existed.

**Solution:** Three UI improvements to `app/dashboard/invoicing/page.tsx`:

1. **Health-priority sorting** ÃÂ¢ÃÂÃÂ Jobs now sort by health severity (critical ÃÂ¢ÃÂÃÂ overdue ÃÂ¢ÃÂÃÂ warning ÃÂ¢ÃÂÃÂ healthy) instead of status category. Removed `groupJobsByStatus()` sub-section grouping and `SubSectionHeader` component. Added `HEALTH_PRIORITY` lookup and `sortByHealthPriority()` helper.

2. **Condensed job cards** ÃÂ¢ÃÂÃÂ Both `ContractJobCard` and `CostPlusJobCard` redesigned with:
   - Reduced padding (`p-4` ÃÂ¢ÃÂÃÂ `px-3 py-2.5`)
   - Inline stats row instead of 3-column grid
   - Thinner progress bars (`h-2` ÃÂ¢ÃÂÃÂ `h-1.5`)
   - Alert rows condensed to single-line `text-[11px]` with inline icons
   - Removed nested background boxes for stats

3. **Search box** ÃÂ¢ÃÂÃÂ Added a search input that filters all three sections (contract, cost-plus, billable items) by job name, number, or client name. Real-time filtering with clear button.

**Files changed:**
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ All three changes above
- `ARCHITECTURE.md` ÃÂ¢ÃÂÃÂ Updated changelog

---

### 2026-03-12 ÃÂ¢ÃÂÃÂ Revision: Invoicing Health Threshold Overhaul

**Problem:** The original invoicing health thresholds were too simplistic. Contract (Fixed-Price) jobs only tracked milestone due dates and draft invoices ÃÂ¢ÃÂÃÂ they had no visibility into billable items (Cost Code 23) or billable labor hours accumulating without being invoiced. Draft invoices alone were triggering Warning status, which was noise. Cost-Plus jobs flagged "no invoices ever sent" as a Warning, which wasn't useful for new jobs. Additionally, there was no early warning when a payment milestone was approaching.

**Solution:** Comprehensive threshold revision for both Contract and Cost-Plus job types.

**Contract (Fixed-Price) ÃÂ¢ÃÂÃÂ New Thresholds:**

| Condition | Status |
|-----------|--------|
| No issues across all checks | Healthy |
| Draft invoice exists with no matching `$` schedule task | Warning |
| `$` milestone task due within 2 days | Warning |
| Uninvoiced billable items (Cost Code 23) > $200 | Warning |
| Unbilled labor hours > 1 hr | Warning |
| Uninvoiced billable items (Cost Code 23) > $800 | Overdue |
| Unbilled labor hours > 3 hrs | Overdue |
| `$` milestone task 1ÃÂ¢ÃÂÃÂ14 days past due | Overdue |
| `$` milestone task 14+ days past due | Critical |

**Contract ÃÂ¢ÃÂÃÂ What Changed:**
- **Removed:** Draft invoices alone no longer trigger Warning
- **Added:** Draft invoice with no matching `$` schedule task ÃÂ¢ÃÂÃÂ Warning (name-based fuzzy matching between draft invoice name and `$` task name minus the `$` prefix)
- **Added:** `$` milestone approaching (due within 2 days) ÃÂ¢ÃÂÃÂ Warning
- **Added:** Billable items (Cost Code 23 cost items not on a document) ÃÂ¢ÃÂÃÂ Warning at $200, Overdue at $800
- **Added:** Billable labor (time entries linked to Cost Code 23 items) ÃÂ¢ÃÂÃÂ Warning at 1 hr, Overdue at 3 hrs
- **Added:** `uninvoicedBillableAmount` and `unbilledLaborHours` fields to `ContractJobHealth` interface
- **Added:** `approachingMilestones` and `unmatchedDraftInvoices` fields to `ContractJobHealth` interface

**Cost-Plus ÃÂ¢ÃÂÃÂ What Changed:**
- **Removed:** "No invoices ever sent" no longer triggers Warning (was noise for new jobs)
- All other thresholds unchanged (10d warning, 14d overdue, 28d critical, $100 unbilled)

**Implementation Details:**
- `analyzeContractJob()` now accepts `costItems` and `timeEntries` parameters (previously only had `documents`)
- Billable items use same Cost Code 23 filtering as the existing `findBillableItems()` function
- Draft-to-task matching: compares draft invoice name (case-insensitive) against `$` task names with the `$` prefix stripped, using contains matching in both directions
- New `ALERT_THRESHOLDS` constants: `contractBillableWarning: 200`, `contractBillableOverdue: 800`, `contractLaborWarning: 1`, `contractLaborOverdue: 3`, `contractMilestoneApproachingDays: 2`

**Changes:**
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Added 5 new threshold constants, 4 new fields to `ContractJobHealth` interface, rewrote `analyzeContractJob()` with new parameters and health logic (billable items, labor hours, approaching milestones, unmatched draft detection), removed "no invoices ever sent" Warning from `analyzeCostPlusJob()`
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ Updated `ContractJobHealth` interface with 4 new fields, replaced 2-column invoice stats grid with 3-column grid (Approved Inv., Billable Items, Billable Labor), added approaching milestone display with yellow Clock icon, added unmatched draft invoice display, conditional Next Milestone display (hidden if already shown as approaching)

### 2026-03-11 ÃÂ¢ÃÂÃÂ Session: Invoicing Health Dashboard + Agent

**Problem:** No centralized view of invoicing health across all open JobTread projects. Terry (office manager) and Nathan had to manually check each job for overdue milestones, unbilled cost-plus work, and pending billable items. The three invoicing profiles (Fixed-Price, Cost Plus, Billable Labor) each had different billing cadences and triggers, making it easy to miss billing windows.

**Solution:** Built a full Invoicing Health Dashboard with agent-powered analysis:
1. Core data layer (`invoicing-health.ts`) ÃÂ¢ÃÂÃÂ queries JT for all active jobs, classifies them by Price Type (Fixed-Price vs Cost-Plus), analyzes invoicing health for each profile
2. Dashboard API (`/api/dashboard/invoicing`) ÃÂ¢ÃÂÃÂ serves cached or fresh invoicing health data with Supabase caching
3. Dashboard UI (`/dashboard/invoicing/page.tsx`) ÃÂ¢ÃÂÃÂ summary cards, contract job progress, cost-plus billing cadence indicators, billable items panel with expand/collapse
4. Agent analysis endpoint (`/api/agent/invoicing`) ÃÂ¢ÃÂÃÂ runs Claude analysis on invoicing data, generates prioritized recommendations
5. Daily cron job (`/api/cron/invoicing-health`) ÃÂ¢ÃÂÃÂ runs at 1 AM EST to refresh cached data

**Key Data Points:**
- Fixed-Price jobs: milestone tracking via `$` prefix schedule tasks, draft/approved invoices
- Cost Plus jobs: 14-day billing cadence, days-since-last-invoice indicator, unbilled costs/hours
- Billable items: Cost Code 23 ("Miscellaneous/Billable Labor"), billable time entries
- Health levels: healthy ÃÂ¢ÃÂÃÂ warning ÃÂ¢ÃÂÃÂ overdue ÃÂ¢ÃÂÃÂ critical

**Changes:**
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ **NEW** Core invoicing health analysis logic
- `app/api/dashboard/invoicing/route.ts` ÃÂ¢ÃÂÃÂ **NEW** Dashboard data endpoint with Supabase caching
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ **NEW** Invoicing health dashboard UI
- `app/api/agent/invoicing/route.ts` ÃÂ¢ÃÂÃÂ **NEW** Claude-powered agent analysis endpoint
- `app/api/cron/invoicing-health/route.ts` ÃÂ¢ÃÂÃÂ **NEW** Daily 1 AM cron job
- `app/dashboard/layout.tsx` ÃÂ¢ÃÂÃÂ Added "Invoicing" nav item with DollarSign icon
- `vercel.json` ÃÂ¢ÃÂÃÂ Added invoicing-health cron schedule (0 6 * * * = 1 AM EST)
- `BUILD_PLAN_INVOICING_HEALTH.md` ÃÂ¢ÃÂÃÂ **NEW** Build plan document for session continuity
- `ARCHITECTURE.md` ÃÂ¢ÃÂÃÂ Updated changelog

### 2026-03-11 ÃÂ¢ÃÂÃÂ Fix: Use Native priceType Field for Job Classification

**Problem:** The invoicing dashboard was misclassifying most jobs as Cost-Plus when they were actually Fixed-Price. The original heuristic checked for "Billing Items Pending" cost groups and vendor bills to determine price type ÃÂ¢ÃÂÃÂ this was unreliable and got the majority of jobs wrong (only ~3 Fixed-Price vs ~47 Cost-Plus, when the real split is ~27/23).

**Root Cause:** JobTread has a native `priceType` field on the job entity (values: `"fixed"` or `"costPlus"`) that was not being queried. This field is NOT a custom field ÃÂ¢ÃÂÃÂ it's a first-class PAVE API field available on every job.

**Solution:** Replaced the ~100-line heuristic with a simple mapping of the native `priceType` field.

**Changes:**
- `app/lib/jobtread.ts` ÃÂ¢ÃÂÃÂ Added `priceType?: string | null` to `JTJob` interface, added `priceType: {}` to the PAVE query in `getActiveJobs()`, mapped `priceType` in return object
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Replaced heuristic classification block with native priceType mapping (`"fixed"` ÃÂ¢ÃÂÃÂ Fixed-Price, `"costPlus"` ÃÂ¢ÃÂÃÂ Cost-Plus), removed ~100 lines of dead heuristic code and unused `getJobPriceType()` function

**Commits:** `e30244a`

### 2026-03-11 ÃÂ¢ÃÂÃÂ Feature: Group Jobs by Status Category with Collapsible Sections

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
- `app/lib/invoicing-health.ts` ÃÂ¢ÃÂÃÂ Added `customStatus: string | null` to `ContractJobHealth`, `CostPlusJobHealth`, and `BillableItemsSummary` interfaces; populated from `job.customStatus` in all three analysis functions
- `app/dashboard/invoicing/page.tsx` ÃÂ¢ÃÂÃÂ Added `STATUS_CATEGORIES` constant, `getStatusCategory()` and `groupJobsByStatus()` helpers, `SubSectionHeader` component, sub-section expand/collapse state management; replaced flat job grids with grouped collapsible views in both Contract and Cost-Plus sections

**Commits:** `fb284b3`

### 2026-03-10 ÃÂ¢ÃÂÃÂ Session: GHL ÃÂ¢ÃÂÃÂ JobTread Meeting Sync

**Problem:** Client meetings entered in GHL (the source of truth) were not reflected in JobTread schedules. Team members looking at JT tasks wouldn't see upcoming client appointments, creating visibility gaps.

**Solution:** Built bidirectional sync infrastructure:
1. New `syncGHLMeetingsToJT()` function in GHL service layer ÃÂ¢ÃÂÃÂ pulls GHL appointments, maps contacts to active JT jobs by client name, creates JT tasks for new meetings (with duplicate detection)
2. Added Phase 3 to daily cron sync (5 AM) ÃÂ¢ÃÂÃÂ automatically syncs GHL meetings to JT each morning
3. New `sync_ghl_meetings_to_jt` agent tool ÃÂ¢ÃÂÃÂ allows on-demand sync from the Ask Agent ("sync my meetings to JobTread")
4. Synced tasks are prefixed with ÃÂ°ÃÂÃÂÃÂ and include meeting details (time, contact, notes) in the description

**Changes:**
- `app/lib/ghl.ts` ÃÂ¢ÃÂÃÂ Added `syncGHLMeetingsToJT()` with contactÃÂ¢ÃÂÃÂjob mapping, duplicate detection, and dry-run support
- `app/api/cron/sync-incremental/route.ts` ÃÂ¢ÃÂÃÂ Added Phase 3 for GHL meeting sync after existing message/note sync
- `app/api/lib/agents/know-it-all.ts` ÃÂ¢ÃÂÃÂ Added `sync_ghl_meetings_to_jt` tool definition and handler, updated system prompt with sync info, expanded canHandle() for sync queries
- `ARCHITECTURE.md` ÃÂ¢ÃÂÃÂ Updated changelog

### 2026-03-10 ÃÂ¢ÃÂÃÂ Session: Add GHL Calendar Access to Ask Agent

**Problem:** The Ask Agent only had access to JobTread schedules (construction tasks/milestones) but not GoHighLevel (GHL) calendar events. Client meetings, consultations, and site visits are entered in GHL, which is the source of truth for client-facing appointments. When users asked about "my schedule" or "upcoming meetings," the agent could only show JT tasks.

**Solution:** Added GHL calendar read tools to the Know-it-All agent:
1. New `get_ghl_calendar` tool fetches appointments from GHL within a date range
2. New `get_ghl_calendars_list` tool lists available GHL calendars
3. Updated system prompt with SCHEDULE & CALENDAR rules: GHL = client meetings (source of truth), JT = construction tasks
4. Agent now presents both sources when asked about schedules

**Changes:**
- `app/lib/ghl.ts` ÃÂ¢ÃÂÃÂ Added `getCalendars()`, `getAppointment()`, and `createAppointment()` functions to GHL service layer
- `app/api/lib/agents/know-it-all.ts` ÃÂ¢ÃÂÃÂ Added GHL calendar imports, 2 new tool definitions (`get_ghl_calendar`, `get_ghl_calendars_list`), tool execution handlers, SCHEDULE & CALENDAR section in system prompt, canHandle() boost for meeting/appointment queries
- `ARCHITECTURE.md` ÃÂ¢ÃÂÃÂ Updated changelog

### 2026-03-10 ÃÂ¢ÃÂÃÂ Session: Fix Ask Agent Verbosity + Tool Loop Exhaustion

**Problem:** The Ask Agent would ask unnecessary clarifying questions on simple read queries (e.g., "Is there a task for Terri...?" would get back "Would you like me to set up the schedule structure first, or do you want to create specific tasks...?" instead of a direct answer). The agent also hit "No response generated" errors because the tool loop limit (3 iterations) was too tight for queries requiring multiple lookups. Additionally, the `needsConfirmation` regex was too broad, catching casual suggestions like "want me to create" as formal write confirmations.

**Solution:** Three targeted fixes:
1. Added explicit RESPONSE STYLE rules to the Know-it-All system prompt: answer read queries directly, no walls of text, no offering multiple options on lookups
2. Increased tool loop iterations from 3 to 5 (the 90-second safety timer is the real guard against Vercel timeouts)
3. Tightened `needsConfirmation` regex to only match explicit "shall/should I proceed?" patterns, not casual offers ÃÂ¢ÃÂÃÂ the `@@TASK_CONFIRM@@` flow already handles structured confirmations separately

**Changes:**
- `app/api/lib/agents/know-it-all.ts` ÃÂ¢ÃÂÃÂ Added RESPONSE STYLE section to system prompt: direct answers for reads, concise 2-4 sentence lookups, no "Would you like me to..." on simple queries
- `app/api/lib/agents/router.ts` ÃÂ¢ÃÂÃÂ Increased `iterations < 3` to `iterations < 5`; tightened `needsConfirmation` regex to avoid false positives from casual suggestions

### 2026-03-07 ÃÂ¢ÃÂÃÂ Session: Merge JT Entry into Know-it-All (Unified Ask Agent)

**Problem:** The two-agent architecture (Know-it-All for reads, JT Entry for writes) caused routing confusion. When a user asked to create tasks, Know-it-All had the read tools to look up data but no write tools to execute, causing a tool-use loop that exhausted all 5 iterations and returned "No response generated." The split also meant confirmations could get lost when routing switched between agents.

**Solution:** Merged JT Entry into Know-it-All, creating a single unified agent with 39 tools (23 read + 16 write). The router now only has two agents: Know-it-All and Project Details.

**Changes:**
- `app/api/lib/agents/know-it-all.ts` ÃÂ¢ÃÂÃÂ Added all 20 write imports, 16 write tool definitions, 16 write executeTool handlers, comprehensive system prompt with task confirmation format + phase assignment rules + field mapping, updated canHandle() with write operation patterns
- `app/api/lib/agents/router.ts` ÃÂ¢ÃÂÃÂ Removed jt-entry import and registration, simplified forcedAgent routing
- `ARCHITECTURE.md` ÃÂ¢ÃÂÃÂ Updated agent table, routing docs, gotchas, project structure to reflect merge

**Commits:** `04758ec` (agent merge), next commit (architecture doc update)

### 2026-03-07 ÃÂ¢ÃÂÃÂ Session: Fix Orphan Tasks + Date/Assignee Passthrough

**Problem 1:** When user edited the phase in the confirmation card dropdown, the stale `phaseId` from the original suggestion was still sent. Claude used the old phaseId, creating the task under the wrong phase ÃÂ¢ÃÂÃÂ or as an orphan with no phase at all.

**Problem 2:** After fixing the phase issue, tasks were created in the right phase but with no assignee and no due date. Root cause: the `create_phase_task` tool definition was missing `startDate` and `endDate` parameters entirely. The system prompt also lacked explicit field mapping between JSON keys and tool params.

**Changes:**
- `app/hooks/useAskAgent.ts` ÃÂ¢ÃÂÃÂ When user changes phase in dropdown, delete stale `phaseId` and set `phaseChanged: true` so Claude is forced to look up the correct phase ID via `get_job_schedule`
- `app/api/lib/agents/jt-entry.ts` ÃÂ¢ÃÂÃÂ Added `startDate` and `endDate` to `create_phase_task` tool schema; updated execution code to pass them to `createPhaseTask()`; added explicit field mapping instructions and phase change handling steps to system prompt
- Updated ARCHITECTURE.md section 3.4 with full task confirmation flow documentation

**Commits:** `659d972` (orphan fix), `a0d86e9` (date/assignee fix)

### 2026-03-07 ÃÂ¢ÃÂÃÂ Session: Fix Task Confirmation Card

**Problem:** When JT Entry generated a `@@TASK_CONFIRM@@` block, the server extracted it but: (1) `needsConfirmation` was `false` because the remaining reply text didn't match the regex, and (2) the frontend hook ignored the `taskConfirm` JSON entirely. Result: the user saw a partial message with no card and no Approve/Cancel buttons.

**Changes:**
- Fixed `app/api/chat/route.ts` ÃÂ¢ÃÂÃÂ `needsConfirmation` now set to `true` when `taskConfirm` is parsed (`!!taskConfirm`)
- Added `TaskConfirmData` type to `app/hooks/useAskAgent.ts` + store `data.taskConfirm` in ChatMessage
- Added `TaskConfirmCard` component to `app/dashboard/ask/page.tsx` (desktop) ÃÂ¢ÃÂÃÂ renders name, phase, assignee, dates, description
- Added `TaskConfirmCard` component to `app/m/ask/page.tsx` (mobile) ÃÂ¢ÃÂÃÂ same data, mobile-optimized layout

**Commit:** `9d85940`

### 2026-03-06 ÃÂ¢ÃÂÃÂ Session: Mobile Ask Agent + Shared Hook

**Changes:**
- Created `app/hooks/useAskAgent.ts` ÃÂ¢ÃÂÃÂ shared hook for all Ask Agent logic
- Refactored `app/dashboard/ask/page.tsx` to use shared hook (6.95 KB ÃÂ¢ÃÂÃÂ 4.76 KB)
- Created `app/m/ask/page.tsx` ÃÂ¢ÃÂÃÂ mobile-friendly Ask Agent at `/m/ask`
- Created `app/m/layout.tsx` ÃÂ¢ÃÂÃÂ minimal mobile layout (no dashboard chrome)
- Created `ARCHITECTURE.md` ÃÂ¢ÃÂÃÂ this document

**Commits:** `fe2f195`, `1d04da3`

### 2026-03-06 ÃÂ¢ÃÂÃÂ Session: Spec Writer PDF Fix

**Changes:**
- Fixed `app/dashboard/spec-writer/page.tsx` ÃÂ¢ÃÂÃÂ added PDF extraction to file upload (was only reading text files, PDFs had no content)
- Updated `app/api/spec-writer/generate/route.ts` ÃÂ¢ÃÂÃÂ added Vendor Estimate / Material Specification Mode to system prompt, increased file content cap 10K ÃÂ¢ÃÂÃÂ 30K
- Updated `app/api/lib/agents/know-it-all.ts` ÃÂ¢ÃÂÃÂ added material spec writing instructions + routing boost (0.92 for spec keywords)
- Updated `app/api/lib/agents/jt-entry.ts` ÃÂ¢ÃÂÃÂ added spec writing exclusion rule (0.05 for spec keywords)

**Commits:** `ac97775`, `ba72352`

### 2026-03-06 ÃÂ¢ÃÂÃÂ Session: Earlier fixes (from prior compacted session)

**Changes (partial list from git log):**
- Task confirmation card rendering fix + 1-day default duration (`b3f250b`)
- Server-side confirmation parsing moved to `/api/chat` (`29406c0`)
- Know-it-All temporal awareness (current date/time in system prompt) (`1cabcb9`)
- Force-sync button added to Ask Agent header (`821bffa`, `7e7041a`)
- Phase categorization + editable confirmation cards (`ff21aeb`, `fcbece7`)
- Agent identity fix (Nathan not Brett) (`e9fcab0`)
- Critical bug fix ÃÂ¢ÃÂÃÂ confirmations routed to wrong agent (`3e982ac`)
- Conversation persistence + sidebar (`7cb7e89`, `e049068`)
- PDF upload to chat (`ba1e58a`)
- Email drafting with brand voice (`d64f3b0`, `d6f4bd9`, `c01b705`, `8b34c46`)
- Supabase-first contact tracking (`c6d035e`)
- Know-it-All data access limits removed (`870c971`)
- Backfill progress tracking fix (`5c3602a`)

### 2026-03-22 ÃÂ¢ÃÂÃÂ Enhancement: Gmail Cleanup Labels Instead of Archive

**Problem:** The inbox cleanup was archiving junk emails (removing INBOX label), which moved them to All Mail where they were hard to find if Nathan wanted to review what was cleaned up.

**Solution:** Changed `archiveEmails()` in `google-api.ts` to apply a **"BKB Cleanup"** label to junk emails AND remove the INBOX label. Emails are now:
- Removed from the inbox (same as before)
- Labeled under "BKB Cleanup" in Gmail's sidebar for easy review
- The label is auto-created on first use (with a dark rose color for visibility)
- No changes needed to the cleanup endpoints ÃÂ¢ÃÂÃÂ they call the same `archiveEmails()` function

**Files changed:**
- `app/lib/google-api.ts` ÃÂ¢ÃÂÃÂ Added `getCleanupLabelId()` helper (creates/caches the label), updated `archiveEmails()` to add cleanup label + remove INBOX instead of just removing INBOX

**Commits:** `0376051`

### 2026-03-22 ÃÂ¢ÃÂÃÂ Session: iMessage Sync to Dashboard

**Purpose:** Enable Nathan's Mac iMessage/SMS texts to flow into the BKB Client Hub dashboard so the AI briefing has context about recent text conversations with clients, subs, and team members.

**Architecture:**
- **Local Mac script** (`~/Applications/bkb-messages-sync/sync-messages.py`) reads `~/Library/Messages/chat.db` (read-only), extracts messages from last 48 hours, filters junk/spam, and pushes clean messages to Supabase via REST API.
- **LaunchAgent** (`com.bkb.messages-sync.plist`) runs the sync script every 5 minutes automatically in the background.
- **API endpoint** (`app/api/sync/texts/route.ts`) ÃÂ¢ÃÂÃÂ `POST /api/sync/texts` ÃÂ¢ÃÂÃÂ receives messages from the Mac sync script, authenticated via `x-sync-key` header (env var `TEXT_SYNC_SECRET`), and stores them in the `agent_cache` table under key `nathan-recent-texts`.
- **Dashboard integration** ÃÂ¢ÃÂÃÂ `app/lib/dashboard-data.ts` already reads from `agent_cache` key `nathan-recent-texts` and includes text messages in the briefing. `app/lib/dashboard-analysis.ts` includes them in the AI analysis prompt under "TEXT MESSAGES" section.

**Junk Filtering (sync script):**
- Short codes (5-6 digit numbers) automatically blocked
- Regex-based content filtering: opt-out language, 2FA codes, delivery notifications, promotions/deals, political fundraising, automated appointment reminders
- Configurable `BLOCKED_NUMBERS` set for manually blocking specific numbers
- Filters run before push ÃÂ¢ÃÂÃÂ junk never reaches the dashboard

**Data Flow:**
```
Mac Messages DB ÃÂ¢ÃÂÃÂ sync-messages.py (filter junk) ÃÂ¢ÃÂÃÂ Supabase agent_cache ÃÂ¢ÃÂÃÂ Dashboard briefing AI
```

**Data Format (agent_cache key: `nathan-recent-texts`):**
```json
{
  "messages": [
    {
      "id": "12345",
      "text": "message content",
      "is_from_me": false,
      "date": "2026-03-22T14:30:00",
      "contact_id": "+12155551234",
      "contact_display": "John Smith",
      "service": "iMessage",
      "chat_name": "",
      "has_attachment": false
    }
  ],
  "syncedAt": "2026-03-22T14:35:00",
  "count": 47
}
```

**Files Changed/Created:**
- Created `app/api/sync/texts/route.ts` ÃÂ¢ÃÂÃÂ API endpoint for receiving text messages from Mac sync script
- Created (local Mac) `sync-messages.py` ÃÂ¢ÃÂÃÂ Python script to read iMessage DB and push to dashboard
- Created (local Mac) `setup.sh` ÃÂ¢ÃÂÃÂ Installer for LaunchAgent automatic sync
- Created (local Mac) `com.bkb.messages-sync.plist` ÃÂ¢ÃÂÃÂ LaunchAgent configuration

**Prerequisites:**
- Terminal must have Full Disk Access (System Settings > Privacy & Security > Full Disk Access)
- Terminal must be restarted after granting access
- Python 3 (ships with macOS, no pip packages needed)

**Useful Commands:**
| Action | Command |
|--------|---------|
| Stop syncing | `launchctl unload ~/Library/LaunchAgents/com.bkb.messages-sync.plist` |
| Start syncing | `launchctl load ~/Library/LaunchAgents/com.bkb.messages-sync.plist` |
| Check if running | `launchctl list | grep bkb` |
| View logs | `tail -20 /tmp/bkb-messages-sync.log` |
| Run manually | `cd ~/Applications/bkb-messages-sync && python3 sync-messages.py` |

**Commits:** `45a57cc`

---

*End of document. Keep this updated after every session.*
