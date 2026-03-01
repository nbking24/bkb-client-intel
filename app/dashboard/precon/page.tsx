'use client';

import { useState, useEffect } from 'react';
import { Loader2, ChevronRight, Plus, AlertTriangle, CheckCircle2, Clock, Circle } from 'lucide-react';
import Link from 'next/link';

interface PhaseTask {
  id: string;
  name: string;
  progress: number | null;
}

interface Phase {
  id: string;
  name: string;
  isGroup: boolean;
  progress: number | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  childTasks: { nodes: PhaseTask[] };
}

interface JobSchedule {
  id: string;
  name: string;
  number: string;
  clientName: string;
  locationName: string;
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
  const completedTasks = phase.childTasks?.nodes?.filter((t) => t.progress !== null && t.progress >= 1).length || 0;
  const totalTasks = phase.childTasks?.nodes?.length || 0;

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
      {totalTasks > 0 && (
        <span
          className="text-xs px-1.5 py-0.5 rounded-full ml-auto whitespace-nowrap"
          style={{ background: `${progressColor(phase.progress)}20`, color: progressColor(phase.progress) }}
        >
          {completedTasks}/{totalTasks}
        </span>
      )}
    </div>
  );
}

function ProjectCard({ schedule }: { schedule: JobSchedule }) {
  const completedPhases = schedule.phases.filter((p) => p.progress !== null && p.progress >= 1).length;
  const inProgressPhases = schedule.phases.filter((p) => p.progress !== null && p.progress > 0 && p.progress < 1).length;
  const totalPhases = schedule.phases.length;
  const progressPct = schedule.totalProgress * 100;

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
            <p className="text-xs truncate" style={{ color: '#8a8078' }}>
              {schedule.clientName || schedule.locationName}
            </p>
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
              <span className="flex items-center gap-1">
                <CheckCircle2 size={12} style={{ color: '#22c55e' }} />
                {completedPhases} done
              </span>
              <span className="flex items-center gap-1">
                <Clock size={12} style={{ color: '#eab308' }} />
                {inProgressPhases} active
              </span>
              <span className="flex items-center gap-1">
                <Circle size={12} style={{ color: '#6b7280' }} />
                {totalPhases - completedPhases - inProgressPhases} pending
              </span>
            </>
          ) : (
            <span className="flex items-center gap-1">
              <AlertTriangle size={12} style={{ color: '#f97316' }} />
              No schedule set up
            </span>
          )}
        </div>

        {/* Phase chips */}
        {schedule.phases.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5">
            {schedule.phases.slice(0, 6).map((phase) => (
              <PhaseChip key={phase.id} phase={phase} />
            ))}
            {schedule.phases.length > 6 && (
              <div
                className="flex items-center justify-center px-3 py-2 rounded-lg text-xs"
                style={{ background: '#1a1a1a', color: '#8a8078' }}
              >
                +{schedule.phases.length - 6} more
              </div>
            )}
          </div>
        )}
      </div>
    </Link>
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

  // Sort: projects with schedules first, then by progress descending
  const sorted = [...schedules].sort((a, b) => {
    const aHas = a.phases.length > 0 ? 1 : 0;
    const bHas = b.phases.length > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return b.totalProgress - a.totalProgress;
  });

  const withSchedule = sorted.filter((s) => s.phases.length > 0);
  const withoutSchedule = sorted.filter((s) => s.phases.length === 0);

  return (
    <div className="space-y-6">
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
            Schedule-driven project tracking. Click any project to view or manage its full schedule.
          </p>
        </div>
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
        <>
          {/* Projects with schedules */}
          {withSchedule.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-3" style={{ color: '#e8e0d8' }}>
                Active Schedules ({withSchedule.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {withSchedule.map((s) => (
                  <ProjectCard key={s.id} schedule={s} />
                ))}
              </div>
            </div>
          )}

          {/* Projects without schedules */}
          {withoutSchedule.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-3" style={{ color: '#8a8078' }}>
                Needs Schedule Setup ({withoutSchedule.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {withoutSchedule.map((s) => (
                  <Link key={s.id} href={`/dashboard/precon/${s.id}`}>
                    <div
                      className="p-4 rounded-xl hover:border-[rgba(205,162,116,0.3)] transition-all"
                      style={{
                        background: '#242424',
                        border: '1px solid rgba(205,162,116,0.08)',
                      }}
                    >
                      <h3 className="text-sm font-medium truncate" style={{ color: '#e8e0d8' }}>
                        {s.name}
                      </h3>
                      <p className="text-xs truncate mt-0.5" style={{ color: '#8a8078' }}>
                        {s.clientName || s.locationName}
                      </p>
                      <div className="flex items-center gap-1.5 mt-3 text-xs" style={{ color: '#f97316' }}>
                        <Plus size={12} />
                        Set up schedule
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
