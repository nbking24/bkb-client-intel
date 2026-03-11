# Invoicing Health Dashboard — Build Plan

**Status:** Approved by Nathan (March 11, 2026)
**Module:** Invoicing Health Dashboard + Agent
**Platform:** BKB Client Intelligence Hub (bkb-client-intel)

---

## Overview

A dashboard that provides a quick visual snapshot of invoicing health across all open JobTread projects. Three invoicing profiles are tracked:

1. **Contract (Fixed-Price) Jobs** — milestone-based invoicing tied to schedule tasks
2. **Cost Plus Jobs** — biweekly Friday billing cadence (every 14 days)
3. **Billable Items** — cost code 23 items and billable time entries across any job type

## Key Data Points

| Data Point | Source |
|---|---|
| Job type (Fixed-Price vs Cost-Plus) | JobTread custom field: `Price Type` |
| Billable cost code | Cost Code 23: "Miscellaneous/Billable Labor" |
| Billable time entries | Time entry `type = "Billable"` |
| Budget group for billable items | "Billing Items Pending" |
| Payment schedule tasks | Tasks with `$` prefix in name |
| Cost Plus billing cadence | Every 14 days (biweekly Friday) |
| Draft invoices | Document type `customerInvoice`, status `draft` |

## Dashboard Layout

### Summary Cards (top row)
- Total open jobs count
- Alerts count (red badge)
- Next billing actions count
- Overall health score (from agent)

### Contract Jobs Section
Table with columns: Job Name, Total Contract, Invoiced to Date, % Complete (schedule), Next Milestone, Days Until Due, Status Badge

### Cost Plus Jobs Section
Cards showing: Job Name, Last Invoice Date, Days Since Last Invoice, Unbilled Costs, Unbilled Hours, Status Badge (green/yellow/red based on 14-day cadence)

### Billable Items Panel
List of jobs with uninvoiced billable items (cost code 23) or unbilled billable hours, showing dollar amounts and time entry hours

### Agent Recommendations
AI-generated alerts and recommendations (cached daily at 1 AM)

## Alert Triggers
- Unlinked draft invoices (drafts not tied to a schedule task)
- Overdue milestones (schedule task past due date with no invoice)
- Cost Plus billing overdue (>14 days since last invoice)
- Unbilled billable items or hours

## Technical Architecture

### New Files
| File | Purpose |
|---|---|
| `app/lib/invoicing-health.ts` | Core logic — queries JT, classifies jobs, computes health |
| `app/api/dashboard/invoicing/route.ts` | Main data endpoint for the dashboard |
| `app/api/cron/invoicing-health/route.ts` | Daily 1 AM cron job |
| `app/api/agent/invoicing/route.ts` | Agent analysis endpoint |
| `app/dashboard/invoicing/page.tsx` | Dashboard UI |

### Modified Files (minimal, additive only)
| File | Change |
|---|---|
| `app/dashboard/layout.tsx` | Add "Invoicing" to NAV_ITEMS array |
| `vercel.json` | Add 1 AM cron schedule |
| `ARCHITECTURE.md` | Document new module |

### Data Flow
1. Cron fires at 1 AM → calls `/api/cron/invoicing-health`
2. Cron fetches all active jobs from JT PAVE API
3. Classifies each job by Price Type
4. For each job: fetches invoices, schedule tasks, budget items, time entries
5. Computes health metrics and alerts
6. Sends data to Claude for agent analysis
7. Caches results in Supabase `agent_cache` table
8. Dashboard UI reads from cache + can trigger manual refresh

### Build Sequence
1. **Phase 1:** Core data layer (`invoicing-health.ts`) + API endpoint
2. **Phase 2:** Dashboard UI (`page.tsx`) + sidebar nav update
3. **Phase 3:** Agent analysis + cron job
4. **Phase 4:** Polish, ARCHITECTURE.md update, push to main

## Safety
- **Additive only** — no existing code modified beyond adding nav item and cron entry
- Follows existing patterns (design-agent, agent_cache, PIN auth)
- Same dark theme (#141414 bg, #CDA274 gold accents)
