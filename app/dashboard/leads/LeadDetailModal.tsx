// @ts-nocheck
'use client';

import { useState, useEffect, useRef } from 'react';
import {
  X, Loader2, Phone, Mail, MapPin, Tag, Calendar, Clock,
  FileText, User, Building2, Globe, ExternalLink, ChevronDown, ChevronRight,
  Star, Clipboard, MessageSquare, MessageCircle, PhoneCall, Mail as MailIcon,
  ArrowDownLeft, ArrowUpRight, Pencil, Trash2, CheckCircle2,
} from 'lucide-react';

/* ── Types ── */
interface LeadDetailModalProps {
  contactId: string;
  opportunityId?: string;
  jobId?: string;
  contactName?: string;
  onClose: () => void;
}

interface ActivityItem {
  kind: string;
  body: string;
  author: string;
  direction: 'inbound' | 'outbound' | null;
  subject: string;
  date: string;
  source: 'jobtread' | 'loop' | 'pml';
}

interface ContactData {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  companyName: string;
  website: string;
  source: string;
  dateAdded: string;
  lastActivity: string;
  tags: string[];
  dnd: boolean;
  assignedTo: string;
}

interface CustomField {
  id?: string;
  name: string;
  value: any;
}

interface Note {
  id: string;
  body: string;
  dateAdded: string;
}

interface Appointment {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
}

interface OpportunityData {
  id: string;
  name: string;
  status: string;
  monetaryValue: number;
  source: string;
  createdAt: string;
  stageName: string;
}

// Project address salvaged server-side from multiple sources (Loop contact,
// custom fields named like "address" / "property location", or regex-parsed
// out of a note body). Always present in the response; .text is empty only
// when none of the sources had anything usable.
interface ProjectAddress {
  text: string;
  source: string; // 'contact' | 'custom field "..."' | 'note body' | 'none'
}

interface DetailData {
  projectAddress?: ProjectAddress;
  recentActivity?: ActivityItem[];
  contact: ContactData;
  moscowFields: CustomField[];
  customFields: CustomField[];
  notes: Note[];
  appointments: Appointment[];
  opportunity: OpportunityData | null;
}

const STAGE_COLORS: Record<string, string> = {
  'New Inquiry': '#8a8078',
  'Initial Call Scheduled': '#c88c00',
  'Discovery Scheduled': '#e8c860',
  'No Show': '#ef4444',
  'Nurture': '#a78bfa',
  'Estimating': '#c88c00',
  'In Design': '#22c55e',
  'Ready': '#34d399',
  'In Production': '#2dd4bf',
};

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeAgo(dateStr: string) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(dateStr);
}

function formatFieldValue(value: any): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value || '');
}

export default function LeadDetailModal({ contactId, opportunityId, jobId, contactName, onClose }: LeadDetailModalProps) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [moscowExpanded, setMoscowExpanded] = useState(true);
  const [customExpanded, setCustomExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);

  // Per-appointment edit/cancel state. Keyed on the GHL event id (which
  // is also the row's apt.id). When a row is in edit mode the form
  // appears inline below the row. Cancel runs through a confirm step
  // before firing the DELETE.
  const [editingApptId, setEditingApptId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ title: string; date: string; time: string; notes: string }>({
    title: '', date: '', time: '', notes: '',
  });
  const [apptBusy, setApptBusy] = useState<string | null>(null);
  const [apptError, setApptError] = useState<string | null>(null);
  const [apptSuccess, setApptSuccess] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);

  function getToken(): string {
    return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
  }

  // Open the inline edit form for an appointment. Pre-fills with current
  // values so the user only has to change what's different.
  function startEdit(apt: Appointment) {
    setApptError(null);
    setApptSuccess(null);
    setCancelConfirm(null);
    const d = new Date(apt.startTime);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    setEditForm({
      title: apt.title || '',
      date: `${yyyy}-${mm}-${dd}`,
      time: `${hh}:${min}`,
      notes: '',
    });
    setEditingApptId(apt.id);
  }

  // Save edits. Computes a new start/end (preserving original duration)
  // from the form's date+time and posts to the group-aware PUT endpoint.
  async function saveEdit(apt: Appointment) {
    setApptError(null);
    setApptBusy(apt.id);
    try {
      const startMs = new Date(apt.startTime).getTime();
      const endMs = new Date(apt.endTime).getTime();
      const durationMs = Math.max(endMs - startMs, 30 * 60 * 1000);
      const newStart = new Date(`${editForm.date}T${editForm.time}:00`);
      const newEnd = new Date(newStart.getTime() + durationMs);
      const res = await fetch('/api/dashboard/schedule-meeting', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          ghlEventId: apt.id,
          title: editForm.title.trim() || undefined,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
          ...(editForm.notes.trim() ? { notes: editForm.notes.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Failed to update meeting');
      }
      const d = await res.json();
      const count = (d?.updatedEventIds || []).length || 1;
      setApptSuccess(`Updated ${count} calendar event${count === 1 ? '' : 's'}.`);
      setEditingApptId(null);
    } catch (err: any) {
      setApptError(err.message || 'Failed to update meeting');
    } finally {
      setApptBusy(null);
    }
  }

  // Cancel the entire meeting group (every sibling appointment + the JT
  // task). User clicks Cancel once to show the confirm row, then Cancel
  // again to confirm.
  async function cancelAppt(apt: Appointment) {
    setApptError(null);
    setApptBusy(apt.id);
    try {
      const res = await fetch('/api/dashboard/schedule-meeting', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ ghlEventId: apt.id }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Failed to cancel meeting');
      }
      const d = await res.json();
      const count = (d?.cancelledEventIds || []).length || 1;
      const jtBit = d?.jtTaskCancelled ? ' + JobTread task' : '';
      setApptSuccess(`Cancelled ${count} calendar event${count === 1 ? '' : 's'}${jtBit}.`);
      setCancelConfirm(null);
      // Mark this appointment locally as cancelled so the row updates
      // immediately without a full modal refetch.
      if (data) {
        setData({
          ...data,
          appointments: data.appointments.map(a =>
            a.id === apt.id ? { ...a, status: 'cancelled' } : a
          ),
        });
      }
    } catch (err: any) {
      setApptError(err.message || 'Failed to cancel meeting');
    } finally {
      setApptBusy(null);
    }
  }

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ contactId });
        if (opportunityId) params.set('opportunityId', opportunityId);
        if (jobId) params.set('jobId', jobId);
        const res = await fetch(`/api/dashboard/lead-detail?${params}`);
        if (!res.ok) throw new Error('Failed to load contact details');
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message || 'Failed to load details');
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [contactId, opportunityId, jobId]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 50);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick); };
  }, [onClose]);

  const contact = data?.contact;
  const fullAddress = contact
    ? [contact.address, contact.city, contact.state, contact.postalCode].filter(Boolean).join(', ')
    : '';

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4 overflow-y-auto pb-8">
        <div
          ref={modalRef}
          className="w-full rounded-xl overflow-hidden shadow-2xl"
          style={{
            maxWidth: 560,
            background: '#ffffff',
            border: '1px solid rgba(200,140,0,0.15)',
            animation: 'modalIn 0.15s ease-out',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4" style={{ background: '#f8f6f3', borderBottom: '1px solid rgba(200,140,0,0.1)' }}>
            <div className="flex items-center gap-2 min-w-0">
              <User size={16} style={{ color: '#c88c00' }} />
              <span className="text-base font-semibold truncate" style={{ color: '#1a1a1a' }}>
                {loading ? (contactName || 'Loading...') : (contact?.name || contactName || 'Contact')}
              </span>
              {data?.opportunity?.stageName && (
                <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0" style={{
                  background: `${STAGE_COLORS[data.opportunity.stageName] || '#8a8078'}18`,
                  color: STAGE_COLORS[data.opportunity.stageName] || '#8a8078',
                }}>
                  {data.opportunity.stageName}
                </span>
              )}
            </div>
            <button onClick={onClose} className="p-1 rounded-md hover:opacity-70 flex-shrink-0" style={{ color: '#8a8078' }}>
              <X size={16} />
            </button>
          </div>

          {/* Loading */}
          {loading && (
            <div className="px-5 py-12 flex items-center justify-center gap-2" style={{ color: '#8a8078' }}>
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading contact details...</span>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="px-5 py-8 text-center">
              <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
            </div>
          )}

          {/* Content */}
          {data && !loading && (
            <div className="max-h-[65vh] overflow-y-auto">

              {/* ── Contact Info ── */}
              <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {/* Phone */}
                  {contact?.phone && (
                    <div className="flex items-center gap-2">
                      <Phone size={12} style={{ color: '#c88c00' }} />
                      <a href={`tel:${contact.phone}`} className="text-sm hover:underline" style={{ color: '#1a1a1a' }}>
                        {contact.phone}
                      </a>
                    </div>
                  )}
                  {/* Email */}
                  {contact?.email && (
                    <div className="flex items-center gap-2 min-w-0">
                      <Mail size={12} className="flex-shrink-0" style={{ color: '#c88c00' }} />
                      <a href={`mailto:${contact.email}`} className="text-sm truncate hover:underline" style={{ color: '#1a1a1a' }}>
                        {contact.email}
                      </a>
                    </div>
                  )}
                  {/* Address */}
                  {/* Project address. Prefers the salvaged value from the
                      server (which already checked custom fields and notes)
                      over the raw Loop contact fields, so we still surface
                      something useful when address1 is empty. Always two
                      quick-action buttons: open the address on Google Maps
                      and search for it on Zillow in a new tab. */}
                  {(() => {
                    const salvaged = data.projectAddress?.text || '';
                    const addr = salvaged || fullAddress;
                    if (!addr) {
                      return (
                        <div className="flex items-start gap-2 col-span-2">
                          <MapPin size={12} className="flex-shrink-0 mt-0.5" style={{ color: '#bcb5ad' }} />
                          <span className="text-sm italic" style={{ color: '#8a8078' }}>
                            No project address on file.
                          </span>
                        </div>
                      );
                    }
                    const enc = encodeURIComponent(addr);
                    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${enc}`;
                    const zillowUrl = `https://www.zillow.com/homes/${enc}_rb/`;
                    const source = data.projectAddress?.source;
                    return (
                      <div className="flex items-start gap-2 col-span-2">
                        <MapPin size={12} className="flex-shrink-0 mt-0.5" style={{ color: '#c88c00' }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm" style={{ color: '#1a1a1a' }}>{addr}</div>
                          {source && source !== 'contact' && source !== 'none' && (
                            <div className="text-[10px] mt-0.5" style={{ color: '#8a8078' }}>
                              (from {source})
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            <a
                              href={zillowUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded hover:underline"
                              style={{
                                background: 'rgba(0,106,177,0.08)',
                                color: '#006aa7',
                                border: '1px solid rgba(0,106,177,0.20)',
                              }}
                              title="Open the address in Zillow's listing search"
                            >
                              <ExternalLink size={10} /> Zillow
                            </a>
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded hover:underline"
                              style={{
                                background: 'rgba(34,134,58,0.08)',
                                color: '#1e7a3b',
                                border: '1px solid rgba(34,134,58,0.20)',
                              }}
                              title="Open the address in Google Maps"
                            >
                              <ExternalLink size={10} /> Google Maps
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  navigator.clipboard.writeText(addr);
                                } catch { /* ignore — older browsers */ }
                              }}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded hover:underline"
                              style={{
                                background: '#f8f6f3',
                                color: '#5a5550',
                                border: '1px solid #e8e5e0',
                              }}
                              title="Copy address to clipboard"
                            >
                              <Clipboard size={10} /> Copy
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Company */}
                  {contact?.companyName && (
                    <div className="flex items-center gap-2">
                      <Building2 size={12} style={{ color: '#c88c00' }} />
                      <span className="text-sm" style={{ color: '#1a1a1a' }}>{contact.companyName}</span>
                    </div>
                  )}
                  {/* Website */}
                  {contact?.website && (
                    <div className="flex items-center gap-2 min-w-0">
                      <Globe size={12} className="flex-shrink-0" style={{ color: '#c88c00' }} />
                      <a href={contact.website.startsWith('http') ? contact.website : `https://${contact.website}`} target="_blank" rel="noopener" className="text-sm truncate hover:underline" style={{ color: '#c88c00' }}>
                        {contact.website}
                      </a>
                    </div>
                  )}
                  {/* Source */}
                  {contact?.source && (
                    <div className="flex items-center gap-2">
                      <Star size={12} style={{ color: '#c88c00' }} />
                      <span className="text-sm" style={{ color: '#6a6058' }}>Source: {contact.source}</span>
                    </div>
                  )}
                  {/* Created */}
                  {contact?.dateAdded && (
                    <div className="flex items-center gap-2">
                      <Calendar size={12} style={{ color: '#c88c00' }} />
                      <span className="text-sm" style={{ color: '#6a6058' }}>Added {formatDate(contact.dateAdded)}</span>
                    </div>
                  )}
                </div>

                {/* Tags */}
                {contact?.tags && contact.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {contact.tags.map((tag: string) => (
                      <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(200,140,0,0.08)', color: '#6a6058' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Opportunity value */}
                {data.opportunity && data.opportunity.monetaryValue > 0 && (
                  <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(34,197,94,0.06)' }}>
                    <span className="text-xs font-semibold" style={{ color: '#16a34a' }}>
                      ${data.opportunity.monetaryValue.toLocaleString()}
                    </span>
                    <span className="text-xs" style={{ color: '#6a6058' }}>estimated value</span>
                  </div>
                )}
              </div>

              {/* ── Recent Activity ── */}
              {/* JT job comments + Loop SMS/email/call messages, merged
                  chronologically. Filled in when the lead has a matched
                  JT job (comments) and/or any Loop conversation history. */}
              {data.recentActivity && data.recentActivity.length > 0 && (
                <div style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                  <button
                    onClick={() => setActivityExpanded(!activityExpanded)}
                    className="w-full flex items-center gap-2 px-5 py-3 text-left"
                    style={{ background: activityExpanded ? 'rgba(200,140,0,0.03)' : 'transparent' }}
                  >
                    <MessageSquare size={13} style={{ color: '#c88c00' }} />
                    <span className="text-xs font-semibold uppercase tracking-wider flex-1" style={{ color: '#8a8078' }}>
                      Recent Activity
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(200,140,0,0.1)', color: '#c88c00' }}>
                      {data.recentActivity.length}
                    </span>
                    {activityExpanded ? <ChevronDown size={12} style={{ color: '#8a8078' }} /> : <ChevronRight size={12} style={{ color: '#8a8078' }} />}
                  </button>
                  {activityExpanded && (
                    <div className="px-5 pb-4 space-y-2">
                      {data.recentActivity.map((act, i) => {
                        // Pick an icon + label per activity kind.
                        const iconFor = () => {
                          if (act.source === 'pml') return <FileText size={11} />;
                          if (act.source === 'jobtread') return <MessageSquare size={11} />;
                          if (act.kind === 'sms') return <MessageCircle size={11} />;
                          if (act.kind === 'email') return <MailIcon size={11} />;
                          if (act.kind === 'call') return <PhoneCall size={11} />;
                          return <MessageCircle size={11} />;
                        };
                        const sourceLabel = act.source === 'pml'
                          ? (act.kind === 'pml_transcript' ? 'Call Transcript' : 'Project Memory')
                          : act.source === 'jobtread'
                          ? 'JobTread comment'
                          : act.kind === 'sms' ? 'SMS'
                          : act.kind === 'email' ? 'Email'
                          : act.kind === 'call' ? 'Call'
                          : 'Message';
                        // Direction badge (only for Loop messages).
                        const dirBadge = act.direction === 'inbound'
                          ? { label: 'In', icon: <ArrowDownLeft size={9} />, bg: 'rgba(34,197,94,0.10)', fg: '#16a34a' }
                          : act.direction === 'outbound'
                          ? { label: 'Out', icon: <ArrowUpRight size={9} />, bg: 'rgba(79,70,229,0.10)', fg: '#4f46e5' }
                          : null;
                        const accentColor = act.source === 'pml'
                          ? '#4f46e5' // indigo for project memory / transcripts
                          : act.source === 'jobtread'
                            ? '#c88c00'
                            : '#6a6058';
                        return (
                          <div
                            key={i}
                            className="rounded-lg px-3 py-2.5"
                            style={{
                              background: '#f8f6f3',
                              border: '1px solid rgba(200,140,0,0.06)',
                              borderLeft: `2px solid ${accentColor}`,
                            }}
                          >
                            {/* Header row: kind + direction + date */}
                            <div className="flex items-center gap-2 mb-1.5 text-[10px]" style={{ color: '#8a8078' }}>
                              <span style={{ color: accentColor }}>{iconFor()}</span>
                              <span className="uppercase tracking-wider font-semibold" style={{ color: accentColor }}>
                                {sourceLabel}
                              </span>
                              {dirBadge && (
                                <span
                                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold"
                                  style={{ background: dirBadge.bg, color: dirBadge.fg }}
                                >
                                  {dirBadge.icon} {dirBadge.label}
                                </span>
                              )}
                              <span className="ml-auto">
                                {act.date ? `${timeAgo(act.date)} · ${formatDate(act.date)}` : ''}
                              </span>
                            </div>
                            {/* Email subject (Loop email only) */}
                            {act.subject && (
                              <div className="text-xs font-semibold mb-1" style={{ color: '#1a1a1a' }}>
                                {act.subject}
                              </div>
                            )}
                            {/* Body */}
                            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#1a1a1a' }}>
                              {act.body}
                            </div>
                            {/* Author / by-line for JT comments */}
                            {act.source === 'jobtread' && act.author && (
                              <div className="text-[10px] mt-1.5" style={{ color: '#8a8078' }}>
                                — {act.author}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── MOSCOW Fields ── */}
              {data.moscowFields.length > 0 && (
                <div style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                  <button
                    onClick={() => setMoscowExpanded(!moscowExpanded)}
                    className="w-full flex items-center gap-2 px-5 py-3 text-left"
                    style={{ background: moscowExpanded ? 'rgba(200,140,0,0.03)' : 'transparent' }}
                  >
                    <Clipboard size={13} style={{ color: '#c88c00' }} />
                    <span className="text-xs font-semibold uppercase tracking-wider flex-1" style={{ color: '#8a8078' }}>
                      MOSCOW
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(200,140,0,0.1)', color: '#c88c00' }}>
                      {data.moscowFields.length} {data.moscowFields.length === 1 ? 'field' : 'fields'}
                    </span>
                    {moscowExpanded ? <ChevronDown size={12} style={{ color: '#8a8078' }} /> : <ChevronRight size={12} style={{ color: '#8a8078' }} />}
                  </button>
                  {moscowExpanded && (
                    <div className="px-5 pb-4 space-y-2.5">
                      {data.moscowFields.map((field, i) => (
                        <div key={i}>
                          <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: '#8a8078' }}>
                            {field.name}
                          </div>
                          <div className="text-sm leading-relaxed" style={{ color: '#1a1a1a' }}>
                            {formatFieldValue(field.value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Notes ── */}
              <div style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                <button
                  onClick={() => setNotesExpanded(!notesExpanded)}
                  className="w-full flex items-center gap-2 px-5 py-3 text-left"
                  style={{ background: notesExpanded ? 'rgba(200,140,0,0.03)' : 'transparent' }}
                >
                  <FileText size={13} style={{ color: '#c88c00' }} />
                  <span className="text-xs font-semibold uppercase tracking-wider flex-1" style={{ color: '#8a8078' }}>
                    Notes
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(200,140,0,0.1)', color: '#c88c00' }}>
                    {data.notes.length}
                  </span>
                  {notesExpanded ? <ChevronDown size={12} style={{ color: '#8a8078' }} /> : <ChevronRight size={12} style={{ color: '#8a8078' }} />}
                </button>
                {notesExpanded && (
                  <div className="px-5 pb-4">
                    {data.notes.length > 0 ? (
                      <div className="space-y-3">
                        {data.notes.map((note) => (
                          <div key={note.id} className="rounded-lg px-3 py-2.5" style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.06)' }}>
                            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#1a1a1a' }}>
                              {note.body}
                            </div>
                            {note.dateAdded && (
                              <div className="text-[10px] mt-2" style={{ color: '#8a8078' }}>
                                {timeAgo(note.dateAdded)} · {formatDate(note.dateAdded)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs py-2" style={{ color: '#8a8078' }}>No notes on file</p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Upcoming Appointments ──
                  Each row has Edit + Cancel buttons that apply to the
                  entire meeting group (every sibling appointment created
                  for the per-attendee fan-out + the linked JobTread
                  task). Backend resolves the group from any one event
                  id, so the UI only needs to pass the appointment's id. */}
              {data.appointments.length > 0 && (
                <div style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                  <div className="flex items-center gap-2 px-5 py-3">
                    <Calendar size={13} style={{ color: '#c88c00' }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#8a8078' }}>
                      Upcoming
                    </span>
                  </div>
                  {(apptSuccess || apptError) && (
                    <div className="px-5 pb-2">
                      {apptSuccess && (
                        <div className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded" style={{ background: 'rgba(34,197,94,0.08)', color: '#16a34a' }}>
                          <CheckCircle2 size={11} /> {apptSuccess}
                        </div>
                      )}
                      {apptError && (
                        <div className="text-xs px-3 py-1.5 rounded" style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }}>
                          {apptError}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="px-5 pb-4 space-y-2">
                    {data.appointments.map((apt) => {
                      const isEditing = editingApptId === apt.id;
                      const isCancelled = (apt.status || '').toLowerCase() === 'cancelled';
                      const isBusy = apptBusy === apt.id;
                      const confirmingCancel = cancelConfirm === apt.id;
                      return (
                        <div key={apt.id} className="rounded-lg" style={{ background: 'rgba(200,140,0,0.04)' }}>
                          <div className="flex items-center gap-3 px-3 py-2">
                            <Clock size={12} style={{ color: '#c88c00' }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm truncate" style={{ color: '#1a1a1a' }}>{apt.title || 'Appointment'}</div>
                              <div className="text-[11px]" style={{ color: '#6a6058' }}>{formatDateTime(apt.startTime)}</div>
                            </div>
                            {apt.status && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                                background: isCancelled ? 'rgba(239,68,68,0.10)'
                                  : apt.status === 'confirmed' ? 'rgba(34,197,94,0.1)' : 'rgba(200,140,0,0.08)',
                                color: isCancelled ? '#b91c1c'
                                  : apt.status === 'confirmed' ? '#16a34a' : '#8a8078',
                              }}>
                                {apt.status}
                              </span>
                            )}
                            {!isCancelled && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => isEditing ? setEditingApptId(null) : startEdit(apt)}
                                  disabled={isBusy}
                                  className="text-[11px] flex items-center gap-1 px-2 py-1 rounded hover:bg-stone-50"
                                  style={{ color: '#3730a3', border: '1px solid rgba(79,70,229,0.20)' }}
                                  title="Edit this meeting (applies to all attendees)"
                                >
                                  <Pencil size={10} /> {isEditing ? 'Close' : 'Edit'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => confirmingCancel ? cancelAppt(apt) : setCancelConfirm(apt.id)}
                                  disabled={isBusy}
                                  className="text-[11px] flex items-center gap-1 px-2 py-1 rounded hover:bg-stone-50"
                                  style={{ color: '#b91c1c', border: '1px solid rgba(239,68,68,0.25)' }}
                                  title={confirmingCancel ? 'Click again to confirm' : 'Cancel meeting (all attendees + JT task)'}
                                >
                                  {isBusy ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                                  {confirmingCancel ? 'Confirm cancel' : 'Cancel'}
                                </button>
                                {confirmingCancel && (
                                  <button
                                    type="button"
                                    onClick={() => setCancelConfirm(null)}
                                    disabled={isBusy}
                                    className="text-[11px] px-2 py-1 rounded hover:bg-stone-50"
                                    style={{ color: '#6a6058' }}
                                  >
                                    Keep
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          {isEditing && (
                            <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: 'rgba(200,140,0,0.10)' }}>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                                <label className="text-[11px]" style={{ color: '#8a8078' }}>
                                  Title
                                  <input
                                    type="text"
                                    value={editForm.title}
                                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                    disabled={isBusy}
                                    className="w-full rounded-md px-2 py-1 text-xs mt-0.5"
                                    style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.20)', color: '#1a1a1a' }}
                                  />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="text-[11px]" style={{ color: '#8a8078' }}>
                                    Date
                                    <input
                                      type="date"
                                      value={editForm.date}
                                      onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                                      disabled={isBusy}
                                      className="w-full rounded-md px-2 py-1 text-xs mt-0.5"
                                      style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.20)', color: '#1a1a1a' }}
                                    />
                                  </label>
                                  <label className="text-[11px]" style={{ color: '#8a8078' }}>
                                    Time
                                    <input
                                      type="time"
                                      value={editForm.time}
                                      onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                                      disabled={isBusy}
                                      className="w-full rounded-md px-2 py-1 text-xs mt-0.5"
                                      style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.20)', color: '#1a1a1a' }}
                                    />
                                  </label>
                                </div>
                              </div>
                              <label className="text-[11px] block mt-2" style={{ color: '#8a8078' }}>
                                Add to notes (optional)
                                <textarea
                                  value={editForm.notes}
                                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                                  disabled={isBusy}
                                  placeholder="Any additional notes — appended to the event"
                                  rows={2}
                                  className="w-full rounded-md px-2 py-1 text-xs mt-0.5"
                                  style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.20)', color: '#1a1a1a', resize: 'vertical' }}
                                />
                              </label>
                              <div className="flex items-center gap-2 mt-2">
                                <button
                                  type="button"
                                  onClick={() => saveEdit(apt)}
                                  disabled={isBusy || !editForm.title.trim() || !editForm.date || !editForm.time}
                                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded"
                                  style={{
                                    background: isBusy || !editForm.title.trim() || !editForm.date || !editForm.time ? 'rgba(79,70,229,0.3)' : '#4f46e5',
                                    color: '#ffffff',
                                    cursor: isBusy ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {isBusy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                  Save changes
                                </button>
                                <span className="text-[10px]" style={{ color: '#8a8078' }}>
                                  Applies to every attendee + the JobTread task
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Other Custom Fields ── */}
              {data.customFields.length > 0 && (
                <div>
                  <button
                    onClick={() => setCustomExpanded(!customExpanded)}
                    className="w-full flex items-center gap-2 px-5 py-3 text-left"
                    style={{ background: customExpanded ? 'rgba(200,140,0,0.03)' : 'transparent' }}
                  >
                    <Tag size={13} style={{ color: '#c88c00' }} />
                    <span className="text-xs font-semibold uppercase tracking-wider flex-1" style={{ color: '#8a8078' }}>
                      Other Fields
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(200,140,0,0.1)', color: '#c88c00' }}>
                      {data.customFields.length}
                    </span>
                    {customExpanded ? <ChevronDown size={12} style={{ color: '#8a8078' }} /> : <ChevronRight size={12} style={{ color: '#8a8078' }} />}
                  </button>
                  {customExpanded && (
                    <div className="px-5 pb-4 space-y-2">
                      {data.customFields.map((field, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="text-[11px] font-medium flex-shrink-0 pt-0.5" style={{ color: '#8a8078', minWidth: 100 }}>
                            {field.name}
                          </span>
                          <span className="text-sm" style={{ color: '#1a1a1a' }}>
                            {formatFieldValue(field.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      </div>

      {/* Animation */}
      <style jsx>{`
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
