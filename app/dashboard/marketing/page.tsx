// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Star, AlertTriangle, Inbox, Activity, Loader2, ArrowRight, Mail, MessageCircle,
} from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

interface Stats {
  reviewFunnel90d: Array<{
    trigger_type: string;
    requests_sent: number;
    five_star_responses: number;
    low_star_responses: number;
    reviews_confirmed: number;
    skipped_total: number;
  }>;
  approvalQueue: { total: number; reviewResponses: number; fbDrafts: number; newsletterIssues: number };
  makeItRight: Array<any>;
  recentEvents: Array<any>;
  recentReviews: Array<any>;
}

export default function MarketingOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let active = true;
    setLoading(true);
    fetch('/api/marketing/stats', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data.error) setError(data.error);
        else setStats(data);
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading marketing overview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">
        Failed to load stats: {error}
      </div>
    );
  }

  const s = stats!;
  const totalRequests = s.reviewFunnel90d.reduce((a, r) => a + Number(r.requests_sent), 0);
  const totalConfirmed = s.reviewFunnel90d.reduce((a, r) => a + Number(r.reviews_confirmed), 0);
  const totalMIR = s.makeItRight.length;

  return (
    <div className="space-y-6">
      {/* Metrics strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          label="Approvals Waiting"
          value={s.approvalQueue.total}
          sub={`${s.approvalQueue.reviewResponses} review replies, ${s.approvalQueue.fbDrafts} FB, ${s.approvalQueue.newsletterIssues} newsletters`}
          accent="blue"
          icon={Inbox}
          href="/dashboard/marketing/reviews"
        />
        <MetricCard
          label="Review Asks (90d)"
          value={totalRequests}
          sub={`${totalConfirmed} reviews confirmed`}
          accent="green"
          icon={Star}
        />
        <MetricCard
          label="Make-It-Right Open"
          value={totalMIR}
          sub="Sub-5-star survey responses"
          accent={totalMIR > 0 ? 'amber' : 'gray'}
          icon={AlertTriangle}
        />
        <MetricCard
          label="Agent Events (50 most recent)"
          value={s.recentEvents.length}
          sub="All agents combined"
          accent="gray"
          icon={Activity}
        />
      </div>

      {/* Funnel by trigger */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Review Funnel — Last 90 Days</h2>
          <Link
            href="/dashboard/marketing/reviews"
            className="text-sm text-blue-700 hover:underline flex items-center gap-1"
          >
            See all reviews <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {s.reviewFunnel90d.length === 0 ? (
          <p className="text-sm text-gray-500">
            No review requests yet. The Review Concierge will start populating this once
            GHL workflow IDs are configured.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="pb-2 pr-3">Trigger</th>
                  <th className="pb-2 px-3 text-right">Sent</th>
                  <th className="pb-2 px-3 text-right">5-Star</th>
                  <th className="pb-2 px-3 text-right">1-4 Star</th>
                  <th className="pb-2 px-3 text-right">Confirmed</th>
                  <th className="pb-2 px-3 text-right">Skipped (dedup)</th>
                </tr>
              </thead>
              <tbody>
                {s.reviewFunnel90d.map((r) => (
                  <tr key={r.trigger_type} className="border-b border-gray-100">
                    <td className="py-2 pr-3 font-medium text-gray-900">
                      {prettyTrigger(r.trigger_type)}
                    </td>
                    <td className="py-2 px-3 text-right">{r.requests_sent}</td>
                    <td className="py-2 px-3 text-right text-green-700">
                      {r.five_star_responses}
                    </td>
                    <td className="py-2 px-3 text-right text-amber-700">
                      {r.low_star_responses}
                    </td>
                    <td className="py-2 px-3 text-right">{r.reviews_confirmed}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{r.skipped_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent agent events */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Agent Activity</h2>
        {s.recentEvents.length === 0 ? (
          <p className="text-sm text-gray-500">No agent events logged yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {s.recentEvents.slice(0, 15).map((e) => (
              <li key={e.id} className="py-2.5 flex items-center gap-3 text-sm">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                <span className="text-gray-400 text-xs w-36 shrink-0">
                  {new Date(e.occurred_at).toLocaleString()}
                </span>
                <span className="font-medium text-gray-700 w-44 shrink-0">{e.agent}</span>
                <span className="text-gray-500 flex-1">{e.event_type}</span>
                <span
                  className={
                    'text-xs px-2 py-0.5 rounded ' +
                    (e.outcome === 'success'
                      ? 'bg-green-100 text-green-700'
                      : e.outcome === 'skipped'
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-red-100 text-red-700')
                  }
                >
                  {e.outcome || 'n/a'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Phase 2/3 placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PlaceholderCard
          icon={Mail}
          title="Newsletter Engine"
          phase="Phase 2"
          body="Monthly three-segment newsletter with agent-drafted content. Scaffolded, not yet wired."
          href="/dashboard/marketing/newsletter"
        />
        <PlaceholderCard
          icon={MessageCircle}
          title="Facebook Scout"
          phase="Phase 3"
          body="Local FB group monitoring with draft-mode replies. Scaffolded, not yet wired."
          href="/dashboard/marketing/facebook"
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  accent,
  icon: Icon,
  href,
}: {
  label: string;
  value: number | string;
  sub: string;
  accent: 'blue' | 'green' | 'amber' | 'gray';
  icon: any;
  href?: string;
}) {
  const accentClasses = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    gray: 'bg-gray-100 text-gray-700',
  }[accent];

  const content = (
    <div className="bg-white border border-gray-200 rounded-lg p-4 h-full hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <span className={'w-8 h-8 rounded-md flex items-center justify-center ' + accentClasses}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
      <div className="text-2xl font-bold text-gray-900 mb-1">{value}</div>
      <div className="text-xs text-gray-500">{sub}</div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function PlaceholderCard({ icon: Icon, title, phase, body, href }: any) {
  return (
    <Link
      href={href}
      className="bg-white border border-dashed border-gray-300 rounded-lg p-5 hover:border-gray-400 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-gray-400" />
          <h3 className="font-semibold text-gray-800">{title}</h3>
        </div>
        <span className="text-xs uppercase tracking-wide text-gray-400">{phase}</span>
      </div>
      <p className="text-sm text-gray-500">{body}</p>
    </Link>
  );
}

function prettyTrigger(t: string) {
  switch (t) {
    case 'completion':
      return 'Project Completion';
    case 'nurture':
      return 'Nurture Entry';
    case 'post_design':
      return 'Post-Design Phase';
    case 'annual':
      return 'Annual Check-in';
    default:
      return t;
  }
}
