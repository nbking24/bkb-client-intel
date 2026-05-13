// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import {
  Loader2, CalendarDays, RefreshCw, ChevronRight, Check, X, Edit3,
  Instagram, Facebook, MapPin, Image as ImageIcon, ExternalLink, AlertTriangle,
} from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

interface WeekCounts { total: number; pending?: number; approved?: number; posted?: number; skipped?: number; }
interface Week {
  id: string;
  week_of: string;
  theme: string | null;
  caveat: string | null;
  notes: string | null;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  drafted_at: string | null;
  counts: WeekCounts;
}
interface Post {
  id: string;
  week_id: string;
  position: number;
  scheduled_day: string | null;
  scheduled_time: string | null;
  platform: string;
  format: string;
  topic: string | null;
  caption: string;
  approved_caption: string | null;
  hashtags: string[];
  alt_text: string | null;
  photos: any;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  posted_at: string | null;
  posted_url: string | null;
  skip_reason: string | null;
}

export default function SocialCalendarPage() {
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function loadWeeks() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/marketing/social-calendar?limit=30', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.error) setError(data.error);
      else setWeeks(data.weeks || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadWeeks(); }, []);

  if (loading && weeks.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading weekly calendars...
      </div>
    );
  }
  if (error) {
    return <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">Failed to load: {error}</div>;
  }

  const review = weeks.filter((w) => w.status === 'review');
  const approved = weeks.filter((w) => w.status === 'approved' || w.status === 'scheduled');
  const sent = weeks.filter((w) => w.status === 'sent');
  const other = weeks.filter((w) => !['review', 'approved', 'scheduled', 'sent'].includes(w.status));

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-700" />
            Social Calendar
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Weekly content drafts from the Cowork Content Strategist. Review the week, then approve or edit each post.
          </p>
        </div>
        <button
          onClick={loadWeeks}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {review.length > 0 && (
        <Section title="Awaiting your review" count={review.length} accent="amber">
          {review.map((w) => (
            <WeekRow key={w.id} week={w} selected={selectedId === w.id}
              onSelect={() => setSelectedId(selectedId === w.id ? null : w.id)}
              onChange={loadWeeks} />
          ))}
        </Section>
      )}
      {approved.length > 0 && (
        <Section title="Approved / Scheduled" count={approved.length} accent="blue">
          {approved.map((w) => (
            <WeekRow key={w.id} week={w} selected={selectedId === w.id}
              onSelect={() => setSelectedId(selectedId === w.id ? null : w.id)}
              onChange={loadWeeks} />
          ))}
        </Section>
      )}
      {sent.length > 0 && (
        <Section title="Sent" count={sent.length} accent="green">
          {sent.map((w) => (
            <WeekRow key={w.id} week={w} selected={selectedId === w.id}
              onSelect={() => setSelectedId(selectedId === w.id ? null : w.id)}
              onChange={loadWeeks} />
          ))}
        </Section>
      )}
      {other.length > 0 && (
        <Section title="Other" count={other.length} accent="gray">
          {other.map((w) => (
            <WeekRow key={w.id} week={w} selected={selectedId === w.id}
              onSelect={() => setSelectedId(selectedId === w.id ? null : w.id)}
              onChange={loadWeeks} />
          ))}
        </Section>
      )}

      {weeks.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center">
          <CalendarDays className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-600">
            No weekly calendars yet. The Cowork Content Strategist drafts one each week — the
            scheduled run is Monday 9am ET.
          </p>
        </div>
      )}
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

function WeekRow({ week, selected, onSelect, onChange }: {
  week: Week; selected: boolean; onSelect: () => void; onChange: () => void;
}) {
  const c = week.counts || { total: 0 };
  return (
    <div>
      <button
        onClick={onSelect}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-900 text-sm">
              Week of {formatDate(week.week_of)}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {week.theme || 'No theme set'} · {c.total} posts
              {c.pending ? ` · ${c.pending} pending` : ''}
              {c.approved ? ` · ${c.approved} approved` : ''}
              {c.posted ? ` · ${c.posted} posted` : ''}
            </div>
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${selected ? 'rotate-90' : ''}`} />
      </button>
      {selected && <WeekDetail weekId={week.id} onChange={onChange} />}
    </div>
  );
}

function WeekDetail({ weekId, onChange }: { weekId: string; onChange: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);

  async function load() {
    const token = getToken();
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing/social-calendar/${weekId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(await r.json());
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [weekId]);

  async function approveWeek() {
    const allApproved = (data?.posts || []).every((p: Post) =>
      p.approval_status === 'approved' || p.approval_status === 'edited' ||
      p.approval_status === 'skipped' || p.approval_status === 'posted'
    );
    if (!allApproved) {
      if (!confirm('Some posts still have status "pending". Approve the week anyway?')) return;
    }
    setApproving(true);
    try {
      const token = getToken();
      await fetch(`/api/marketing/social-calendar/${weekId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      await load();
      onChange();
    } finally { setApproving(false); }
  }

  if (loading) {
    return (
      <div className="bg-gray-50 px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading...
      </div>
    );
  }
  if (!data?.week) return null;

  const week = data.week as Week;
  const posts = (data.posts || []) as Post[];
  const notes = data.parsed_notes;

  return (
    <div className="bg-gray-50 px-4 py-4 space-y-4">
      {(week.theme || week.caveat) && (
        <div className="bg-white border border-gray-200 rounded-md p-3 text-sm">
          {week.theme && <div className="font-medium text-gray-900">Theme: {week.theme}</div>}
          {week.caveat && (
            <div className="mt-2 text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 inline-flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{week.caveat}</span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {posts.length === 0 && (
          <div className="text-sm text-gray-500 italic">No posts in this week.</div>
        )}
        {posts.map((p) => (
          <PostCard key={p.id} post={p} onChange={() => { load(); onChange(); }} />
        ))}
      </div>

      {notes && (notes.open_questions || notes.notes) && (
        <div className="bg-white border border-gray-200 rounded-md p-3 text-sm">
          <div className="font-medium text-gray-900 mb-1">Notes from the Strategist</div>
          {Array.isArray(notes.open_questions) && notes.open_questions.length > 0 && (
            <div className="text-gray-700">
              <span className="font-medium">Open questions: </span>
              <ul className="list-disc list-inside">
                {notes.open_questions.map((q: string, i: number) => <li key={i}>{q}</li>)}
              </ul>
            </div>
          )}
          {notes.notes && <div className="text-gray-700 whitespace-pre-wrap">{notes.notes}</div>}
        </div>
      )}

      {week.status === 'review' && (
        <div className="flex items-center gap-2">
          <button
            onClick={approveWeek}
            disabled={approving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> Approve the week
          </button>
          <span className="text-xs text-gray-500">
            Approve each post first; this marks the whole week ready to schedule.
          </span>
        </div>
      )}
      {week.approved_at && (
        <div className="text-xs text-gray-500">
          Week approved {new Date(week.approved_at).toLocaleString()} by {week.approved_by || 'unknown'}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, onChange }: { post: Post; onChange: () => void }) {
  const initialCap = post.approved_caption ?? post.caption;
  const [caption, setCaption] = useState(initialCap);
  const [hashtags, setHashtags] = useState((post.hashtags || []).join(' '));
  const [alt, setAlt] = useState(post.alt_text || '');
  const [skipReason, setSkipReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(post.approval_status === 'pending');

  async function patch(body: any) {
    setBusy(true);
    try {
      const token = getToken();
      const r = await fetch(`/api/marketing/social-calendar/drafts/${post.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await r.json();
      if (out.error) { alert('Error: ' + out.error); return; }
      onChange();
    } finally { setBusy(false); }
  }

  function parseHashtags(s: string): string[] {
    return s.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  }

  async function approve() {
    const edited = caption.trim() !== post.caption.trim();
    const tags = parseHashtags(hashtags);
    await patch({
      approval_status: edited ? 'edited' : 'approved',
      approved_caption: caption,
      hashtags: tags,
      alt_text: alt,
    });
  }
  async function skip() {
    if (!skipReason.trim()) { alert('Add a short skip reason.'); return; }
    await patch({ approval_status: 'skipped', skip_reason: skipReason });
  }
  async function markPosted() {
    await patch({ approval_status: 'posted' });
  }

  const statusBadge = ({
    pending: 'bg-amber-50 text-amber-800 border-amber-200',
    approved: 'bg-blue-50 text-blue-800 border-blue-200',
    edited: 'bg-blue-50 text-blue-800 border-blue-200',
    posted: 'bg-green-50 text-green-800 border-green-200',
    skipped: 'bg-gray-100 text-gray-700 border-gray-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
  } as any)[post.approval_status] || 'bg-gray-100 text-gray-700';

  const photoCount = Array.isArray(post.photos) ? post.photos.length :
    typeof post.photos === 'string' ? (() => { try { return JSON.parse(post.photos).length; } catch { return 0; } })() : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-md">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <PlatformIcon platform={post.platform} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 truncate">
              {post.topic || formatLabel(post.platform) + ' ' + formatLabel(post.format)}
            </div>
            <div className="text-xs text-gray-500">
              {post.scheduled_day ? formatDate(post.scheduled_day) : 'Unscheduled'}
              {post.scheduled_time ? ` · ${post.scheduled_time}` : ''}
              {' · '}{formatLabel(post.format)}
              {photoCount ? ` · ${photoCount} photo${photoCount > 1 ? 's' : ''}` : ''}
            </div>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${statusBadge}`}>
          {post.approval_status}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={5}
              disabled={post.approval_status === 'posted' || post.approval_status === 'skipped'}
              className="w-full text-sm text-gray-900 border border-gray-300 rounded-md px-2 py-1.5 disabled:bg-gray-50 disabled:text-gray-700"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Hashtags (space-separated)</label>
            <input
              type="text"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              disabled={post.approval_status === 'posted' || post.approval_status === 'skipped'}
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Alt text</label>
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              disabled={post.approval_status === 'posted' || post.approval_status === 'skipped'}
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 disabled:bg-gray-50"
            />
          </div>
          {photoCount > 0 && (
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> {photoCount} photo{photoCount > 1 ? 's' : ''} attached (visible to Publisher)
            </div>
          )}

          {post.approval_status === 'pending' && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button onClick={approve} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                <Check className="w-4 h-4" /> Save & approve
              </button>
              <div className="flex items-center gap-2 ml-auto">
                <input type="text" placeholder="Reason to skip..." value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 w-48" />
                <button onClick={skip} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50">
                  <X className="w-4 h-4" /> Skip
                </button>
              </div>
            </div>
          )}
          {(post.approval_status === 'approved' || post.approval_status === 'edited') && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button onClick={approve} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-blue-600 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-50">
                <Edit3 className="w-4 h-4" /> Save edits
              </button>
              <button onClick={markPosted} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-green-600 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-50">
                <Check className="w-4 h-4" /> Mark as posted
              </button>
            </div>
          )}
          {post.posted_url && (
            <div className="text-xs">
              <a href={post.posted_url} target="_blank" rel="noopener noreferrer"
                 className="text-blue-700 hover:underline inline-flex items-center gap-1">
                View posted <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          {post.skip_reason && <div className="text-xs text-gray-500">Skip reason: {post.skip_reason}</div>}
          {post.approved_at && (
            <div className="text-xs text-gray-500">
              Approved {new Date(post.approved_at).toLocaleString()} by {post.approved_by}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === 'instagram') return <Instagram className="w-4 h-4 text-pink-600 shrink-0" />;
  if (platform === 'facebook') return <Facebook className="w-4 h-4 text-blue-700 shrink-0" />;
  if (platform === 'google_business') return <MapPin className="w-4 h-4 text-green-700 shrink-0" />;
  return <ImageIcon className="w-4 h-4 text-gray-400 shrink-0" />;
}

function formatLabel(s: string) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function formatDate(d: string) {
  try {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}
