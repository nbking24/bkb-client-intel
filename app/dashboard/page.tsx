'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';
import { URGENCY_COLORS, JT_MEMBERS } from '@/app/lib/constants';
import Link from 'next/link';

interface Task {
  id: string;
  name: string;
  description: string;
  endDate: string | null;
  progress: number;
  urgency: 'urgent' | 'high' | 'normal';
  job: { id: string; name: string };
}

function formatDate(d: string | null) {
  if (!d) return '—';
  const date = new Date(d);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (days < 0) return `${formatted} (${Math.abs(days)}d overdue)`;
  if (days === 0) return `${formatted} (today)`;
  if (days === 1) return `${formatted} (tomorrow)`;
  if (days <= 5) return `${formatted} (${days}d)`;
  return formatted;
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const cfg = URGENCY_COLORS[urgency as keyof typeof URGENCY_COLORS] || URGENCY_COLORS.normal;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: `${cfg.bg}20`, color: cfg.dot }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
      {urgency === 'urgent' ? 'Urgent' : urgency === 'high' ? 'High' : 'Normal'}
    </span>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg"
      style={{
        background: '#242424',
        border: `1px solid ${task.urgency === 'urgent' ? 'rgba(239,68,68,0.3)' : task.urgency === 'high' ? 'rgba(249,115,22,0.3)' : 'rgba(205,162,116,0.08)'}`,
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <UrgencyBadge urgency={task.urgency} />
          <span className="text-xs truncate" style={{ color: '#8a8078' }}>
            {task.job?.name || 'Unknown Job'}
          </span>
        </div>
        <p className="text-sm font-medium truncate">{task.name}</p>
        <p className="text-xs mt-1" style={{ color: '#8a8078' }}>
          Due: {formatDate(task.endDate)}
        </p>
      </div>
    </div>
  );
}

export default function DashboardOverview() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // TODO: Get current user's membershipId from auth context
  // For now, default to Nathan
  const membershipId = JT_MEMBERS.nathan;

  useEffect(() => {
    async function loadTasks() {
      try {
        const res = await fetch(`/api/dashboard/tasks?membershipId=${membershipId}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setTasks(data.tasks || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadTasks();
  }, [membershipId]);

  const urgentCount = tasks.filter(t => t.urgency === 'urgent').length;
  const highCount = tasks.filter(t => t.urgency === 'high').length;
  const totalCount = tasks.length;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}>
          Good morning, Nathan
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
          Here&apos;s what needs your attention today.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={<AlertTriangle size={18} />}
          label="Urgent"
          value={urgentCount}
          color="#ef4444"
        />
        <SummaryCard
          icon={<Clock size={18} />}
          label="High Priority"
          value={highCount}
          color="#f97316"
        />
        <SummaryCard
          icon={<CheckCircle2 size={18} />}
          label="Open Tasks"
          value={totalCount}
          color="#C9A84C"
        />
        <Link href="/dashboard/precon" className="block">
          <div
            className="p-4 rounded-lg hover:bg-white/5 transition-colors"
            style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: '#8a8078' }}>Pre-Construction</span>
              <ArrowRight size={14} style={{ color: '#C9A84C' }} />
            </div>
            <p className="text-lg font-bold mt-1" style={{ color: '#1B3A5C' }}>Grid View</p>
          </div>
        </Link>
      </div>

      {/* Action Items - Task List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold" style={{ color: '#e8e0d8' }}>Action Items</h2>
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: '#242424', color: '#8a8078' }}>
            {totalCount} tasks
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" style={{ color: '#C9A84C' }} />
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg text-center" style={{ background: '#242424' }}>
            <p className="text-sm" style={{ color: '#ef4444' }}>Error loading tasks: {error}</p>
            <p className="text-xs mt-1" style={{ color: '#8a8078' }}>
              Check that JOBTREAD_API_KEY is set in .env.local
            </p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-6 rounded-lg text-center" style={{ background: '#242424' }}>
            <CheckCircle2 size={32} className="mx-auto mb-2" style={{ color: '#22c55e' }} />
            <p className="text-sm">You&apos;re all caught up!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.slice(0, 15).map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
            {tasks.length > 15 && (
              <p className="text-xs text-center py-2" style={{ color: '#8a8078' }}>
                + {tasks.length - 15} more tasks
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number; color: string;
}) {
  return (
    <div
      className="p-4 rounded-lg"
      style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color }}>{icon}</span>
        <span className="text-xs" style={{ color: '#8a8078' }}>{label}</span>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}
