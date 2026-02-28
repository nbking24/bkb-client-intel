'use client';

import { useState, useEffect } from 'react';
import { Loader2, ChevronRight } from 'lucide-react';
import { PRECON_PHASES, STATUS_COLORS } from '@/app/lib/constants';

interface Phase {
  phaseNumber: number;
  status: 'not_started' | 'in_progress' | 'blocked' | 'complete';
  targetDate: string | null;
}

interface Project {
  id: string;
  name: string;
  number: string;
  clientName: string;
  createdAt: string;
  phases: Phase[];
}

function PhaseCell({ phase }: { phase: Phase }) {
  const cfg = STATUS_COLORS[phase.status];
  return (
    <td className="px-1 py-2 text-center">
      <div
        className="w-8 h-8 mx-auto rounded-md flex items-center justify-center text-xs font-bold cursor-pointer
          hover:ring-2 hover:ring-offset-1 transition-all"
        style={{
          background: cfg.bg,
          color: cfg.text,
        }}
        title={`${PRECON_PHASES[phase.phaseNumber - 1]?.name}: ${cfg.label}`}
      >
        {phase.phaseNumber}
      </div>
    </td>
  );
}

function ProjectRow({ project, onClick }: { project: Project; onClick: () => void }) {
  const completedCount = project.phases.filter(p => p.status === 'complete').length;
  const blockedCount = project.phases.filter(p => p.status === 'blocked').length;

  return (
    <tr
      className="hover:bg-white/[0.02] cursor-pointer transition-colors"
      style={{ borderBottom: '1px solid rgba(205,162,116,0.06)' }}
      onClick={onClick}
    >
      <td className="px-3 py-3 sticky left-0" style={{ background: '#1a1a1a' }}>
        <div className="flex items-center gap-2 min-w-[180px]">
          <div>
            <p className="text-sm font-medium truncate max-w-[160px]">{project.name}</p>
            <p className="text-xs" style={{ color: '#8a8078' }}>{project.clientName}</p>
          </div>
        </div>
      </td>
      {project.phases.map((phase) => (
        <PhaseCell key={phase.phaseNumber} phase={phase} />
      ))}
      <td className="px-3 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs" style={{ color: '#8a8078' }}>
            {completedCount}/9
            {blockedCount > 0 && (
              <span style={{ color: '#ef4444' }}> · {blockedCount} blocked</span>
            )}
          </span>
          <ChevronRight size={14} style={{ color: '#8a8078' }} />
        </div>
      </td>
    </tr>
  );
}

export default function PreConstructionGrid() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/dashboard/projects');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setProjects(data.projects || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}>
          Pre-Construction Tracker
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
          All projects × 9 phases. Click any project to drill down.
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {Object.entries(STATUS_COLORS).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ background: cfg.bg }} />
            <span className="text-xs" style={{ color: '#8a8078' }}>{cfg.label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin" style={{ color: '#C9A84C' }} />
        </div>
      ) : error ? (
        <div className="p-6 rounded-lg text-center" style={{ background: '#242424' }}>
          <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid rgba(205,162,116,0.12)' }}>
          <table className="w-full" style={{ background: '#1a1a1a' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(205,162,116,0.15)' }}>
                <th
                  className="px-3 py-3 text-left text-xs font-medium sticky left-0"
                  style={{ background: '#1a1a1a', color: '#C9A84C' }}
                >
                  Project
                </th>
                {PRECON_PHASES.map((p) => (
                  <th
                    key={p.number}
                    className="px-1 py-3 text-center text-xs font-medium"
                    style={{ color: '#8a8078' }}
                    title={p.name}
                  >
                    {p.short}
                  </th>
                ))}
                <th className="px-3 py-3 text-right text-xs font-medium" style={{ color: '#8a8078' }}>
                  Progress
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onClick={() => setSelectedProject(project)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Project Detail Slide-over */}
      {selectedProject && (
        <ProjectDetail
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Project Detail Panel
// ============================================================

function ProjectDetail({ project, onClose }: { project: Project; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-lg h-full overflow-y-auto p-6"
        style={{ background: '#1a1a1a', borderLeft: '1px solid rgba(205,162,116,0.15)' }}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#C9A84C' }}>{project.name}</h2>
            <p className="text-sm" style={{ color: '#8a8078' }}>{project.clientName} · #{project.number}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5"
            style={{ color: '#8a8078' }}
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          {project.phases.map((phase) => {
            const cfg = STATUS_COLORS[phase.status];
            const phaseInfo = PRECON_PHASES[phase.phaseNumber - 1];
            return (
              <div
                key={phase.phaseNumber}
                className="flex items-center gap-3 p-3 rounded-lg"
                style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}
              >
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: cfg.bg, color: cfg.text }}
                >
                  {phase.phaseNumber}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{phaseInfo?.name}</p>
                  <p className="text-xs" style={{ color: '#8a8078' }}>
                    {cfg.label}
                    {phase.targetDate && ` · Target: ${new Date(phase.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </p>
                </div>
                {/* Phase status toggle - will be wired to Supabase */}
                <select
                  className="text-xs rounded px-2 py-1 outline-none"
                  style={{ background: '#1a1a1a', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.12)' }}
                  value={phase.status}
                  onChange={(e) => {
                    // TODO: Update phase status in Supabase
                    console.log(`Phase ${phase.phaseNumber} -> ${e.target.value}`);
                  }}
                >
                  <option value="not_started">Not Started</option>
                  <option value="in_progress">In Progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="complete">Complete</option>
                </select>
              </div>
            );
          })}
        </div>

        {/* Blocker entry - placeholder */}
        <div className="mt-6">
          <h3 className="text-sm font-medium mb-2" style={{ color: '#C9A84C' }}>Add Blocker</h3>
          <textarea
            placeholder="Describe the blocker..."
            className="w-full p-3 rounded-lg text-sm outline-none resize-none"
            style={{ background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.12)' }}
            rows={3}
          />
          <button
            className="mt-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: '#1B3A5C', color: '#C9A84C' }}
          >
            Add Blocker
          </button>
        </div>
      </div>
    </div>
  );
}
