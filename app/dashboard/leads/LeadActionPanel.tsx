// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import {
  X, Calendar, Clock, Loader2, CheckCircle2,
  ArrowRight, MessageSquare, MapPin, Heart,
  Phone, Mail, ChevronDown, FileText,
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

interface RecentLead {
  id: string;
  name: string;
  stage: string;
  status: string;
  createdAt: string;
  contactName: string;
  contactId?: string;
  phone?: string;
  email?: string;
}

interface LeadActionPanelProps {
  lead: PendingLead | RecentLead | null;
  onClose: () => void;
  onComplete: () => void;
  getToken: () => string;
}

/* ── Time slot generation ── */
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

function timeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const STAGE_COLORS: Record<string, string> = {
  'New Inquiry': '#8a8078',
  'Initial Call Scheduled': '#c88c00',
  'Discovery Scheduled': '#e8c860',
  'No Show': '#ef4444',
  'Nurture': '#a78bfa',
  'Estimating': '#c88c00',
  'In Design': '#22c55e',
};

export default function LeadActionPanel({ lead, onClose, onComplete, getToken }: LeadActionPanelProps) {
  const [selectedAction, setSelectedAction] = useState<'schedule' | 'nurture' | null>(null);
  const [notes, setNotes] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Default date to tomorrow
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setAppointmentDate(tomorrow.toISOString().split('T')[0]);
  }, []);

  // Reset state when lead changes
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

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid catching the opening click
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 100);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick); };
  }, [onClose]);

  if (!lead) return null;

  const contactName = ('contactName' in lead ? lead.contactName : null) || lead.name;
  const contactId = ('contactId' in lead ? lead.contactId : null) || (lead as any).contactId;
  const phone = ('phone' in lead ? lead.phone : null) || (lead as any).phone;
  const email = ('email' in lead ? lead.email : null) || (lead as any).email;
  const stage = lead.stage || (lead as any).stage;
  const daysPending = 'daysPending' in lead ? lead.daysPending : null;

  const canSubmit = selectedAction === 'nurture'
    ? true
    : selectedAction === 'schedule'
      ? !!(appointmentDate && appointmentTime)
      : false;

  const handleSubmit = async () => {
    if (!selectedAction) return;
    setLoading(true);
    setError('');

    try {
      const payload: Record<string, any> = {
        action: selectedAction === 'schedule' ? 'schedule_meeting' : 'move_to_nurture',
        opportunityId: lead.id,
        contactId,
        contactName,
      };

      if (notes.trim()) {
        payload.notes = notes.trim();
      }

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

      // Auto-close after success
      setTimeout(() => {
        onComplete();
        onClose();
      }, 1800);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col overflow-y-auto"
        style={{
          width: '420px',
          maxWidth: '90vw',
          background: '#ffffff',
          boxShadow: '-8px 0 30px rgba(0,0,0,0.12)',
          animation: 'slideIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(200,140,0,0.1)', background: '#f8f6f3' }}>
          <div className="flex items-center gap-2">
            <MessageSquare size={16} style={{ color: '#c88c00' }} />
            <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>Post-Call Actions</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:opacity-70 transition-all" style={{ color: '#8a8078' }}>
            <X size={16} />
          </button>
        </div>

        {/* Lead Info Card */}
        <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base font-semibold" style={{ color: '#1a1a1a' }}>{contactName}</span>
            {stage && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
                background: `${STAGE_COLORS[stage] || '#8a8078'}18`,
                color: STAGE_COLORS[stage] || '#8a8078',
              }}>
                {stage}
              </span>
            )}
            {daysPending != null && daysPending > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
                background: daysPending > 7 ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                color: daysPending > 7 ? '#ef4444' : '#f59e0b',
              }}>
                {daysPending}d waiting
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: '#6a6058' }}>
            {phone && (
              <a href={`tel:${phone}`} className="flex items-center gap-1 hover:opacity-80" style={{ color: '#c88c00' }}>
                <Phone size={10} /> {phone}
              </a>
            )}
            {email && (
              <a href={`mailto:${email}`} className="flex items-center gap-1 hover:opacity-80" style={{ color: '#c88c00' }}>
                <Mail size={10} /> {email}
              </a>
            )}
          </div>
          <div className="text-xs mt-1.5" style={{ color: '#8a8078' }}>
            Created {timeAgo(lead.createdAt)}
          </div>
        </div>

        {/* Success state */}
        {success ? (
          <div className="flex-1 flex items-center justify-center px-5">
            <div className="text-center">
              <CheckCircle2 size={40} className="mx-auto mb-3" style={{ color: '#22c55e' }} />
              <p className="text-sm font-medium" style={{ color: '#1a1a1a' }}>{success}</p>
              {notes.trim() && (
                <p className="text-xs mt-1" style={{ color: '#8a8078' }}>Call notes saved</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 px-5 py-4 space-y-5">

            {/* ── Call Notes ── */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold mb-2" style={{ color: '#6a6058' }}>
                <FileText size={12} />
                CALL NOTES
              </label>
              <textarea
                ref={notesRef}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="How did the discovery call go? Key details, project scope, client preferences, budget discussion..."
                rows={5}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-y"
                style={{
                  background: '#ffffff',
                  border: '1px solid rgba(200,140,0,0.15)',
                  color: '#1a1a1a',
                  minHeight: '100px',
                }}
              />
              <div className="text-right mt-1">
                <span className="text-[10px]" style={{ color: notes.length > 0 ? '#c88c00' : '#ccc' }}>
                  {notes.length > 0 ? `${notes.trim().split(/\s+/).filter(Boolean).length} words` : 'Optional'}
                </span>
              </div>
            </div>

            {/* ── Next Step Selection ── */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color: '#6a6058' }}>
                <ArrowRight size={12} />
                NEXT STEP
              </label>

              <div className="space-y-2">
                {/* Schedule Design Meeting */}
                <button
                  onClick={() => setSelectedAction(selectedAction === 'schedule' ? null : 'schedule')}
                  className="w-full text-left rounded-lg px-4 py-3 transition-all"
                  style={{
                    background: selectedAction === 'schedule' ? 'rgba(200,140,0,0.08)' : '#ffffff',
                    border: selectedAction === 'schedule' ? '2px solid #c88c00' : '1px solid rgba(200,140,0,0.15)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{
                      background: selectedAction === 'schedule' ? '#c88c00' : 'rgba(200,140,0,0.1)',
                    }}>
                      <Calendar size={14} style={{ color: selectedAction === 'schedule' ? '#fff' : '#c88c00' }} />
                    </div>
                    <div>
                      <div className="text-sm font-medium" style={{ color: '#1a1a1a' }}>Schedule Design Meeting</div>
                      <div className="text-xs" style={{ color: '#8a8078' }}>Book an on-site initial design consultation</div>
                    </div>
                  </div>
                </button>

                {/* Schedule fields (animated expand) */}
                {selectedAction === 'schedule' && (
                  <div className="ml-4 pl-4 space-y-3 py-2" style={{ borderLeft: '2px solid rgba(200,140,0,0.15)' }}>
                    {/* Date */}
                    <div>
                      <label className="flex items-center gap-1 text-xs mb-1.5" style={{ color: '#6a6058' }}>
                        <Calendar size={10} /> Date
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

                    {/* Time */}
                    <div>
                      <label className="flex items-center gap-1 text-xs mb-1.5" style={{ color: '#6a6058' }}>
                        <Clock size={10} /> Time
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
                          <option value="">Select time...</option>
                          {TIME_SLOTS.map((t) => (
                            <option key={t} value={t}>{formatTime(t)}</option>
                          ))}
                        </select>
                        <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#6a6058' }} />
                      </div>
                    </div>

                    {appointmentDate && appointmentTime && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(34,197,94,0.08)', color: '#16a34a' }}>
                        <CheckCircle2 size={12} />
                        {new Date(appointmentDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at {formatTime(appointmentTime)}
                      </div>
                    )}
                  </div>
                )}

                {/* Move to Nurture */}
                <button
                  onClick={() => setSelectedAction(selectedAction === 'nurture' ? null : 'nurture')}
                  className="w-full text-left rounded-lg px-4 py-3 transition-all"
                  style={{
                    background: selectedAction === 'nurture' ? 'rgba(167,139,250,0.08)' : '#ffffff',
                    border: selectedAction === 'nurture' ? '2px solid #a78bfa' : '1px solid rgba(200,140,0,0.15)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{
                      background: selectedAction === 'nurture' ? '#a78bfa' : 'rgba(167,139,250,0.1)',
                    }}>
                      <Heart size={14} style={{ color: selectedAction === 'nurture' ? '#fff' : '#a78bfa' }} />
                    </div>
                    <div>
                      <div className="text-sm font-medium" style={{ color: '#1a1a1a' }}>Move to Nurture</div>
                      <div className="text-xs" style={{ color: '#8a8078' }}>Not ready yet — keep in touch for later</div>
                    </div>
                  </div>
                </button>

                {selectedAction === 'nurture' && (
                  <div className="ml-4 pl-4 py-2" style={{ borderLeft: '2px solid rgba(167,139,250,0.2)' }}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(167,139,250,0.08)', color: '#7c3aed' }}>
                      <Heart size={12} />
                      Will be moved to the Nurture pipeline stage
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                <X size={12} /> {error}
              </div>
            )}
          </div>
        )}

        {/* Footer / Submit */}
        {!success && (
          <div className="px-5 py-4 flex-shrink-0 flex items-center gap-3" style={{ borderTop: '1px solid rgba(200,140,0,0.1)', background: '#f8f6f3' }}>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm transition-all hover:opacity-80"
              style={{ background: '#ffffff', color: '#6a6058', border: '1px solid rgba(200,140,0,0.15)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: canSubmit && !loading
                  ? (selectedAction === 'nurture' ? '#a78bfa' : '#c88c00')
                  : 'rgba(200,140,0,0.15)',
                color: canSubmit && !loading ? '#ffffff' : '#8a8078',
                cursor: canSubmit && !loading ? 'pointer' : 'not-allowed',
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Processing...
                </>
              ) : selectedAction === 'schedule' ? (
                <>
                  <Calendar size={14} />
                  Schedule Meeting
                </>
              ) : selectedAction === 'nurture' ? (
                <>
                  <Heart size={14} />
                  Move to Nurture
                </>
              ) : (
                'Select a next step above'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Slide-in animation */}
      <style jsx>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
