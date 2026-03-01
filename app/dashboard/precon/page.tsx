'use client';

import { useState, useEffect } from 'react';
import {
  Loader2, ChevronRight, ChevronDown, Plus, AlertTriangle, CheckCircle2, Clock, Circle, Shield,
} from 'lucide-react';
import Link from 'next/link';
import {
  STATUS_CATEGORY_ORDER,
  STATUS_CATEGORY_LABELS,
  type StatusCategoryKey,
} from '@/app/lib/constants';

interface Phase {
  id: string;
  name: string;
  isGroup: boolean;
  progress: number | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface JobSchedule {
  id: string;
  name: string;
  number: string;
  clientName: string;
  locationName: string;
  customStatus: string | null;
  statusCategory: StatusCategoryKey | null;
  phases: Phase[];
  totalProgress: number;
}

function progressColor(p: number | null): string {
  if (p === null || p === 0) return '#3f3f3f';
  if (p >= 1) return '#22c55e';
  return '#eab308';
}

function progressIcon(p: number | null) {
  if (p === null || p === 0) return <Circle size={14} style={{ color: '#6b7280' }} />;
  if (p >= 1) return <CheckCircle2 size={14} style={{ color: '#22c55e' }} />;
  return <Clock size={14} style={{ color: '#eab308' }} />;
}

function PhaseChip({ phase }: { phase: Phase }) {
  const pct = phase.progress !== null ? Math.round(phase.progress * 100) : 0;
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
      style={{
        background: '#1a1a1a',
        border: `1px solid ${progressColor(phase.progress)}40`,
      }}
    >
      {progressIcon(phase.progress)}
      <span className="truncate max-w-[160px]" style={{ color: '#e8e0d8' }}>
        {phase.name}
      </span>
      <span
        className="text-xs px-1.5 py-0.5 rounded-full ml-auto whitespace-nowrap"
        style={{ background: `${progressColor(phase.progress)}20`, color: progressColor(phase.progress) }}
      >
        {pct}%
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
      style={{ background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}
    >
      {status}
    </span>
  );
}

function ProjectCard({ schedule }: { schedule: JobSchedule }) {
  const completedPhases = schedule.phases.filter((p) => p.progress !== null && p.progress >= 1).length;
  const inProgressPhases = schedule.phases.filter((p) => p.progress !== null && p.progress > 0 && p.progress < 1).length;
  const totalPhases = schedule.phases.length;
  const progressPct = schedule.totalProgress * 100;

  // Only show phases that are NOT 100% complete
  const activePhases = schedule.phases.filter((p) => p.progress === null || p.progress < 1);

  return (
    <Link href={`/dashboard/precon/${schedule.id}`} className="block">
      <div
        className="p-4 rounded-xl hover:border-[rgba(205,162,116,0.3)] transition-all"
        style={{
          background: '#242424',
          border: '1px solid rgba(205,162,116,0.12)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold truncate" style={{ color: '#e8e0d8' }}>
              {schedule.name}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs truncate" style={{ color: '#8a8078' }}>
                {schedule.clientName || schedule.locationName}
              </p>
              <StatusBadge status={schedule.customStatus} />
            </div>
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <span className="text-xs font-medium" style={{ color: '#C9A84C' }}>
              {Math.round(progressPct)}%
            </span>
            <ChevronRight size={16} style={{ color: '#8a8078' }} />
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 rounded-full mb-3" style={{ background: '#1a1a1a' }}>
          <div
            className="h-2 rounded-full transition-all"
            style={{
              width: `${Math.max(progressPct, 2)}%`,
              background: progressPct >= 100 ? '#22c55e' : progressPct > 0 ? '#C9A84C' : '#3f3f3f',
            }}
          />
        </div>

        {/* Phase summary badges */}
        <div className="flex items-center gap-3 mb-3 text-xs" style={{ color: '#8a8078' }}>
          {totalPhases > 0 ? (
            <>
              {completedPhases > 0 && (
                <span className="flex items-center gap-1">
                  <CheckCircle2 size={12} style={{ color: '#22c55e' }} />
                  {completedPhases} done
                </span>
              )}
              {inProgressPhases > 0 && (
                <span className="flex items-center gap-1">
                  <Clock size={12} style={{ color: '#eab308' }} />
                  {inProgressPhases} active
                </span>
              )}
              {(totalPhases - completedPhases - inProgressPhases) > 0 && (
                <span className="flex items-center gap-1">
                  <Circle size={12} style={{ color: '#6b7280' }} />
                  {totalPhases - completedPhases - inProgressPhases} pending
                </span>
              )}
            </>
          ) : (
            <span className="flex items-center gap-1">
              <AlertTriangle size={12} style={{ color: '#f97316' }} />
              No schedule set up
            </span>
          )}
        </div>

        {/* Phase chips — only show non-completed phases */}
        {activePhases.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5">
            {activePhases.slice(0, 6).map((phase) => (
              <PhaseChip key={phase.id} phase={phase} />
            ))}
            {activePhases.length > 6 && (
              <div
                className="flex items-center justify-center px-3 py-2 rounded-lg text-xs"
                style={{ background: '#1a1a1a', color: '#8a8078' }}
              >
                +{activePhases.length - 6} more
              </div>
            )}
          </div>
        )}
        {activePhases.length === 0 && totalPhases > 0 && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: '#22c55e' }}>
            <CheckCircle2 size={12} />
            All {totalPhases} phases complete
          </div>
        )}
      </div>
    </Link>
  );
}

// Collapsible section for a status category
function StatusSection({
  categoryKey,
  label,
  jobs,
  defaultExpanded,
}: {
  categoryKey: string;
  label: string;
  jobs: JobSchedule[];
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (jobs.length === 0) return null;

  // Section accent color based on category
  const accentColors: Record<string, string> = {
    IN_PRODUCTION: '#22c55e',
    IN_DESIGN: '#eab308',
    READY: '#3b82f6',
    LEADS: '#8b5cf6',
    FINAL_BILLING: '#f97316',
    UNCATEGORIZED: '#6b7280',
  };
  const accent = accentColors[categoryKey] || '#8a8078';

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 py-3 px-1 hover:opacity-80 transition-opacity"
      >
        {expanded ? (
          <ChevronDown size={18} style={{ color: accent }} />
        ) : (
          <ChevronRight size={18} style={{ color: accent }} />
        )}
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
          <h2 className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>
            {label}
          </h2>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: `${accent}20`, color: accent }}
          >
            {jobs.length}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
          {jobs.map((s) => (
            <ProjectCard key={s.id} schedule={s} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PreConOverview() {
  const [schedules, setSchedules] = useState<JobSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/dashboard/schedule?overview=true');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setSchedules(data.schedules || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Group jobs by status category
  const grouped: Record<string, JobSchedule[]> = {};
  for (const cat of STATUS_CATEGORY_ORDER) {
    grouped[cat] = [];
  }
  grouped['UNCATEGORIZED'] = [];

  for (const s of schedules) {
    const cat = s.statusCategory || 'UNCATEGORIZED';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  }

  // Sort within each section by progress descending
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => b.totalProgress - a.totalProgress);
  }

  // Which sections default to expanded
  const defaultExpanded = new Set<string>(['IN_PRODUCTION', 'IN_DESIGN', 'READY']);

  // Total counts
  const totalJobs = schedules.length;
  const jobsWithSchedule = schedules.filter((s) => s.phases.length > 0).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}
          >
            Pre-Construction Tracker
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
            {totalJobs} active project{totalJobs !== 1 ? 's' : ''} — {jobsWithSchedule} with schedules
          </p>
        </div>
        <Link
          href="/dashboard/precon/audit"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium hover:opacity-90 transition-opacity shrink-0"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <Shield size={14} />
          Schedule Audit
        </Link>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs" style={{ color: '#8a8078' }}>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ background: '#22c55e' }} />
          Complete
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ background: '#eab308' }} />
          In Progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ background: '#3f3f3f' }} />
          Not Started
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin" style={{ color: '#C9A84C' }} />
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl text-center" style={{ background: '#242424' }}>
          <p className="text-sm" style={{ color: '#ef4444' }}>Error loading schedules: {error}</p>
          <p className="text-xs mt-1" style={{ color: '#8a8078' }}>Check that JOBTREAD_API_KEY is set</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Status category sections */}
          {STATUS_CATEGORY_ORDER.map((cat) => (
            <StatusSection
              key={cat}
              categoryKey={cat}
              label={STATUS_CATEGORY_LABELS[cat]}
              jobs={grouped[cat]}
              defaultExpanded={defaultExpanded.has(cat)}
            />
          ))}

          {/* Uncategorized (no Status custom field) */}
          {grouped['UNCATEGORIZED'].length > 0 && (
            <StatusSection
              categoryKey="UNCATEGORIZED"
              label={STATUS_CATEGORY_LABELS['UNCATEGORIZED']}
              jobs={grouped['UNCATEGORIZED']}
              defaultExpanded={false}
            />
          )}

          {/* Empty state */}
          {totalJobs === 0 && (
            <div className="p-8 rounded-xl text-center" style={{ background: '#242424' }}>
              <p className="text-sm" style={{ color: '#8a8078' }}>
                No active projects found. Jobs will appear here once created in JobTread.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
