-- ============================================================
-- BKB Marketing — Research Briefs (Phase 4)
-- ------------------------------------------------------------
-- Stores the Content Researcher's output: weekly trend briefs,
-- seasonal idea banks, aspirational-firm watch notes.
-- ============================================================

create table if not exists public.research_briefs (
  id uuid primary key default gen_random_uuid(),

  brief_type text not null
    check (brief_type in ('weekly_trends', 'seasonal_ideas', 'aspirational_firms', 'foundation_study', 'other')),

  -- For weekly briefs: the Monday of the target week.
  -- For seasonal: the start date of the quarter/season.
  -- For aspirational/foundation: the date the brief was produced.
  brief_date date not null,

  title text,
  summary text,                        -- 1-2 sentence headline takeaway

  -- The full markdown body of the brief
  content_markdown text,

  -- Structured highlights for fast display
  highlights jsonb,                    -- [{ headline, why_it_matters, source_url }, ...]
  sources jsonb,                       -- [{ name, url, date }, ...]

  drafted_by_agent text default 'cowork-content-researcher',
  drafted_at timestamptz default now(),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_rb_type_date on public.research_briefs(brief_type, brief_date desc);
create index if not exists idx_rb_recent on public.research_briefs(drafted_at desc);

-- Soft uniqueness: at most one weekly brief per Monday + brief_type
create unique index if not exists uq_rb_type_date on public.research_briefs(brief_type, brief_date);
