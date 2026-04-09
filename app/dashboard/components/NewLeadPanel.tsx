// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import {
  X, UserPlus, Check, Phone, Mail, MapPin, Home, FileText,
  Calendar, Clock, Loader2, CheckCircle2, AlertCircle, ChevronDown,
} from 'lucide-react';

/* ── Types ── */
interface FormData {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  projectType: string;
  description: string;
  referralSource: string;
  budgetRange: string;
  nextStep: 'none' | 'discovery_call' | 'onsite_visit';
  appointmentDate: string;
  appointmentTime: string;
}

const INITIAL_FORM: FormData = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  state: 'PA',
  zip: '',
  projectType: '',
  description: '',
  referralSource: '',
  budgetRange: '',
  nextStep: 'none',
  appointmentDate: '',
  appointmentTime: '',
};

const PROJECT_TYPES = ['Kitchen', 'Bathroom', 'Addition', 'Whole-Home Remodel', 'Other'];
const REFERRAL_SOURCES = ['Referral', 'Website', 'Google', 'Houzz', 'Drive-By', 'Repeat Client', 'Other'];
const BUDGET_RANGES = ['Under $50K', '$50K–$100K', '$100K–$250K', '$250K–$500K', '$500K+', 'Not Sure'];

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

/* ── Styled Select ── */
function StyledSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm outline-none cursor-pointer"
        style={{
          background: '#ffffff',
          border: '1px solid rgba(200,140,0,0.15)',
          color: value ? '#1a1a1a' : '#6a6058',
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: '#6a6058' }}
      />
    </div>
  );
}

/* ── Styled Input ── */
function StyledInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
      style={{
        background: '#ffffff',
        border: `1px solid ${required && !value ? 'rgba(220,80,80,0.4)' : 'rgba(200,140,0,0.15)'}`,
        color: '#1a1a1a',
      }}
    />
  );
}

/* ── Section Header with checkmark ── */
function SectionHeader({
  number,
  title,
  icon: Icon,
  complete,
}: {
  number: number;
  title: string;
  icon: any;
  complete: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
        style={{
          background: complete ? '#c88c00' : 'rgba(200,140,0,0.12)',
          color: complete ? '#ffffff' : '#8a8078',
        }}
      >
        {complete ? <Check size={14} strokeWidth={3} /> : <span className="text-xs font-bold">{number}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Icon size={16} style={{ color: complete ? '#c88c00' : '#8a8078' }} />
        <span
          className="text-sm font-semibold"
          style={{ color: complete ? '#c88c00' : '#1a1a1a' }}
        >
          {title}
        </span>
      </div>
    </div>
  );
}

/* ═══════════ MAIN COMPONENT ═══════════ */
export default function NewLeadPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormData>({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  // Focus first field when panel opens
  useEffect(() => {
    if (isOpen && !submitted) {
      setTimeout(() => firstNameRef.current?.focus(), 300);
    }
  }, [isOpen, submitted]);

  // Reset form when panel closes
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setForm({ ...INITIAL_FORM });
        setSubmitted(false);
        setError('');
        setResult(null);
      }, 300);
    }
  }, [isOpen]);

  const update = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  // Section completion checks
  const section1Complete = !!(form.firstName && form.lastName && form.phone);
  const section2Complete = !!(form.projectType);
  const section3Complete = form.nextStep === 'none' || !!(form.appointmentDate && form.appointmentTime);

  // Generate default appointment date (tomorrow) and time slots
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().split('T')[0];

  const timeSlots: string[] = [];
  for (let h = 8; h <= 17; h++) {
    timeSlots.push(`${h.toString().padStart(2, '0')}:00`);
    if (h < 17) timeSlots.push(`${h.toString().padStart(2, '0')}:30`);
  }

  const formatTime = (t: string) => {
    if (!t) return '';
    const [hh, mm] = t.split(':');
    const h = parseInt(hh);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${mm} ${ampm}`;
  };

  /* ── Submit ── */
  const handleSubmit = async () => {
    if (!form.firstName || !form.lastName || !form.phone) {
      setError('Please fill in first name, last name, and phone number.');
      return;
    }
    if (form.nextStep !== 'none' && (!form.appointmentDate || !form.appointmentTime)) {
      setError('Please select a date and time for the appointment.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/dashboard/create-lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create lead');

      setResult(data);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:bg-black/30"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`
          fixed top-0 right-0 z-50 h-full w-full md:w-[460px] flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
        style={{
          background: '#ffffff',
          borderLeft: '1px solid rgba(200,140,0,0.15)',
          boxShadow: isOpen ? '-4px 0 24px rgba(0,0,0,0.4)' : 'none',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ background: '#f8f6f3', borderBottom: '1px solid rgba(200,140,0,0.12)' }}
        >
          <div className="flex items-center gap-2">
            <UserPlus size={18} style={{ color: '#c88c00' }} />
            <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
              New Lead
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10">
            <X size={18} style={{ color: '#8a8078' }} />
          </button>
        </div>

        {/* Progress indicator */}
        {!submitted && (
          <div className="px-4 py-2 flex gap-2 flex-shrink-0" style={{ borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
            {[section1Complete, section2Complete, section3Complete].map((done, i) => (
              <div
                key={i}
                className="flex-1 h-1.5 rounded-full transition-all"
                style={{
                  background: done ? '#c88c00' : 'rgba(200,140,0,0.12)',
                }}
              />
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5" style={{ minHeight: 0 }}>
          {submitted && result ? (
            /* ── Success State ── */
            <div className="text-center py-12">
              <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: '#c88c00' }} />
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#1a1a1a' }}>
                Lead Created!
              </h3>
              <p className="text-sm mb-4" style={{ color: '#8a8078' }}>
                {form.firstName} {form.lastName} has been added to the pipeline.
              </p>
              <div
                className="rounded-lg px-4 py-3 text-left text-sm space-y-1.5 mb-6"
                style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.12)' }}
              >
                <div style={{ color: '#8a8078' }}>
                  Stage: <span style={{ color: '#c88c00' }}>{result.stage}</span>
                </div>
                {result.appointmentId && (
                  <div style={{ color: '#8a8078' }}>
                    Appointment: <span style={{ color: '#1a1a1a' }}>
                      {form.appointmentDate} at {formatTime(form.appointmentTime)}
                    </span>
                  </div>
                )}
                {result.jtJobCreated && (
                  <div style={{ color: '#8a8078' }}>
                    JobTread: <span style={{ color: '#4ade80' }}>Job auto-created</span>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setForm({ ...INITIAL_FORM });
                    setSubmitted(false);
                    setResult(null);
                    setTimeout(() => firstNameRef.current?.focus(), 100);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium"
                  style={{ background: '#c88c00', color: '#ffffff' }}
                >
                  Add Another Lead
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium"
                  style={{ background: '#f8f6f3', color: '#1a1a1a', border: '1px solid rgba(200,140,0,0.15)' }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* ══════ Section 1: Contact Info ══════ */}
              <div>
                <SectionHeader number={1} title="Contact Info" icon={Phone} complete={section1Complete} />
                <div className="space-y-3 ml-10">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>
                        First Name <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        ref={firstNameRef}
                        type="text"
                        value={form.firstName}
                        onChange={(e) => update('firstName', e.target.value)}
                        placeholder="Jane"
                        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={{
                          background: '#ffffff',
                          border: `1px solid ${!form.firstName && error ? 'rgba(220,80,80,0.4)' : 'rgba(200,140,0,0.15)'}`,
                          color: '#1a1a1a',
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>
                        Last Name <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <StyledInput
                        value={form.lastName}
                        onChange={(v) => update('lastName', v)}
                        placeholder="Smith"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>
                      Phone <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <StyledInput
                      value={form.phone}
                      onChange={(v) => update('phone', v)}
                      placeholder="(215) 555-1234"
                      type="tel"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Email</label>
                    <StyledInput
                      value={form.email}
                      onChange={(v) => update('email', v)}
                      placeholder="jane@example.com"
                      type="email"
                    />
                  </div>
                </div>
              </div>

              {/* ══════ Section 2: Project Details ══════ */}
              <div>
                <SectionHeader number={2} title="Project Details" icon={Home} complete={section2Complete} />
                <div className="space-y-3 ml-10">
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>
                      Project Type <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <StyledSelect
                      value={form.projectType}
                      onChange={(v) => update('projectType', v)}
                      options={PROJECT_TYPES}
                      placeholder="Select type..."
                    />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Project Address</label>
                    <StyledInput
                      value={form.address}
                      onChange={(v) => update('address', v)}
                      placeholder="123 Main St"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>City</label>
                      <StyledInput value={form.city} onChange={(v) => update('city', v)} placeholder="Perkasie" />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>State</label>
                      <StyledInput value={form.state} onChange={(v) => update('state', v)} placeholder="PA" />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>ZIP</label>
                      <StyledInput value={form.zip} onChange={(v) => update('zip', v)} placeholder="18944" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>How Did They Hear About Us?</label>
                    <StyledSelect
                      value={form.referralSource}
                      onChange={(v) => update('referralSource', v)}
                      options={REFERRAL_SOURCES}
                      placeholder="Select source..."
                    />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Approximate Budget</label>
                    <StyledSelect
                      value={form.budgetRange}
                      onChange={(v) => update('budgetRange', v)}
                      options={BUDGET_RANGES}
                      placeholder="Select range..."
                    />
                  </div>
                  <div>
                    <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Brief Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => update('description', e.target.value)}
                      placeholder="What are they looking to do? Any details from the call..."
                      rows={3}
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
                      style={{
                        background: '#ffffff',
                        border: '1px solid rgba(200,140,0,0.15)',
                        color: '#1a1a1a',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* ══════ Section 3: Next Step ══════ */}
              <div>
                <SectionHeader number={3} title="Next Step" icon={Calendar} complete={section3Complete} />
                <div className="space-y-3 ml-10">
                  {/* Three option buttons */}
                  <div className="space-y-2">
                    {[
                      {
                        key: 'discovery_call' as const,
                        label: 'Schedule Discovery Call',
                        sublabel: 'Phone/video call with Nathan',
                        icon: Phone,
                      },
                      {
                        key: 'onsite_visit' as const,
                        label: 'Schedule On-Site Visit',
                        sublabel: 'In-person meeting at the property',
                        icon: MapPin,
                      },
                      {
                        key: 'none' as const,
                        label: 'Save Without Scheduling',
                        sublabel: 'Add to pipeline as New Inquiry',
                        icon: FileText,
                      },
                    ].map((opt) => {
                      const selected = form.nextStep === opt.key;
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => {
                            update('nextStep', opt.key);
                            if (opt.key === 'none') {
                              update('appointmentDate', '');
                              update('appointmentTime', '');
                            } else if (!form.appointmentDate) {
                              update('appointmentDate', defaultDate);
                            }
                          }}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all"
                          style={{
                            background: selected ? 'rgba(200,140,0,0.1)' : '#f8f6f3',
                            border: `1px solid ${selected ? 'rgba(200,140,0,0.4)' : 'rgba(200,140,0,0.08)'}`,
                          }}
                        >
                          <Icon size={16} style={{ color: selected ? '#c88c00' : '#6a6058' }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium" style={{ color: selected ? '#c88c00' : '#1a1a1a' }}>
                              {opt.label}
                            </div>
                            <div className="text-xs" style={{ color: '#6a6058' }}>
                              {opt.sublabel}
                            </div>
                          </div>
                          {selected && <Check size={16} style={{ color: '#c88c00' }} />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Date/Time picker (shown when scheduling) */}
                  {form.nextStep !== 'none' && (
                    <div
                      className="rounded-lg p-3 space-y-3"
                      style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.08)' }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Clock size={14} style={{ color: '#c88c00' }} />
                        <span className="text-xs font-medium" style={{ color: '#c88c00' }}>
                          {form.nextStep === 'discovery_call' ? 'Discovery Call' : 'On-Site Visit'} — Nathan&apos;s Calendar
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Date</label>
                          <input
                            type="date"
                            value={form.appointmentDate}
                            onChange={(e) => update('appointmentDate', e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                            style={{
                              background: '#ffffff',
                              border: '1px solid rgba(200,140,0,0.15)',
                              color: '#1a1a1a',
                              colorScheme: 'dark',
                            }}
                          />
                        </div>
                        <div>
                          <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Time</label>
                          <select
                            value={form.appointmentTime}
                            onChange={(e) => update('appointmentTime', e.target.value)}
                            className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm outline-none cursor-pointer"
                            style={{
                              background: '#ffffff',
                              border: '1px solid rgba(200,140,0,0.15)',
                              color: form.appointmentTime ? '#1a1a1a' : '#6a6058',
                            }}
                          >
                            <option value="">Select time...</option>
                            {timeSlots.map((t) => (
                              <option key={t} value={t}>
                                {formatTime(t)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Spacer so the submit button doesn't overlap content */}
              <div className="h-4" />
            </>
          )}
        </div>

        {/* Footer / Submit — only when not submitted */}
        {!submitted && (
          <div
            className="px-4 py-3 flex-shrink-0 space-y-2"
            style={{
              background: '#f8f6f3',
              borderTop: '1px solid rgba(200,140,0,0.12)',
            }}
          >
            {error && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(220,80,80,0.1)', color: '#f87171' }}>
                <AlertCircle size={14} />
                {error}
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={submitting || !section1Complete}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
              style={{
                background: section1Complete ? '#c88c00' : 'rgba(200,140,0,0.3)',
                color: '#ffffff',
              }}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating Lead...
                </>
              ) : (
                <>
                  <UserPlus size={16} />
                  Create Lead
                  {form.nextStep !== 'none' && ' & Schedule'}
                </>
              )}
            </button>
            <p className="text-center text-xs" style={{ color: '#6a6058' }}>
              {form.nextStep === 'discovery_call' && 'Stage → Discovery Scheduled'}
              {form.nextStep === 'onsite_visit' && 'Stage → Estimating (auto-creates JobTread job)'}
              {form.nextStep === 'none' && 'Stage → New Inquiry'}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
