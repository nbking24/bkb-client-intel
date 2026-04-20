// @ts-nocheck
'use client';

/**
 * /dashboard/tickets
 *
 * Shared ticket queue + history. Every authenticated team member sees all
 * tickets and can comment; only the owner can change status / resolve.
 * Click any row to open the detail drawer with screenshot + event timeline.
 *
 * Query param ?open=<ticketId> deep-links a specific ticket (used by email CTAs).
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Bug, X, RefreshCw, Filter, Search, Clock, User as UserIcon,
  AlertTriangle, CheckCircle2, Circle, GitBranch, ExternalLink, Send,
  Loader2, Image as ImageIcon,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

type Ticket = {
  id: string;
  ticket_number: number;
  submitter_user_id: string;
  submitter_name: string;
  submitter_email: string | null;
  title: string;
  description: string | null;
  severity: 'low' | 'medium' | 'high' | 'urgent';
  page_url: string | null;
  screenshot_url: string | null;
  status: string;
  claude_branch: string | null;
  claude_commit_sha: string | null;
  claude_pr_url: string | null;
  claude_notes: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type TicketEvent = {
  id: string;
  ticket_id: string;
  actor: string;
  actor_role: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  metadata: any;
  created_at: string;
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  new:        { label: 'New',         color: '#68050a', bg: '#fce7e8' },
  in_review:  { label: 'In Review',   color: '#c88c00', bg: '#fef3c7' },
  fixing:     { label: 'Fixing',      color: '#1e40af', bg: '#dbeafe' },
  deployed:   { label: 'Deployed',    color: '#15803d', bg: '#dcfce7' },
  escalated:  { label: 'Escalated',   color: '#b91c1c', bg: '#fee2e2' },
  wont_fix:   { label: "Won't Fix",   color: '#5a5550', bg: '#f3f4f6' },
  closed:     { label: 'Closed',      color: '#5a5550', bg: '#f3f4f6' },
};

const SEVERITY_META: Record<string, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: '#dc2626' },
  high:   { label: 'High',   color: '#ea580c' },
  medium: { label: 'Medium', color: '#c88c00' },
  low:    { label: 'Low',    color: '#8a8078' },
};

const FILTER_GROUPS = [
  { id: 'open',     label: 'Open',      statuses: ['new', 'in_review', 'fixing', 'escalated'] },
  { id: 'new',      label: 'New',       statuses: ['new'] },
  { id: 'progress', label: 'In Progress', statuses: ['in_review', 'fixing'] },
  { id: 'resolved', label: 'Resolved',  statuses: ['deployed', 'closed'] },
  { id: 'all',      label: 'All',       statuses: [] },
];

export default function TicketsPage() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const token = typeof window !== 'undefined' ? localStorage.getItem('bkb-token') : null;
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const loadTickets = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/tickets?limit=200', { headers: authHeaders });
      const data = await res.json();
      if (res.ok) setTickets(data.tickets || []);
    } catch (err) {
      console.error('[tickets page] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadTicketDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/tickets/${id}`, { headers: authHeaders });
      const data = await res.json();
      if (res.ok) {
        setSelected(data.ticket);
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error('[tickets page] detail load failed:', err);
    } finally {
      setDetailLoading(false);
    }
  }, [token]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  // Deep-link support: ?open=<ticketId>
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && !selected) loadTicketDetail(openId);
  }, [searchParams, selected, loadTicketDetail]);

  const filtered = useMemo(() => {
    const group = FILTER_GROUPS.find((g) => g.id === filter);
    let rows = tickets;
    if (group && group.statuses.length > 0) {
      rows = rows.filter((t) => group.statuses.includes(t.status));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        String(t.ticket_number).includes(q)
      );
    }
    return rows;
  }, [tickets, filter, search]);

  async function handleAddComment() {
    if (!selected || !comment.trim()) return;
    setCommentSubmitting(true);
    try {
      const res = await fetch(`/api/tickets/${selected.id}/events`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: comment.trim() }),
      });
      if (res.ok) {
        setComment('');
        await loadTicketDetail(selected.id);
      }
    } finally {
      setCommentSubmitting(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!selected) return;
    const res = await fetch(`/api/tickets/${selected.id}`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      await loadTicketDetail(selected.id);
      await loadTickets();
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tickets) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [tickets]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#1a1a1a' }}>Tickets</h1>
          <div className="text-sm mt-1" style={{ color: '#8a8078' }}>
            Shared ticket queue. Showing all tickets submitted by the team.
          </div>
        </div>
        <button
          onClick={loadTickets}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#5a5550' }}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTER_GROUPS.map((g) => {
          const isActive = filter === g.id;
          const count = g.statuses.length === 0
            ? tickets.length
            : g.statuses.reduce((sum, s) => sum + (counts[s] || 0), 0);
          return (
            <button
              key={g.id}
              onClick={() => setFilter(g.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all"
              style={{
                background: isActive ? '#68050a' : '#ffffff',
                color: isActive ? '#ffffff' : '#5a5550',
                border: '1px solid',
                borderColor: isActive ? '#68050a' : '#e8e5e0',
              }}
            >
              {g.label}
              <span
                className="inline-flex items-center justify-center rounded-full text-xs px-1.5"
                style={{
                  background: isActive ? 'rgba(255,255,255,0.15)' : '#f8f6f3',
                  color: isActive ? '#ffffff' : '#8a8078',
                  minWidth: 20,
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8a8078' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-9 pr-3 py-2 rounded-lg text-sm"
            style={{ background: '#ffffff', border: '1px solid #e8e5e0', color: '#1a1a1a', minWidth: 200 }}
          />
        </div>
      </div>

      {/* Ticket list */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #e8e5e0' }}>
        {loading ? (
          <div className="p-8 text-center" style={{ color: '#8a8078' }}>
            <Loader2 size={18} className="inline-block animate-spin mr-2" />
            Loading tickets...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center" style={{ color: '#8a8078' }}>
            <Bug size={24} className="inline-block mb-2" />
            <div>No tickets here. Nice.</div>
          </div>
        ) : (
          <div>
            {filtered.map((t, idx) => {
              const statusMeta = STATUS_META[t.status] || STATUS_META.new;
              const sevMeta = SEVERITY_META[t.severity] || SEVERITY_META.medium;
              return (
                <button
                  key={t.id}
                  onClick={() => loadTicketDetail(t.id)}
                  className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-gray-50 transition-colors"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #f1ede8',
                    background: 'transparent',
                  }}
                >
                  <div className="flex-shrink-0 mt-0.5 text-xs font-mono" style={{ color: '#8a8078', width: 38 }}>
                    #{t.ticket_number}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm" style={{ color: '#1a1a1a' }}>
                        {t.title}
                      </span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: statusMeta.bg, color: statusMeta.color }}
                      >
                        {statusMeta.label}
                      </span>
                      <span
                        className="text-xs font-medium"
                        style={{ color: sevMeta.color }}
                      >
                        • {sevMeta.label}
                      </span>
                    </div>
                    <div className="text-xs mt-1 flex items-center gap-3 flex-wrap" style={{ color: '#8a8078' }}>
                      <span className="flex items-center gap-1">
                        <UserIcon size={11} />
                        {t.submitter_name}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {formatRelative(t.created_at)}
                      </span>
                      {t.screenshot_url && (
                        <span className="flex items-center gap-1">
                          <ImageIcon size={11} />
                          Screenshot
                        </span>
                      )}
                      {t.claude_pr_url && (
                        <span className="flex items-center gap-1" style={{ color: '#1e40af' }}>
                          <GitBranch size={11} />
                          PR open
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => { setSelected(null); router.replace('/dashboard/tickets'); }}
        >
          <div
            className="w-full md:max-w-2xl overflow-y-auto"
            style={{ background: '#ffffff' }}
            onClick={(e) => e.stopPropagation()}
          >
            <TicketDetail
              ticket={selected}
              events={events}
              loading={detailLoading}
              isOwner={auth.role === 'owner'}
              onClose={() => { setSelected(null); router.replace('/dashboard/tickets'); }}
              comment={comment}
              setComment={setComment}
              commentSubmitting={commentSubmitting}
              onAddComment={handleAddComment}
              onStatusChange={handleStatusChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Detail drawer
// ----------------------------------------------------------------

function TicketDetail({
  ticket, events, loading, isOwner, onClose, comment, setComment, commentSubmitting, onAddComment, onStatusChange,
}: {
  ticket: Ticket;
  events: TicketEvent[];
  loading: boolean;
  isOwner: boolean;
  onClose: () => void;
  comment: string;
  setComment: (s: string) => void;
  commentSubmitting: boolean;
  onAddComment: () => void;
  onStatusChange: (status: string) => void;
}) {
  const statusMeta = STATUS_META[ticket.status] || STATUS_META.new;
  const sevMeta = SEVERITY_META[ticket.severity] || SEVERITY_META.medium;

  return (
    <div>
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-5 py-4"
        style={{ background: '#68050a', color: '#ffffff' }}
      >
        <div className="flex items-center gap-2">
          <Bug size={16} style={{ color: '#e8c860' }} />
          <span className="font-medium">Ticket #{ticket.ticket_number}</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10">
          <X size={18} />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Title + metadata */}
        <div>
          <h2 className="text-lg font-semibold" style={{ color: '#1a1a1a' }}>{ticket.title}</h2>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: statusMeta.bg, color: statusMeta.color }}
            >
              {statusMeta.label}
            </span>
            <span className="text-xs font-medium" style={{ color: sevMeta.color }}>
              {sevMeta.label}
            </span>
            <span className="text-xs" style={{ color: '#8a8078' }}>
              Submitted by {ticket.submitter_name} • {formatRelative(ticket.created_at)}
            </span>
          </div>
        </div>

        {/* Description */}
        {ticket.description && (
          <div
            className="text-sm whitespace-pre-wrap p-4 rounded-lg"
            style={{ background: '#f8f6f3', color: '#1a1a1a' }}
          >
            {ticket.description}
          </div>
        )}

        {/* Screenshot */}
        {ticket.screenshot_url && (
          <div>
            <div className="text-xs font-medium mb-1.5" style={{ color: '#5a5550' }}>Screenshot</div>
            <a href={ticket.screenshot_url} target="_blank" rel="noopener noreferrer">
              <img
                src={ticket.screenshot_url}
                alt={`Ticket #${ticket.ticket_number} screenshot`}
                className="w-full rounded-lg"
                style={{ border: '1px solid #e8e5e0', maxHeight: 420, objectFit: 'contain', background: '#f8f6f3' }}
              />
            </a>
          </div>
        )}

        {/* Technical context */}
        {(ticket.page_url || ticket.claude_branch || ticket.claude_pr_url) && (
          <div className="rounded-lg p-4 space-y-2" style={{ background: '#f8f6f3', fontSize: 13 }}>
            {ticket.page_url && (
              <div className="flex items-start gap-2">
                <span style={{ color: '#8a8078', minWidth: 70 }}>Page:</span>
                <span style={{ color: '#1a1a1a', wordBreak: 'break-all' }}>{ticket.page_url}</span>
              </div>
            )}
            {ticket.claude_branch && (
              <div className="flex items-start gap-2">
                <span style={{ color: '#8a8078', minWidth: 70 }}>Branch:</span>
                <code style={{ color: '#1e40af', fontFamily: 'ui-monospace, monospace' }}>{ticket.claude_branch}</code>
              </div>
            )}
            {ticket.claude_pr_url && (
              <div className="flex items-start gap-2">
                <span style={{ color: '#8a8078', minWidth: 70 }}>PR:</span>
                <a
                  href={ticket.claude_pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1"
                  style={{ color: '#1e40af' }}
                >
                  {ticket.claude_pr_url}
                  <ExternalLink size={11} />
                </a>
              </div>
            )}
          </div>
        )}

        {/* Claude notes / resolution */}
        {ticket.claude_notes && (
          <div className="rounded-lg p-4" style={{ background: '#eff6ff', border: '1px solid #dbeafe' }}>
            <div className="text-xs font-medium mb-1" style={{ color: '#1e40af' }}>Agent notes</div>
            <div className="text-sm whitespace-pre-wrap" style={{ color: '#1a1a1a' }}>{ticket.claude_notes}</div>
          </div>
        )}
        {ticket.resolution_note && (
          <div className="rounded-lg p-4" style={{ background: '#f0fdf4', border: '1px solid #dcfce7' }}>
            <div className="text-xs font-medium mb-1" style={{ color: '#15803d' }}>Resolution</div>
            <div className="text-sm whitespace-pre-wrap" style={{ color: '#1a1a1a' }}>{ticket.resolution_note}</div>
          </div>
        )}

        {/* Status controls (owner only) */}
        {isOwner && (
          <div>
            <div className="text-xs font-medium mb-1.5" style={{ color: '#5a5550' }}>Change status</div>
            <div className="flex flex-wrap gap-2">
              {['in_review', 'fixing', 'deployed', 'escalated', 'wont_fix', 'closed'].map((s) => (
                <button
                  key={s}
                  disabled={ticket.status === s}
                  onClick={() => onStatusChange(s)}
                  className="text-xs px-2.5 py-1 rounded-full"
                  style={{
                    background: ticket.status === s ? STATUS_META[s].bg : '#ffffff',
                    color: ticket.status === s ? STATUS_META[s].color : '#5a5550',
                    border: '1px solid',
                    borderColor: ticket.status === s ? STATUS_META[s].color : '#e8e5e0',
                    opacity: ticket.status === s ? 1 : 0.8,
                    cursor: ticket.status === s ? 'default' : 'pointer',
                  }}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div>
          <div className="text-xs font-medium mb-2" style={{ color: '#5a5550' }}>Timeline</div>
          {loading ? (
            <div style={{ color: '#8a8078' }}><Loader2 size={14} className="inline-block animate-spin" /> Loading...</div>
          ) : (
            <div className="space-y-3">
              {events.map((e) => {
                // Comments render as prominent message cards so replies are easy to spot.
                if (e.event_type === 'commented' && e.note) {
                  return <CommentCard key={e.id} event={e} />;
                }
                return (
                  <div key={e.id} className="flex items-start gap-3 text-sm">
                    <div
                      className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5"
                      style={{ background: eventColor(e) }}
                    />
                    <div className="flex-1">
                      <div style={{ color: '#1a1a1a' }}>
                        <strong style={{ color: actorColor(e.actor) }}>{actorLabel(e.actor)}</strong>
                        {' '}
                        {describeEvent(e)}
                      </div>
                      {e.note && (
                        <div className="text-sm mt-1 whitespace-pre-wrap" style={{ color: '#5a5550' }}>{e.note}</div>
                      )}
                      <div className="text-xs mt-1" style={{ color: '#8a8078' }}>
                        {formatRelative(e.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add comment */}
        <div className="border-t pt-4" style={{ borderColor: '#e8e5e0' }}>
          <div className="text-xs font-medium mb-1.5" style={{ color: '#5a5550' }}>Add a comment</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onAddComment(); }}
              placeholder="Type a note..."
              className="flex-1 px-3 py-2 rounded-lg text-sm"
              style={{ border: '1px solid #e8e5e0', color: '#1a1a1a' }}
            />
            <button
              onClick={onAddComment}
              disabled={commentSubmitting || !comment.trim()}
              className="px-3 py-2 rounded-lg"
              style={{ background: '#68050a', color: '#ffffff', opacity: (!comment.trim() || commentSubmitting) ? 0.6 : 1 }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Comment card: a chat-bubble style card so replies and questions
// in the timeline stand out from dry status transitions.
// ----------------------------------------------------------------

function CommentCard({ event }: { event: TicketEvent }) {
  const isAgent = event.actor === 'claude' || event.actor_role === 'agent';
  const isSystem = event.actor === 'system' || event.actor_role === 'system';
  const accent = isAgent ? '#1e40af' : isSystem ? '#8a8078' : '#68050a';
  const bg     = isAgent ? '#eff6ff' : isSystem ? '#f8f6f3' : '#fef6f6';
  const border = isAgent ? '#dbeafe' : isSystem ? '#e8e5e0' : '#f4d4d6';
  return (
    <div
      className="rounded-lg p-3.5 text-sm"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ background: '#ffffff', color: accent, border: `1px solid ${border}` }}
          >
            {actorLabel(event.actor)}
          </span>
          <span className="text-xs" style={{ color: '#8a8078' }}>commented</span>
        </div>
        <span className="text-xs" style={{ color: '#8a8078' }}>
          {formatRelative(event.created_at)}
        </span>
      </div>
      <div className="whitespace-pre-wrap leading-relaxed" style={{ color: '#1a1a1a' }}>
        {event.note}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function actorLabel(actor: string): string {
  if (!actor) return 'Unknown';
  if (actor === 'claude') return 'Claude';
  if (actor === 'system') return 'System';
  if (actor === 'nathan') return 'Nathan';
  if (actor === 'terri') return 'Terri';
  if (actor === 'evan') return 'Evan';
  if (actor === 'josh') return 'Josh';
  return actor.charAt(0).toUpperCase() + actor.slice(1);
}

function describeEvent(e: TicketEvent): string {
  switch (e.event_type) {
    case 'created': return 'submitted the ticket';
    case 'status_changed': return `moved it from ${prettyStatus(e.from_status)} to ${prettyStatus(e.to_status)}`;
    case 'commented': return 'added a note';
    case 'claude_investigating': return 'started investigating';
    case 'claude_proposed_fix': return 'proposed a fix';
    case 'claude_deployed_fix': return 'deployed a fix';
    case 'claude_escalated': return 'escalated to Nathan';
    case 'email_sent': return 'sent a notification email';
    case 'screenshot_added': return 'added a screenshot';
    default: return e.event_type;
  }
}
function prettyStatus(s: string | null): string {
  if (!s) return '?';
  return STATUS_META[s]?.label || s;
}
function actorColor(actor: string): string {
  if (actor === 'claude') return '#1e40af';
  if (actor === 'system') return '#8a8078';
  if (actor === 'nathan') return '#68050a';
  return '#1a1a1a';
}
function eventColor(e: TicketEvent): string {
  if (e.event_type === 'claude_deployed_fix') return '#15803d';
  if (e.event_type === 'claude_escalated') return '#dc2626';
  if (e.event_type === 'email_sent') return '#8a8078';
  if (e.actor === 'claude') return '#1e40af';
  return '#c88c00';
}
function formatRelative(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
