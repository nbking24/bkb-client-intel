'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Loader2, ChevronRight, ChevronDown, AlertTriangle, CheckCircle2, Shield,
} from 'lucide-react';
import {
  STATUS_CATEGORY_ORDER,
  STATUS_CATEGORY_LABELS,
  STATUS_ACTIVE_PHASES,
  STANDARD_PHASES,
  type StatusCategoryKey,
} from '@/app/lib/constants';

// ============================================================
// Types — matches GridJobData from jobtread.ts
// ============================================================

interface GridPhaseData {
  phaseGroupId: string | null;
  phaseName: string;
  completed: number;
  total: number;
  inProgress: number;
  hasOverdue: boolean;
}

interface GridJobData {
  id: string;
  name: string;
  number: string;
  clientName: string;
  locationName: string;
  customStatus: string | null;
  statusCategory: string | null;
  phases: GridPhaseData[];
  hasSchedule: boolean;
  totalCompleted: number;
  totalTasks: number;
  nextDueDate: string | null;
  stalledDays: number | null;
}

// ============================================================
// Helpers
// ============================================================

// Extract leading number from a phase name like "1. Admin Tasks" → 1
function extractPhaseNumber(phaseName: string): number | null {
  const match = phaseName.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Get the short display name for a phase number
function phaseShortName(phaseNum: number): string {
  const phase = STANDARD_PHASES.find(p => p.number === phaseNum);
  return phase?.short || `P${phaseNum}`;
}

// Find the GridPhaseData matching a standard phase number
function getPhaseForColumn(phases: GridPhaseData[], phaseNum: number): GridPhaseData | null {
  return phases.find(p => extractPhaseNumber(p.phaseName) === phaseNum) || null;
}

// Cell color logic
function cellColor(completed: number, total: number, inProgress: number, hasOverdue: boolean): string {
  if (hasOverdue) return '#ef4444';
  if (total === 0) return '#6b7280';
  if (completed === total) return '#22c55e';
  if (inProgress > 0 || completed > 0) return '#C9A84C';
  return '#6b7280';
}

// Section accent colors
const SECTION_COLORS: Record<string, string> = {
  IN_PRODUCTION: '#22c55e',
  IN_DESIGN: '#eab308',
  READY: '#3b82f6',
  LEADS: '#8b5cf6',
  FINAL_BILLING: '#f97316',
  UNCATEGORIZED: '#6b7280',
};

// ============================================================
// Grid Cell Component
// ============================================================

function GridCell({ phase }: { phase: GridPhaseData | null }) {
  if (!phase || phase.total === 0) {
    return (
      <td className="px-2 py-2.5 text-center text-sm" style={{ color: '#4a4540' }}>
        —
      </td>
    );
  }
  const color = cellColor(phase.completed, phase.total, phase.inProgress, phase.hasOverdue);
  return (
    <td className="px-2 py-2.5 text-center">
      <div className="flex items-center justify-center gap-1">
        {phase.hasOverdue && (
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#ef4444' }} />
        )}
        <span className="text-sm font-semibold" style={{ color }}>
          {phase.completed}/{phase.total}
        </span>
      </div>
    </td>
  );
}

// ============================================================
// Status Section with Grid Table
// ============================================================

function StatusSection({
  categoryKey,
  label,
  jobs,
  defaultExpanded,
}: {
  categoryKey: string;
  label: string;
  jobs: GridJobData[];
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const accent = SECTION_COLORS[categoryKey] || '#8a8078';
  const activePhaseNums = STATUS_ACTIVE_PHASES[categoryKey as StatusCategoryKey] || [1, 2, 3, 4, 5, 6, 7, 8, 9];

  if (jobs.length === 0) return null;

  return (
    <div className="mb-1">
      {/* Section header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 py-3 px-4 hover:bg-[#1c1c1c] transition-colors rounded-t-lg"
        style={{ borderLeft: `3px solid ${accent}` }}
      >
        {expanded ? (
          <ChevronDown size={16} style={{ color: accent }} />
        ) : (
          <ChevronRight size={16} style={{ color: accent }} />
        )}
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: accent }} />
        <span className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>{label}</span>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: `${accent}20`, color: accent }}
        >
          {jobs.length}
        </span>
      </button>

      {/* Grid table */}
      {expanded && (
        <div className="overflow-x-auto rounded-b-lg" style={{ background: '#1a1a1a' }}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(205,162,116,0.12)' }}>
                <th
                  className="sticky left-0 z-10 px-4 py-2.5 text-left text-xs font-semibold whitespace-nowrap"
                  style={{ color: '#8a8078', background: '#1a1a1a', minWidth: '220px' }}
                >
                  Project
                </th>
                {activePhaseNums.map((num) => (
                  <th
                    key={num}
                    className="px-2 py-2.5 text-center text-xs font-semibold whitespace-nowrap"
                    style={{ color: '#8a8078', minWidth: '70px' }}
                  >
                    {phaseShortName(num)}
                  </th>
                ))}
                <th
                  className="px-3 py-2.5 text-center text-xs font-semibold whitespace-nowrap"
                  style={{ color: '#8a8078', borderLeft: '1px solid rgba(205,162,116,0.12)' }}
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="hover:bg-[#222222] transition-colors"
                  style={{ borderBottom: '1px solid rgba(205,162,116,0.06)' }}
                >
                  {/* Project name — sticky left column */}
                  <td
                    className="sticky left-0 z-10 px-4 py-2.5"
                    style={{ background: 'inherit', minWidth: '220px' }}
                  >
                    <Link href={`/dashboard/precon/${job.id}`} className="block group">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div
                            className="font-medium truncate group-hover:text-[#C9A84C] transition-colors"
                            style={{ color: '#e8e0d8' }}
                          >
                            {job.name}
                          </div>
                          <div className="text-xs truncate" style={{ color: '#6b6360' }}>
                            {job.clientName || job.locationName}
                          </div>
                        </div>
                        {/* Stall indicator */}
                        {job.stalledDays !== null && job.stalledDays > 3 && (
                          <div className="flex-shrink-0" title={`Stalled ${job.stalledDays === 999 ? '(no dates)' : `${job.stalledDays}d`}`}>
                            <AlertTriangle size={14} style={{ color: '#f97316' }} />
                          </div>
                        )}
                      </div>
                    </Link>
                  </td>

                  {/* Phase columns */}
                  {!job.hasSchedule ? (
                    <td
                      colSpan={activePhaseNums.length}
                      className="px-4 py-2.5 text-center"
                    >
                      <div className="flex items-center justify-center gap-1.5 text-xs" style={{ color: '#f97316' }}>
                        <AlertTriangle size={12} />
                        <span>No schedule</span>
                      </div>
                    </td>
                  ) : (
                    activePhaseNums.map((num) => (
                      <GridCell key={`${job.id}-${num}`} phase={getPhaseForColumn(job.phases, num)} />
                    ))
                  )}

                  {/* Summary column */}
                  <td
                    className="px-3 py-2.5 text-center font-semibold text-sm"
                    style={{ borderLeft: '1px solid rgba(205,162,116,0.12)' }}
                  >
                    {!job.hasSchedule ? (
                      <span style={{ color: '#6b7280' }}>—</span>
                    ) : (
                      <span style={{ color: cellColor(job.totalCompleted, job.totalTasks, 0, false) }}>
                        {job.totalCompleted}/{job.totalTasks}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Page Component
// ============================================================

export default function PreConGridView() {
  const [data, setData] = useState<GridJobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/dashboard/schedule?grid=true');
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setData(json.data || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Group by status category
  const grouped = useMemo(() => {
    const groups: Record<string, GridJobData[]> = {};
    for (const cat of STATUS_CATEGORY_ORDER) groups[cat] = [];
    groups['UNCATEGORIZED'] = [];

    for (const job of data) {
      const cat = job.statusCategory || 'UNCATEGORIZED';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(job);
    }
    return groups;
  }, [data]);

  // Stats
  const totalProjects = data.length;
  const withSchedule = data.filter(j => j.hasSchedule).length;
  const stalledCount = data.filter(j => j.stalledDays !== null && j.stalledDays > 3).length;
  const defaultExpanded = new Set(['IN_PRODUCTION', 'IN_DESIGN', 'READY']);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}
          >
            Pre-Construction Tracker
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
            {totalProjects} project{totalProjects !== 1 ? 's' : ''} · {withSchedule} with schedules
            {stalledCount > 0 && (
              <span style={{ color: '#f97316' }}> · {stalledCount} stalled</span>
            )}
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
      <div className="flex flex-wrap items-center gap-4 text-xs" style={{ color: '#8a8078' }}>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: '#22c55e' }} />
          Complete
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: '#C9A84C' }} />
          In Progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: '#4a4540' }} />
          Not Started
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: '#ef4444' }} />
          Overdue
        </span>
        <span className="flex items-center gap-1.5">
          <AlertTriangle size={12} style={{ color: '#f97316' }} />
          Stalled
        </span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin" style={{ color: '#C9A84C' }} />
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl text-center" style={{ background: '#242424' }}>
          <p className="text-sm" style={{ color: '#ef4444' }}>Error loading grid: {error}</p>
          <p className="text-xs mt-1" style={{ color: '#8a8078' }}>Check that JOBTREAD_API_KEY is set</p>
        </div>
      ) : (
        <div className="space-y-2">
          {STATUS_CATEGORY_ORDER.map((cat) => (
            <StatusSection
              key={cat}
              categoryKey={cat}
              label={STATUS_CATEGORY_LABELS[cat]}
              jobs={grouped[cat]}
              defaultExpanded={defaultExpanded.has(cat)}
            />
          ))}

          {/* Uncategorized */}
          {(grouped['UNCATEGORIZED']?.length || 0) > 0 && (
            <StatusSection
              categoryKey="UNCATEGORIZED"
              label={STATUS_CATEGORY_LABELS['UNCATEGORIZED']}
              jobs={grouped['UNCATEGORIZED']}
              defaultExpanded={false}
            />
          )}

          {/* Empty state */}
          {totalProjects === 0 && (
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
