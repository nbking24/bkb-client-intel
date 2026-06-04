// @ts-nocheck
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Star, AlertTriangle, Check, X, Edit3, ExternalLink, RefreshCw,
  ChevronDown, ChevronRight, Send, MessageSquare, Search,
} from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

interface ReviewRequest {
  id: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  jobtread_job_id: string | null;
  trigger_type: string;
  trigger_source: string | null;
  status: string;
  star_rating: number | null;
  follow_up_action: string | null;
  review_left_status: string | null;
  review_platform: string | null;
  review_url: string | null;
  skipped_reason: string | null;
  created_at: string;
  sent_at: string | null;
}

interface DraftedReply {
  id: string;
  platform: string;
  reviewer_name: string | null;
  review_stars: number | null;
  review_text: string | null;
  review_url: string | null;
  drafted_reply: string;
  draft_rationale: string | null;
  approval_status: string;
  drafted_at: string;
}

interface GatewaySubmission {
  id: string;
  clientContactId: string;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  jobtreadJobId: string | null;
  jobtreadCustomerId: string | null;
  projectNames: string | null;
  starRating: number;
  reviewText: string | null;
  routedTo: 'google' | 'internal_followup';
  googleVerified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  internalNote: string | null;
  submittedAt: string;
  sourceReviewRequestId: string | null;
}

interface GatewayCounts {
  total: number;
  routedToGoogle: number;
  internalFollowup: number;
  googleVerified: number;
}

export default function ReviewsPage() {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [drafts, setDrafts] = useState<DraftedReply[]>([]);
  const [submissions, setSubmissions] = useState<GatewaySubmission[]>([]);
  const [counts, setCounts] = useState<GatewayCounts>({ total: 0, routedToGoogle: 0, internalFollowup: 0, googleVerified: 0 });
  const [filter, setFilter] = useState<string>('all');
  const [subFilter, setSubFilter] = useState<'all' | 'google' | 'low_star' | 'unverified'>('all');
  const [subSearch, setSubSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [rrRes, drRes, gsRes] = await Promise.all([
        fetch('/api/marketing/review-requests', {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json()),
        fetch('/api/marketing/review-responses?status=pending', {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json()),
        fetch('/api/marketing/gateway-submissions', {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json()),
      ]);
      if (rrRes.error) throw new Error(rrRes.error);
      if (drRes.error) throw new Error(drRes.error);
      if (gsRes.error) throw new Error(gsRes.error);
      setRequests(rrRes.requests || []);
      setDrafts(drRes.responses || []);
      setSubmissions(gsRes.submissions || []);
      setCounts(gsRes.counts || { total: 0, routedToGoogle: 0, internalFollowup: 0, googleVerified: 0 });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const patchSubmission = async (id: string, patch: { googleVerified?: boolean; internalNote?: string }) => {
    const token = getToken();
    // Optimistic update so the checkbox flips immediately.
    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              ...(typeof patch.googleVerified === 'boolean' ? { googleVerified: patch.googleVerified } : {}),
              ...(typeof patch.internalNote === 'string' ? { internalNote: patch.internalNote } : {}),
            }
          : s,
      ),
    );
    if (typeof patch.googleVerified === 'boolean') {
      // Keep the counts header in sync without a full reload.
      setCounts((c) => ({
        ...c,
        googleVerified: c.googleVerified + (patch.googleVerified ? 1 : -1),
      }));
    }
    const res = await fetch('/api/marketing/gateway-submissions', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
    if (!res.ok) {
      // Roll back on failure.
      await load();
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = requests.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'in_flight') return ['queued', 'sent', 'responded'].includes(r.status);
    if (filter === 'make_it_right')
      return r.star_rating !== null && r.star_rating < 5 && r.star_rating > 0;
    if (filter === 'completed') return r.status === 'completed';
    if (filter === 'skipped') return r.status === 'skipped';
    return true;
  });

  const filteredSubmissions = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return submissions.filter((s) => {
      if (subFilter === 'google' && s.routedTo !== 'google') return false;
      if (subFilter === 'low_star' && s.routedTo !== 'internal_followup') return false;
      if (subFilter === 'unverified' && (s.googleVerified || s.routedTo !== 'google')) return false;
      if (q) {
        const hay = [s.clientName, s.projectNames, s.reviewText, s.clientEmail].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [submissions, subFilter, subSearch]);

  const handleAction = async (id: string, action: 'approve' | 'edit' | 'skip', editedText?: string) => {
    const token = getToken();
    const res = await fetch('/api/marketing/review-responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, action, editedText }),
    });
    if (res.ok) load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading reviews...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">{error}</div>
    );
  }

  const makeItRight = requests.filter(
    (r) => r.star_rating !== null && r.star_rating > 0 && r.star_rating < 5
  );

  return (
    <div className="space-y-6">
      {/* Gateway submissions — every review the past-client text campaign collected */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Reviews from your review link
              <span className="ml-2 text-sm font-normal text-gray-500">({counts.total})</span>
            </h2>
            <div className="text-xs text-gray-500 mt-0.5">
              Every submission from r.brettkingbuilder.com/r/&hellip; (the link sent in your past-client texts).
              {' '}<span className="text-emerald-700 font-medium">{counts.routedToGoogle}</span> were 5-star and sent on to Google.
              {' '}<span className="text-amber-700 font-medium">{counts.internalFollowup}</span> were lower-star (kept private).
              {' '}<span className="text-blue-700 font-medium">{counts.googleVerified}</span> confirmed on Google so far.
            </div>
          </div>
          <button
            onClick={load}
            className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {[
            { val: 'all', lbl: `All (${counts.total})` },
            { val: 'google', lbl: `Sent to Google (${counts.routedToGoogle})` },
            { val: 'unverified', lbl: `Not yet verified on Google (${Math.max(0, counts.routedToGoogle - counts.googleVerified)})` },
            { val: 'low_star', lbl: `Low star, kept private (${counts.internalFollowup})` },
          ].map((f) => (
            <button
              key={f.val}
              onClick={() => setSubFilter(f.val as any)}
              className={
                'px-3 py-1.5 text-sm rounded border ' +
                (subFilter === f.val
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400')
              }
            >
              {f.lbl}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
              placeholder="Search name, project, text..."
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded w-64 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        {filteredSubmissions.length === 0 ? (
          <EmptyState
            text={counts.total === 0
              ? 'No reviews have been submitted via the link yet.'
              : 'No reviews match this filter.'}
          />
        ) : (
          <div className="space-y-3">
            {filteredSubmissions.map((s) => (
              <GatewaySubmissionCard key={s.id} sub={s} onPatch={patchSubmission} />
            ))}
          </div>
        )}
      </section>

      {/* Awaiting Response approval */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Review Replies Awaiting Approval
            <span className="ml-2 text-sm font-normal text-gray-500">({drafts.length})</span>
          </h2>
          <button
            onClick={load}
            className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {drafts.length === 0 ? (
          <EmptyState
            text="No drafted review replies waiting. The Review Response Agent posts them here as reviews come in."
          />
        ) : (
          <div className="space-y-3">
            {drafts.map((d) => (
              <ReviewReplyCard key={d.id} draft={d} onAction={handleAction} />
            ))}
          </div>
        )}
      </section>

      {/* Make-it-right queue */}
      {makeItRight.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            Make-It-Right Queue
            <span className="text-sm font-normal text-gray-500">({makeItRight.length})</span>
          </h2>
          <div className="space-y-2">
            {makeItRight.map((r) => (
              <div
                key={r.id}
                className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">
                      {r.client_name || 'Unknown Client'}
                      <span className="ml-2 text-amber-700">
                        {'★'.repeat(r.star_rating!)}
                        {'☆'.repeat(5 - r.star_rating!)}
                      </span>
                    </div>
                    <div className="text-gray-600 text-xs mt-0.5">
                      {r.client_email} · Job {r.jobtread_job_id || '—'} ·{' '}
                      {prettyTrigger(r.trigger_type)}
                    </div>
                  </div>
                  <button className="text-sm px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded">
                    Mark Addressed
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Request pipeline */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Review Request Pipeline</h2>
          <div className="flex gap-1">
            {[
              { val: 'all', lbl: 'All' },
              { val: 'in_flight', lbl: 'In Flight' },
              { val: 'completed', lbl: 'Completed' },
              { val: 'make_it_right', lbl: 'Make-It-Right' },
              { val: 'skipped', lbl: 'Skipped' },
            ].map((f) => (
              <button
                key={f.val}
                onClick={() => setFilter(f.val)}
                className={
                  'px-3 py-1.5 text-sm rounded border ' +
                  (filter === f.val
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400')
                }
              >
                {f.lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {filtered.length === 0 ? (
            <EmptyState text="No review requests match this filter." />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-4 py-2.5 font-medium">Trigger</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Stars</th>
                  <th className="px-4 py-2.5 font-medium">Left Review</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">
                        {r.client_name || '—'}
                      </div>
                      <div className="text-xs text-gray-500">{r.client_email || ''}</div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {prettyTrigger(r.trigger_type)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.status} skipReason={r.skipped_reason} />
                    </td>
                    <td className="px-4 py-2.5">
                      {r.star_rating ? (
                        <span className="text-amber-600">
                          {'★'.repeat(r.star_rating)}
                          {'☆'.repeat(5 - r.star_rating)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.review_left_status === 'confirmed' && r.review_url ? (
                        <a
                          href={r.review_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 hover:underline flex items-center gap-1"
                        >
                          {r.review_platform} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------

function ReviewReplyCard({
  draft,
  onAction,
}: {
  draft: DraftedReply;
  onAction: (id: string, action: 'approve' | 'edit' | 'skip', editedText?: string) => void;
}) {
  const [showRationale, setShowRationale] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState(draft.drafted_reply);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 capitalize">{draft.platform}</span>
            {draft.review_stars !== null && (
              <span className="text-amber-600 text-sm">
                {'★'.repeat(draft.review_stars)}
                {'☆'.repeat(5 - draft.review_stars)}
              </span>
            )}
            <span className="text-gray-400 text-sm">by {draft.reviewer_name || 'Anonymous'}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            Drafted {new Date(draft.drafted_at).toLocaleString()}
          </div>
        </div>
        {draft.review_url && (
          <a
            href={draft.review_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-700 hover:underline flex items-center gap-1"
          >
            Source <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {draft.review_text && (
        <div className="bg-gray-50 border-l-4 border-gray-300 p-3 text-sm text-gray-700 mb-3 italic">
          "{draft.review_text}"
        </div>
      )}

      <div className="text-xs font-medium text-gray-500 mb-1">Drafted reply</div>
      {editing ? (
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          className="w-full border border-gray-300 rounded-md p-2 text-sm font-sans min-h-[100px]"
        />
      ) : (
        <div className="bg-blue-50 border border-blue-100 rounded-md p-3 text-sm text-gray-800 whitespace-pre-wrap">
          {draft.drafted_reply}
        </div>
      )}

      {draft.draft_rationale && (
        <button
          onClick={() => setShowRationale((s) => !s)}
          className="mt-2 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          {showRationale ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Agent rationale
        </button>
      )}
      {showRationale && draft.draft_rationale && (
        <div className="text-xs text-gray-500 mt-1 ml-4 italic">{draft.draft_rationale}</div>
      )}

      <div className="flex gap-2 mt-4">
        {editing ? (
          <>
            <button
              onClick={() => onAction(draft.id, 'approve', editedText)}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> Save & Approve
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onAction(draft.id, 'approve')}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> Approve
            </button>
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded flex items-center gap-1.5"
            >
              <Edit3 className="w-4 h-4" /> Edit
            </button>
            <button
              onClick={() => onAction(draft.id, 'skip')}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded flex items-center gap-1.5"
            >
              <X className="w-4 h-4" /> Skip
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, skipReason }: { status: string; skipReason: string | null }) {
  const styles: Record<string, string> = {
    queued: 'bg-gray-100 text-gray-700',
    sent: 'bg-blue-100 text-blue-700',
    responded: 'bg-purple-100 text-purple-700',
    completed: 'bg-green-100 text-green-700',
    skipped: 'bg-gray-100 text-gray-500',
    failed: 'bg-red-100 text-red-700',
  };
  const cls = styles[status] || 'bg-gray-100 text-gray-700';
  return (
    <span className={'inline-block px-2 py-0.5 rounded text-xs font-medium ' + cls}>
      {status}
      {status === 'skipped' && skipReason ? ` · ${skipReason}` : ''}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-10 text-center text-sm text-gray-500">{text}</div>
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

// ----------------------------------------------------------------

function GatewaySubmissionCard({
  sub,
  onPatch,
}: {
  sub: GatewaySubmission;
  onPatch: (id: string, patch: { googleVerified?: boolean; internalNote?: string }) => void;
}) {
  const [showFullText, setShowFullText] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(sub.internalNote || '');

  const stars = sub.starRating || 0;
  const isLowStar = sub.routedTo === 'internal_followup';
  const text = sub.reviewText || '';
  const isLong = text.length > 280;
  const shown = !showFullText && isLong ? text.slice(0, 280) + '...' : text;

  return (
    <div
      className={
        'border rounded-lg p-4 ' +
        (isLowStar ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200')
      }
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{sub.clientName || 'Unknown client'}</span>
            <span className="text-amber-600 text-sm">
              {'★'.repeat(stars)}
              {'☆'.repeat(5 - stars)}
            </span>
            {sub.routedTo === 'google' ? (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">
                Sent to Google
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-medium">
                <AlertTriangle className="w-3 h-3" /> Internal follow-up
              </span>
            )}
            {sub.googleVerified && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">
                <Check className="w-3 h-3" /> Verified on Google
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {sub.projectNames || 'No project recorded'}
            {sub.clientEmail ? ` · ${sub.clientEmail}` : ''}
            {' · '}Submitted {new Date(sub.submittedAt).toLocaleDateString()}
          </div>
        </div>
        {sub.routedTo === 'google' && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={sub.googleVerified}
              onChange={(e) => onPatch(sub.id, { googleVerified: e.target.checked })}
              className="w-4 h-4"
            />
            Posted on Google
          </label>
        )}
      </div>

      {text ? (
        <div className="bg-gray-50 border-l-4 border-gray-300 p-3 text-sm text-gray-800 whitespace-pre-wrap">
          {shown}
          {isLong && (
            <button
              onClick={() => setShowFullText((v) => !v)}
              className="ml-2 text-blue-700 hover:underline text-xs font-medium"
            >
              {showFullText ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      ) : (
        <div className="text-sm text-gray-400 italic">No written review (stars only).</div>
      )}

      {(isLowStar || sub.internalNote || editingNote) && (
        <div className="mt-3">
          {editingNote ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Internal note (visible to your team only)"
                className="w-full border border-gray-300 rounded-md p-2 text-sm min-h-[60px]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onPatch(sub.id, { internalNote: noteDraft });
                    setEditingNote(false);
                  }}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
                >
                  Save note
                </button>
                <button
                  onClick={() => {
                    setNoteDraft(sub.internalNote || '');
                    setEditingNote(false);
                  }}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditingNote(true)}
              className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1"
            >
              <MessageSquare className="w-3 h-3" />
              {sub.internalNote ? `Note: ${sub.internalNote}` : 'Add internal note'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
