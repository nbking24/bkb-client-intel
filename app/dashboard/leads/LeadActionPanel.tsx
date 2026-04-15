// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import {
  X, Calendar, Clock, Loader2, CheckCircle2,
  ArrowRight, MessageSquare, Heart,
  Phone, Mail, ChevronDown, ChevronRight, FileText, UserPlus, Search,
} from 'lucide-react';

/* ── Types ── */
interface PendingLead {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  phone: string;
  email: string;
  source: string;
  tags: string[];
  createdAt: string;
  daysPending: number;
  stage: string;
}

interface LeadActionPanelProps {
  lead: PendingLead | null;
  pendingLeads: PendingLead[];
  onSelectLead: (lead: PendingLead) => void;
  onClose: () => void;
  onComplete: () => void;
  getToken: () => string;
}

/* ── Time slots ── */
const TIME_SLOTS: string[] = [];
for (let h = 7; h <= 17; h++) {
  TIME_SLOTS.push(`${h.toString().padStart(2, '0')}:00`);
  if (h < 17) TIME_SLOTS.push(`${h.toString().padStart(2, '0')}:30`);
}

function formatTime(t: string) {
  if (!t) return '';
  const [hh, mm] = t.split(':');
  const h = parseInt(hh);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${mm} ${ampm}`;
}

const STAGE_COLORS: Record<string, string> = {
  'New Inquiry': '#8a8078',
  'Initial Call Scheduled': '#c88c00',
  'Discovery Scheduled': '#e8c860',
  'No Show': '#ef4444',
  'Nurture': '#a78bfa',
  'Estimating': '#c88c00',
};

export default function LeadActionPanel({ lead, pendingLeads, onSelectLead, onClose, onComplete, getToken }: LeadActionPanelProps) {
  const [selectedAction, setSelectedAction] = useState<'schedule' | 'nurture' | null>(null);
  const [notes, setNotes] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [leadSearchOpen, setLeadSearchOpen] = useState(false);
  const [leadSearch, setLeadSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Default date to tomorrow
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setAppointmentDate(tomorrow.toISOString().split('T')[0]);
  }, []);

  // Reset when lead changes
  useEffect(() => {
    setSelectedAction(null);
    setNotes('');
    setAppointmentTime('');
    setLoading(false);
    setSuccess(null);
    setError('');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setAppointmentDate(tomorrow.toISOString().split('T')[0]);
  }, [lead?.id]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (leadSearchOpen) setTimeout(() => searchRef.current?.focus(), 100);
  }, [leadSearchOpen]);

  const contactName = lead ? (lead.contactName || lead.name) : '';

  const filteredLeads = pendingLeads.filter(l => {
    if (!leadSearch.trim()) return true;
    const q = leadSearch.toLowerCase();
    return (l.contactName || l.name).toLowerCase().includes(q) ||
      (l.phone || '').includes(q) ||
      (l.email || '').toLowerCase().includes(q);
  });

  const canSubmit = lead && (
    selectedAction === 'nurture' ||
    (selectedAction === 'schedule' && appointmentDate && appointmentTime)
  );

  const handleSubmit = async () => {
    if (!selectedAction || !lead) return;
    setLoading(true);
    setError('');

    try {
      const payload: Record<string, any> = {
        action: selectedAction === 'schedule' ? 'schedule_meeting' : 'move_to_nurture',
        opportunityId: lead.id,
        contactId: lead.contactId,
        contactName,
      };

      if (notes.trim()) payload.notes = notes.trim();

      if (selectedAction === 'schedule') {
        payload.appointmentDate = appointmentDate;
        payload.appointmentTime = appointmentTime;
      }

      const res = await fetch('/api/dashboard/leads-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to process action');
      }

      const successMsg = selectedAction === 'schedule'
        ? `Design meeting scheduled for ${new Date(appointmentDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${formatTime(appointmentTime)}`
        : `${contactName} moved to Nurture`;

      setSuccess(successMsg);
      setTimeout(() => onComplete(), 2000);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.12)' }}>
      {/* Header */}
      <button
        onClick={onClose}
        className="w-full flex items-center gap-2 px-5 py-3 cursor-pointer"
        style={{ background: '#f8f6f3', borderBottom: '1px solid rgba(200,140,0,0.08)' }}
      >
        <MessageSquare size={16} style={{ color: '#c88c00' }} />
        <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Post-Call Actions</span>
        <span className="text-xs ml-auto mr-2" style={{ color: '#6a6058' }}>
          {success ? 'Done!' : lead ? contactName : 'Select a lead'}
        </span>
        <div className="transition-transform duration-200" style={{ transform: 'rotate(90deg)' }}>
          <ChevronRight size={16} style={{ color: '#8a8078' }} />
        </div>
      </button>

      {/* Success state */}
      {success ? (
        <div className="px-5 py-8 text-center">
          <CheckCircle2 size={36} className="mx-auto mb-3" style={{ color: '#22c55e' }} />
          <p className="text-sm font-medium" style={{ color: '#1a1a1a' }}>{success}</p>
          {notes.trim() && (
            <p className="text-xs mt-1" style={{ color: '#8a8078' }}>Call notes saved to GHL + Project Memory</p>
          )}
        </div>
      ) : (
        <div className="px-5 py-4">
          {/* ── Lead Selector ── */}
          <div className="mb-4">
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#8a8078' }}>
              Lead
            </label>
            <div className="relative">
              <button
                onClick={() => setLeadSearchOpen(!leadSearchOpen)}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-left transition-all"
                style={{
                  background: '#ffffff',
                  border: lead ? '1px solid rgba(200,140,0,0.2)' : '1px solid rgba(220,80,80,0.3)',
                  color: lead ? '#1a1a1a' : '#8a8078',
                }}
              >
                {lead ? (
                  <>
                    <span className="font-medium flex-1">{contactName}</span>
                    {lead.stage && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                        background: `${STAGE_COLORS[lead.stage] || '#8a8078'}18`,
                        color: STAGE_COLORS[lead.stage] || '#8a8078',
                      }}>
                        {lead.stage}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="flex-1">Select a lead...</span>
                )}
                <ChevronDown size={14} style={{ color: '#8a8078' }} />
              </button>

              {/* Dropdown */}
              {leadSearchOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg shadow-lg overflow-hidden"
                  style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', maxHeight: 280 }}>
                  {/* Search */}
                  <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: '#f8f6f3' }}>
                      <Search size={12} style={{ color: '#8a8078' }} />
                      <input
                        ref={searchRef}
                        type="text"
                        value={leadSearch}
                        onChange={(e) => setLeadSearch(e.target.value)}
                        placeholder="Search leads..."
                        className="flex-1 text-xs bg-transparent outline-none"
                        style={{ color: '#1a1a1a' }}
                      />
                    </div>
                  </div>
                  {/* Lead list */}
                  <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                    {filteredLeads.length > 0 ? filteredLeads.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => { onSelectLead(l); setLeadSearchOpen(false); setLeadSearch(''); }}
                        className="w-full text-left px-3 py-2.5 flex items-center gap-3 transition-all"
                        style={{
                          borderBottom: '1px solid rgba(200,140,0,0.04)',
                          background: lead?.id === l.id ? 'rgba(200,140,0,0.06)' : 'transparent',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(200,140,0,0.04)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = lead?.id === l.id ? 'rgba(200,140,0,0.06)' : 'transparent'; }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate" style={{ color: '#1a1a1a' }}>
                              {l.contactName || l.name}
                            </span>
                            {l.stage && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0" style={{
                                background: `${STAGE_COLORS[l.stage] || '#8a8078'}18`,
                                color: STAGE_COLORS[l.stage] || '#8a8078',
                              }}>
                                {l.stage}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: '#8a8078' }}>
                            {l.phone && <span className="flex items-center gap-1"><Phone size={9} /> {l.phone}</span>}
                            {l.email && <span className="flex items-center gap-1 truncate"><Mail size={9} /> {l.email}</span>}
                          </div>
                        </div>
                        {l.daysPending > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0" style={{
                            background: l.daysPending > 7 ? 'rgba(239,68,68,0.1)' : l.daysPending > 3 ? 'rgba(245,158,11,0.1)' : 'rgba(200,140,0,0.06)',
                            color: l.daysPending > 7 ? '#ef4444' : l.daysPending > 3 ? '#f59e0b' : '#8a8078',
                          }}>
                            {l.daysPending}d
                          </span>
                        )}
                      </button>
                    )) : (
                      <div className="px-3 py-6 text-center text-xs" style={{ color: '#8a8078' }}>
                        {pendingLeads.length === 0 ? 'No pending leads found' : 'No matches'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Quick info under selected lead */}
            {lead && (lead.phone || lead.email) && (
              <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: '#6a6058' }}>
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="flex items-center gap-1 hover:opacity-80" style={{ color: '#c88c00' }}>
                    <Phone size={10} /> {lead.phone}
                  </a>
                )}
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:opacity-80" style={{ color: '#c88c00' }}>
                    <Mail size={10} /> {lead.email}
                  </a>
                )}
              </div>
            )}
          </div>

          {/* ── Call Notes ── */}
          <div className="mb-4">
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#8a8078' }}>
              <FileText size={10} />
              Call Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How did the discovery call go? Key details, project scope, budget discussion..."
              rows={4}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-y"
              style={{
                background: '#ffffff',
                border: '1px solid rgba(200,140,0,0.15)',
                color: '#1a1a1a',
                minHeight: '80px',
              }}
            />
            {notes.length > 0 && (
              <div className="text-right mt-1">
                <span className="text-[10px]" style={{ color: '#c88c00' }}>
                  {notes.trim().split(/\s+/).filter(Boolean).length} words
                </span>
              </div>
            )}
          </div>

          {/* ── Next Step Selection ── */}
          <div className="mb-4">
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: '#8a8078' }}>
              <ArrowRight size={10} />
              Next Step
            </label>

            <div className="grid grid-cols-2 gap-2">
              {/* Schedule Design Meeting */}
              <button
                onClick={() => setSelectedAction(selectedAction === 'schedule' ? null : 'schedule')}
                className="text-left rounded-lg px-3 py-3 transition-all"
                style={{
                  background: selectedAction === 'schedule' ? 'rgba(200,140,0,0.08)' : '#ffffff',
                  border: selectedAction === 'schedule' ? '2px solid #c88c00' : '1px solid rgba(200,140,0,0.15)',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{
                    background: selectedAction === 'schedule' ? '#c88c00' : 'rgba(200,140,0,0.1)',
                  }}>
                    <Calendar size={12} style={{ color: selectedAction === 'schedule' ? '#fff' : '#c88c00' }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color: '#1a1a1a' }}>Schedule Meeting</span>
                </div>
                <p className="text-[11px] ml-8" style={{ color: '#8a8078' }}>Book on-site design consultation</p>
              </button>

              {/* Move to Nurture */}
              <button
                onClick={() => setSelectedAction(selectedAction === 'nurture' ? null : 'nurture')}
                className="text-left rounded-lg px-3 py-3 transition-all"
                style={{
                  background: selectedAction === 'nurture' ? 'rgba(167,139,250,0.08)' : '#ffffff',
                  border: selectedAction === 'nurture' ? '2px solid #a78bfa' : '1px solid rgba(200,140,0,0.15)',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{
                    background: selectedAction === 'nurture' ? '#a78bfa' : 'rgba(167,139,250,0.1)',
                  }}>
                    <Heart size={12} style={{ color: selectedAction === 'nurture' ? '#fff' : '#a78bfa' }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color: '#1a1a1a' }}>Nurture</span>
                </div>
                <p className="text-[11px] ml-8" style={{ color: '#8a8078' }}>Not ready — keep in touch</p>
              </button>
            </div>
          </div>

          {/* ── Schedule fields ── */}
          {selectedAction === 'schedule' && (
            <div className="mb-4 grid grid-cols-2 gap-3 p-3 rounded-lg" style={{ background: 'rgba(200,140,0,0.03)', border: '1px solid rgba(200,140,0,0.08)' }}>
              <div>
                <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8a8078' }}>
                  <Calendar size={9} /> Date
                </label>
                <input
                  type="date"
                  value={appointmentDate}
                  onChange={(e) => setAppointmentDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', color: '#1a1a1a' }}
                />
              </div>
              <div>
                <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8a8078' }}>
                  <Clock size={9} /> Time
                </label>
                <div className="relative">
                  <select
                    value={appointmentTime}
                    onChange={(e) => setAppointmentTime(e.target.value)}
                    className="w-full appearance-none rounded-lg px-3 py-2 text-sm outline-none cursor-pointer"
                    style={{
                      background: '#ffffff',
                      border: `1px solid ${!appointmentTime ? 'rgba(220,80,80,0.3)' : 'rgba(200,140,0,0.15)'}`,
                      color: appointmentTime ? '#1a1a1a' : '#6a6058',
                    }}
                  >
                    <option value="">Select...</option>
                    {TIME_SLOTS.map((t) => (
                      <option key={t} value={t}>{formatTime(t)}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#6a6058' }} />
                </div>
              </div>
              {appointmentDate && appointmentTime && (
                <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(34,197,94,0.08)', color: '#16a34a' }}>
                  <CheckCircle2 size={12} />
                  {new Date(appointmentDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at {formatTime(appointmentTime)}
                </div>
              )}
            </div>
          )}

          {/* Nurture confirmation */}
          {selectedAction === 'nurture' && (
            <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(167,139,250,0.08)', color: '#7c3aed' }}>
              <Heart size={12} />
              Will be moved to the Nurture pipeline stage
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
              <X size={12} /> {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: canSubmit && !loading
                ? (selectedAction === 'nurture' ? '#a78bfa' : '#c88c00')
                : 'rgba(200,140,0,0.12)',
              color: canSubmit && !loading ? '#ffffff' : '#8a8078',
              cursor: canSubmit && !loading ? 'pointer' : 'not-allowed',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Processing...
              </>
            ) : !lead ? (
              'Select a lead above'
            ) : !selectedAction ? (
              'Choose a next step'
            ) : selectedAction === 'schedule' ? (
              <>
                <Calendar size={14} />
                Schedule Design Meeting
              </>
            ) : (
              <>
                <Heart size={14} />
                Move to Nurture
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
