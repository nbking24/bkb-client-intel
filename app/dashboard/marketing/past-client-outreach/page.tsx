// @ts-nocheck
'use client';

/**
 * Past-Client Outreach dashboard — /dashboard/marketing/past-client-outreach
 *
 * Operator view of the one-time bulk past-client text campaign:
 *   - Funnel of stage counts
 *   - Filterable table with per-row actions (skip, opt-out, mark-replied)
 *   - Reads from GET /api/marketing/past-client/list
 *   - Writes via the per-action POST endpoints
 */
import { useEffect, useState } from 'react';
import {
  Loader2, RefreshCw, MessageCircle, CheckCircle2, XCircle, Ban, AlertCircle, Phone, Mail,
} from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

interface ReviewSubmission {
  client_contact_id: string;
  star_rating: number;
  routed_to: 'google' | 'internal_followup';
  submitted_at: string;
  review_text: string | null;
}

interface Row {
  id: string;
  contact_key: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  phone_digits: string | null;
  email: string | null;
  source: string | null;
  project_names: string | null;
  city: string | null;
  stage: string;
  initial_text_body: string | null;
  initial_sent_at: string | null;
  reminder_sent_at: string | null;
  email_sent_at: string | null;
  reply_text: string | null;
  reply_received_at: string | null;
  form_completed_at: string | null;
  first_viewed_at: string | null;
  opted_out_at: string | null;
  flag_notes: string | null;
  internal_notes: string | null;
  created_at: string;
  latest_submission: ReviewSubmission | null;
}

interface Funnel {
  queued?: number;
  initial_sent?: number;
  reminder_sent?: number;
  email_sent?: number;
  replied?: number;
  completed?: number;
  opted_out?: number;
  skipped?: number;
  failed?: number;
  total?: number;
  visited_not_completed?: number;
}

const STAGE_ORDER = [
  'queued', 'initial_sent', 'reminder_sent', 'email_sent',
  'replied', 'completed', 'opted_out', 'skipped', 'failed',
];

const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  initial_sent: 'Sent',
  reminder_sent: 'Reminder sent',
  email_sent: 'Email sent',
  replied: 'Replied',
  completed: 'Reviewed',
  opted_out: 'Opted out',
  skipped: 'Skipped',
  failed: 'Failed',
};

const STAGE_COLOR: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-700',
  initial_sent: 'bg-blue-100 text-blue-800',
  reminder_sent: 'bg-indigo-100 text-indigo-800',
  email_sent: 'bg-violet-100 text-violet-800',
  replied: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-green-200 text-green-900',
  opted_out: 'bg-amber-100 text-amber-800',
  skipped: 'bg-gray-200 text-gray-700',
  failed: 'bg-red-100 text-red-800',
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysSince(s: string | null): number | null {
  if (!s) return null;
  const ms = Date.now() - new Date(s).getTime();
  return Math.floor(ms / 86400000);
}

export default function PastClientOutreachPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [funnel, setFunnel] = useState<Funnel>({});
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/marketing/past-client/list', {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      setRows(res.rows || []);
      setFunnel(res.funnel || {});
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  async function action(contactKey: string, endpoint: string, extra: any = {}) {
    const token = getToken();
    const res = await fetch(`/api/marketing/past-client/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contact_key: contactKey, ...extra }),
    });
    if (res.ok) load();
    else alert(`Action failed: ${(await res.json()).error}`);
  }

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.stage === filter);

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading past-client queue…
      </div>
    );
  }

  if (error) {
    return <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">{error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Past-Client Outreach</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            One-time personal text campaign to past clients. Initial → 7-day reminder → 14-day email.
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Funnel */}
      <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-9 gap-2">
        {STAGE_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(filter === s ? 'all' : s)}
            className={`rounded-md border p-2 text-left transition ${
              filter === s ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="text-xl font-semibold text-gray-900">{funnel[s] ?? 0}</div>
            <div className="text-xs text-gray-500 mt-0.5">{STAGE_LABEL[s]}</div>
          </button>
        ))}
      </div>

      {/* Review-completion summary — who actually left a review and what rating */}
      {(() => {
        const reviewed = rows.filter((r) => r.latest_submission);
        const fiveStar = reviewed.filter((r) => r.latest_submission?.star_rating === 5);
        const lowStar = reviewed.filter((r) => (r.latest_submission?.star_rating || 0) < 5);
        const visitedNoSubmit = rows.filter(
          (r) => r.first_viewed_at && !r.form_completed_at && r.stage !== 'opted_out',
        );
        return (
          <div className="rounded-md border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
              Review tracking
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-2xl font-semibold text-green-700">{fiveStar.length}</div>
                <div className="text-xs text-gray-600">5-star → Google</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-amber-700">{lowStar.length}</div>
                <div className="text-xs text-gray-600">1-4 star → followup</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-blue-700">{visitedNoSubmit.length}</div>
                <div className="text-xs text-gray-600">Visited, didn't submit</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-gray-700">
                  {(funnel.initial_sent ?? 0) + (funnel.reminder_sent ?? 0) + (funnel.email_sent ?? 0)}
                </div>
                <div className="text-xs text-gray-600">Sent, no response yet</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Filter row summary */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <div>
          {filter === 'all'
            ? `Showing all ${rows.length} contacts`
            : `Showing ${filtered.length} in ${STAGE_LABEL[filter]}`}
        </div>
        {filter !== 'all' && (
          <button
            onClick={() => setFilter('all')}
            className="text-gray-700 hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {filtered.map((r) => {
          const sinceInitial = daysSince(r.initial_sent_at);
          return (
            <div
              key={r.id}
              className="bg-white border border-gray-200 rounded-md p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className={`px-2 py-0.5 rounded-md text-xs font-medium ${STAGE_COLOR[r.stage]}`}
                  >
                    {STAGE_LABEL[r.stage]}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {r.full_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Unknown'}
                    </div>
                    <div className="text-gray-500 text-xs flex items-center gap-2 flex-wrap">
                      {r.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {r.phone}
                        </span>
                      )}
                      {r.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {r.email}
                        </span>
                      )}
                      {r.project_names && <span>· {r.project_names}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-500">
                  {r.initial_sent_at && (
                    <div>
                      Sent {fmtDate(r.initial_sent_at)}
                      {sinceInitial !== null && ` · ${sinceInitial}d ago`}
                    </div>
                  )}
                  {r.first_viewed_at && !r.form_completed_at && (
                    <div className="text-blue-700" title={`Visited ${fmtDate(r.first_viewed_at)}, no submission`}>
                      Visited {fmtDate(r.first_viewed_at)}
                    </div>
                  )}
                  {r.reply_received_at && (
                    <div className="text-emerald-700">
                      Replied {fmtDate(r.reply_received_at)}
                    </div>
                  )}
                  {r.latest_submission && (
                    <div
                      className={
                        r.latest_submission.star_rating === 5
                          ? 'text-green-800 font-medium'
                          : 'text-amber-700 font-medium'
                      }
                      title={`Submitted ${fmtDate(r.latest_submission.submitted_at)} · routed to ${r.latest_submission.routed_to}`}
                    >
                      {'★'.repeat(r.latest_submission.star_rating)}
                      {'☆'.repeat(5 - r.latest_submission.star_rating)}
                      {r.latest_submission.routed_to === 'google' ? ' · Google' : ' · followup'}
                    </div>
                  )}
                  {r.form_completed_at && !r.latest_submission && (
                    <div className="text-green-800">
                      Reviewed {fmtDate(r.form_completed_at)}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setExpanded({ ...expanded, [r.id]: !expanded[r.id] })}
                    className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
                  >
                    {expanded[r.id] ? 'Hide' : 'View'}
                  </button>
                  {r.stage === 'queued' && (
                    <button
                      onClick={() => {
                        const reason = window.prompt('Skip reason (optional):') ?? '';
                        action(r.contact_key, 'skip', { reason });
                      }}
                      className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 inline-flex items-center gap-1"
                    >
                      <Ban className="w-3 h-3" /> Skip
                    </button>
                  )}
                  {['queued', 'initial_sent', 'reminder_sent', 'email_sent', 'replied'].includes(r.stage) && (
                    <button
                      onClick={() => {
                        if (confirm(`Mark ${r.first_name || 'contact'} as opted out?`)) {
                          const reason = window.prompt('Opt-out reason (optional):') ?? '';
                          action(r.contact_key, 'mark-opted-out', { reason });
                        }
                      }}
                      className="text-xs text-amber-700 hover:text-amber-900 px-2 py-1 inline-flex items-center gap-1"
                    >
                      <XCircle className="w-3 h-3" /> Opt out
                    </button>
                  )}
                </div>
              </div>

              {expanded[r.id] && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 text-xs text-gray-700">
                  {r.initial_text_body && (
                    <div>
                      <div className="text-gray-500 mb-0.5">Initial text:</div>
                      <div className="bg-gray-50 rounded p-2 whitespace-pre-wrap">
                        {r.initial_text_body}
                      </div>
                    </div>
                  )}
                  {r.reply_text && (
                    <div>
                      <div className="text-gray-500 mb-0.5">Their reply:</div>
                      <div className="bg-emerald-50 rounded p-2 whitespace-pre-wrap">
                        {r.reply_text}
                      </div>
                    </div>
                  )}
                  {r.latest_submission && (
                    <div>
                      <div className="text-gray-500 mb-0.5">
                        Their review ({r.latest_submission.star_rating}★ · routed to{' '}
                        {r.latest_submission.routed_to === 'google' ? 'Google' : 'internal followup'}):
                      </div>
                      <div
                        className={
                          (r.latest_submission.star_rating === 5
                            ? 'bg-green-50 '
                            : 'bg-amber-50 ') +
                          'rounded p-2 whitespace-pre-wrap'
                        }
                      >
                        {r.latest_submission.review_text || '(no text — they only rated)'}
                      </div>
                    </div>
                  )}
                  {r.first_viewed_at && !r.form_completed_at && (
                    <div className="text-blue-700">
                      Clicked the review link on {fmtDate(r.first_viewed_at)} but did not submit.
                    </div>
                  )}
                  {r.flag_notes && (
                    <div>
                      <span className="text-gray-500">Flag notes:</span> {r.flag_notes}
                    </div>
                  )}
                  {r.internal_notes && (
                    <div>
                      <span className="text-gray-500">Internal notes:</span> {r.internal_notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-gray-500 text-sm py-10 text-center border border-dashed border-gray-200 rounded-md">
            No contacts in this stage.
          </div>
        )}
      </div>
    </div>
  );
}
