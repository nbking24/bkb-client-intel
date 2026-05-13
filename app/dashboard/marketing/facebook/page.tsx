// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import {
  Loader2, MessageCircle, RefreshCw, ChevronRight, ExternalLink,
  Check, X, Edit3, Shield, AlertTriangle, MessageSquareReply,
} from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

interface FbDraft {
  id: string;
  fb_post_id: string;
  drafted_reply: string;
  draft_rationale: string | null;
  drafted_at: string | null;
  drafted_by_agent: string | null;
  approval_status: string;
  approved_reply: string | null;
  approved_by: string | null;
  approved_at: string | null;
  posted_at: string | null;
  posted_comment_id: string | null;
  skip_reason: string | null;
  source_post: {
    fb_post_id: string;
    group_name: string | null;
    group_id: string | null;
    author_name: string | null;
    post_text: string | null;
    post_url: string | null;
    post_posted_at: string | null;
    topic_match: string[] | null;
    never_reply_flag: boolean | null;
    never_reply_reason: string | null;
  } | null;
}

export default function FacebookPage() {
  const [drafts, setDrafts] = useState<FbDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function loadDrafts() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/marketing/fb-drafts?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.error) setError(data.error);
      else setDrafts(data.drafts || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDrafts(); }, []);

  if (loading && drafts.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading FB drafts...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">Failed to load: {error}</div>
    );
  }

  const pending = drafts.filter((d) => d.approval_status === 'pending');
  const approved = drafts.filter((d) => d.approval_status === 'approved' || d.approval_status === 'edited');
  const posted = drafts.filter((d) => d.approval_status === 'posted');
  const skipped = drafts.filter((d) => d.approval_status === 'skipped' || d.approval_status === 'failed');

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-700" />
            Facebook Comment Review
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Comment drafts from the Cowork Local Engagement agent. Review, edit, approve, or skip.
            Posting still happens manually until auto-publish is enabled.
          </p>
        </div>
        <button
          onClick={loadDrafts}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {pending.length > 0 && (
        <Section title="Awaiting your review" count={pending.length} accent="amber">
          {pending.map((d) => (
            <DraftRow key={d.id} draft={d} selected={selectedId === d.id}
              onSelect={() => setSelectedId(selectedId === d.id ? null : d.id)}
              onChange={loadDrafts} />
          ))}
        </Section>
      )}

      {approved.length > 0 && (
        <Section title="Approved (ready to post)" count={approved.length} accent="blue">
          {approved.map((d) => (
            <DraftRow key={d.id} draft={d} selected={selectedId === d.id}
              onSelect={() => setSelectedId(selectedId === d.id ? null : d.id)}
              onChange={loadDrafts} />
          ))}
        </Section>
      )}

      {posted.length > 0 && (
        <Section title="Posted" count={posted.length} accent="green">
          {posted.map((d) => (
            <DraftRow key={d.id} draft={d} selected={selectedId === d.id}
              onSelect={() => setSelectedId(selectedId === d.id ? null : d.id)}
              onChange={loadDrafts} />
          ))}
        </Section>
      )}

      {skipped.length > 0 && (
        <Section title="Skipped / Failed" count={skipped.length} accent="gray">
          {skipped.map((d) => (
            <DraftRow key={d.id} draft={d} selected={selectedId === d.id}
              onSelect={() => setSelectedId(selectedId === d.id ? null : d.id)}
              onChange={loadDrafts} />
          ))}
        </Section>
      )}

      {drafts.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center">
          <MessageCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-600">
            No FB drafts yet. The Cowork Local Engagement agent posts here whenever it drafts a
            helpful comment for a Bucks/Montco group thread.
          </p>
        </div>
      )}

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-5">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div className="text-sm text-gray-700">
            <h3 className="font-semibold text-gray-900 mb-1">Guardrails</h3>
            <ul className="space-y-1">
              <li>• Draft-mode only — every reply needs your approval. Nothing auto-posts.</li>
              <li>• Hard-coded never-reply topics: politics, religion, minors, contractor-venting.</li>
              <li>• Rate limits per group + per user to avoid looking like spam.</li>
              <li>• Voice-drift monitor flags drafts that diverge from approved history.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, count, accent, children }: {
  title: string; count: number;
  accent: 'amber' | 'gray' | 'green' | 'blue';
  children: React.ReactNode;
}) {
  const colors = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    gray: 'border-gray-200 bg-gray-50 text-gray-700',
    green: 'border-green-200 bg-green-50 text-green-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
  }[accent];
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
        <span className={`inline-flex items-center justify-center min-w-[24px] h-5 text-xs rounded-full border px-1.5 ${colors}`}>
          {count}
        </span>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
        {children}
      </div>
    </div>
  );
}

function DraftRow({ draft, selected, onSelect, onChange }: {
  draft: FbDraft; selected: boolean;
  onSelect: () => void; onChange: () => void;
}) {
  const sp = draft.source_post;
  const groupLabel = sp?.group_name || sp?.group_id || 'Unknown group';
  const author = sp?.author_name || 'Unknown author';
  const preview = (sp?.post_text || '').slice(0, 90);

  return (
    <div>
      <button
        onClick={onSelect}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <MessageSquareReply className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-900 text-sm truncate">
              {groupLabel} · {author}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {preview}{preview.length === 90 ? '…' : ''}
            </div>
          </div>
          {sp?.never_reply_flag && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-50 text-red-700 border border-red-200">
              <AlertTriangle className="w-3 h-3" /> Flagged
            </span>
          )}
        </div>
        <ChevronRight
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${selected ? 'rotate-90' : ''}`}
        />
      </button>
      {selected && <DraftDetail draftId={draft.id} onChange={onChange} />}
    </div>
  );
}

function DraftDetail({ draftId, onChange }: { draftId: string; onChange: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editedReply, setEditedReply] = useState<string>('');
  const [skipReason, setSkipReason] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const token = getToken();
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing/fb-drafts/${draftId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      setData(d);
      setEditedReply(d?.draft?.approved_reply || d?.draft?.drafted_reply || '');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [draftId]);

  async function patch(body: any) {
    setBusy(true);
    try {
      const token = getToken();
      const r = await fetch(`/api/marketing/fb-drafts/${draftId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await r.json();
      if (out.error) { alert('Error: ' + out.error); return; }
      await load();
      onChange();
    } finally { setBusy(false); }
  }

  async function approveAsIs() {
    await patch({ approval_status: 'approved' });
  }
  async function approveEdited() {
    if (!editedReply.trim()) { alert('Reply cannot be empty.'); return; }
    const original = data?.draft?.drafted_reply || '';
    const isEdited = editedReply.trim() !== original.trim();
    await patch({
      approval_status: isEdited ? 'edited' : 'approved',
      approved_reply: editedReply,
    });
  }
  async function skip() {
    if (!skipReason.trim()) { alert('Add a short skip reason.'); return; }
    await patch({ approval_status: 'skipped', skip_reason: skipReason });
  }
  async function markPosted() {
    await patch({ approval_status: 'posted' });
  }

  if (loading) {
    return (
      <div className="bg-gray-50 px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading...
      </div>
    );
  }
  if (!data?.draft) return null;

  const d = data.draft;
  const sp = data.source_post;
  const rationale = data.parsed_rationale || {};
  const status = d.approval_status;

  return (
    <div className="bg-gray-50 px-4 py-4 space-y-4">
      {sp && (
        <div className="bg-white border border-gray-200 rounded-md p-3">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Original post</div>
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm text-gray-900 whitespace-pre-wrap flex-1">
              <span className="font-medium">{sp.author_name || 'Unknown'}</span>
              {sp.group_name ? <span className="text-gray-500"> · {sp.group_name}</span> : null}
              <div className="mt-1">{sp.post_text}</div>
              {Array.isArray(sp.topic_match) && sp.topic_match.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {sp.topic_match.map((t: string) => (
                    <span key={t} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full">{t}</span>
                  ))}
                </div>
              )}
            </div>
            {sp.post_url && (
              <a href={sp.post_url} target="_blank" rel="noopener noreferrer"
                 className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 shrink-0">
                Open <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-md p-3">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Drafted reply</div>
        {status === 'pending' || status === 'approved' || status === 'edited' ? (
          <textarea
            value={editedReply}
            onChange={(e) => setEditedReply(e.target.value)}
            rows={5}
            className="w-full text-sm text-gray-900 border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <div className="text-sm text-gray-900 whitespace-pre-wrap">
            {d.approved_reply || d.drafted_reply}
          </div>
        )}
        {rationale && (rationale.rationale || rationale.suggested_attribution || rationale.confidence || rationale.voice_note) && (
          <div className="mt-3 text-xs text-gray-600 border-t border-gray-100 pt-2 space-y-1">
            {rationale.rationale && <div><span className="font-medium">Rationale:</span> {rationale.rationale}</div>}
            {rationale.suggested_attribution && <div><span className="font-medium">Attribution:</span> {rationale.suggested_attribution}</div>}
            {rationale.confidence && <div><span className="font-medium">Confidence:</span> {rationale.confidence}</div>}
            {rationale.voice_note && <div><span className="font-medium">Voice note:</span> {rationale.voice_note}</div>}
            {Array.isArray(rationale.open_questions) && rationale.open_questions.length > 0 && (
              <div><span className="font-medium">Open questions:</span> {rationale.open_questions.join('; ')}</div>
            )}
          </div>
        )}
        {d.approved_at && (
          <div className="mt-2 text-xs text-gray-500">
            Approved {new Date(d.approved_at).toLocaleString()} by {d.approved_by || 'unknown'}
          </div>
        )}
        {d.posted_at && (
          <div className="text-xs text-gray-500">
            Posted {new Date(d.posted_at).toLocaleString()}
            {d.posted_comment_id && ` · comment ${d.posted_comment_id}`}
          </div>
        )}
        {d.skip_reason && (
          <div className="text-xs text-gray-500">Skip reason: {d.skip_reason}</div>
        )}
      </div>

      {status === 'pending' && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={approveAsIs}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> Approve as drafted
          </button>
          <button
            onClick={approveEdited}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-blue-600 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-50"
          >
            <Edit3 className="w-4 h-4" /> Save edits & approve
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="text"
              placeholder="Reason to skip..."
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1.5 w-48"
            />
            <button
              onClick={skip}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              <X className="w-4 h-4" /> Skip
            </button>
          </div>
        </div>
      )}

      {(status === 'approved' || status === 'edited') && (
        <div className="flex flex-wrap items-center gap-2">
          {d.source_post?.post_url || sp?.post_url ? (
            <a
              href={sp?.post_url || d.source_post?.post_url}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Open thread to post <ExternalLink className="w-4 h-4" />
            </a>
          ) : null}
          <button
            onClick={markPosted}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-green-600 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> Mark as posted
          </button>
        </div>
      )}
    </div>
  );
}
