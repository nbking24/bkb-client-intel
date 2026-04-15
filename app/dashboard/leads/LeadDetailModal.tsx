// @ts-nocheck
'use client';

import { useState, useEffect, useRef } from 'react';
import {
  X, Loader2, Phone, Mail, MapPin, Tag, Calendar, Clock,
  FileText, User, Building2, Globe, ExternalLink, ChevronDown, ChevronRight,
  Star, Clipboard,
} from 'lucide-react';

/* ── Types ── */
interface LeadDetailModalProps {
  contactId: string;
  opportunityId?: string;
  contactName?: string;
  onClose: () => void;
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

interface DetailData {
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

export default function LeadDetailModal({ contactId, opportunityId, contactName, onClose }: LeadDetailModalProps) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [moscowExpanded, setMoscowExpanded] = useState(true);
  const [customExpanded, setCustomExpanded] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ contactId });
        if (opportunityId) params.set('opportunityId', opportunityId);
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
  }, [contactId, opportunityId]);

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
                  {fullAddress && (
                    <div className="flex items-start gap-2 col-span-2">
                      <MapPin size={12} className="flex-shrink-0 mt-0.5" style={{ color: '#c88c00' }} />
                      <span className="text-sm" style={{ color: '#1a1a1a' }}>{fullAddress}</span>
                    </div>
                  )}
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

              {/* ── Upcoming Appointments ── */}
              {data.appointments.length > 0 && (
                <div style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                  <div className="flex items-center gap-2 px-5 py-3">
                    <Calendar size={13} style={{ color: '#c88c00' }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#8a8078' }}>
                      Upcoming
                    </span>
                  </div>
                  <div className="px-5 pb-4 space-y-2">
                    {data.appointments.map((apt) => (
                      <div key={apt.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(200,140,0,0.04)' }}>
                        <Clock size={12} style={{ color: '#c88c00' }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate" style={{ color: '#1a1a1a' }}>{apt.title || 'Appointment'}</div>
                          <div className="text-[11px]" style={{ color: '#6a6058' }}>{formatDateTime(apt.startTime)}</div>
                        </div>
                        {apt.status && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                            background: apt.status === 'confirmed' ? 'rgba(34,197,94,0.1)' : 'rgba(200,140,0,0.08)',
                            color: apt.status === 'confirmed' ? '#16a34a' : '#8a8078',
                          }}>
                            {apt.status}
                          </span>
                        )}
                      </div>
                    ))}
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
