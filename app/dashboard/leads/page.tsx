// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import {
  UserPlus, Check, Phone, Mail, MapPin, Home, FileText,
  Calendar, Clock, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronRight,
  TrendingUp, Target, PhoneCall, BarChart3, Users, ArrowRight, RefreshCw,
  Shield, Eye, Trash2, AlertTriangle, ExternalLink,
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
}

interface KpiData {
  kpis: {
    totalLeads12m: number;
    totalLeadsPrior: number;
    totalLeadsChange: number | null;
    securedClients12m: number;
    securedClientsPrior: number;
    securedClientsChange: number | null;
    onsiteVisits12m: number;
    onsiteVisitsPrior: number;
    onsiteVisitsChange: number | null;
    discoveryCalls12m: number;
    discoveryCallsPrior: number;
    discoveryCallsChange: number | null;
    conversionRate12m: number;
    conversionRatePrior: number;
    conversionRateChange: number | null;
    newLeadsThisWeek: number;
    newLeadsThisMonth: number;
    activeLeads: number;
    totalPipeline: number;
  };
  pipelineBreakdown: { stage: string; count: number; stageId: string }[];
  funnel: { label: string; value: number }[];
  monthlyTrend: { month: string; leads: number; secured: number }[];
  recentLeads: { id: string; name: string; stage: string; status: string; createdAt: string; contactName: string }[];
  pendingNewLeads: PendingLead[];
}

const INITIAL_FORM: FormData = {
  firstName: '', lastName: '', phone: '', email: '',
  address: '', city: '', state: 'PA', zip: '',
  projectType: '', description: '', referralSource: '', budgetRange: '',
  nextStep: 'none', appointmentDate: '', appointmentTime: '',
};

const PROJECT_TYPES = ['Kitchen', 'Bathroom', 'Addition', 'Whole-Home Remodel', 'Other'];
const REFERRAL_SOURCES = ['Referral', 'Website', 'Google', 'Houzz', 'Drive-By', 'Repeat Client', 'Other'];
const BUDGET_RANGES = ['Under $50K', '$50K–$100K', '$100K–$250K', '$250K–$500K', '$500K+', 'Not Sure'];

const STAGE_COLORS: Record<string, string> = {
  'New Inquiry': '#8a8078',
  'Initial Call Scheduled': '#60a5fa',
  'Discovery Scheduled': '#60a5fa',
  'No Show': '#ef4444',
  'Nurture': '#a78bfa',
  'Estimating': '#CDA274',
  'In Design': '#4ade80',
  'Ready': '#34d399',
  'In Production': '#2dd4bf',
  'Final Billing': '#fbbf24',
  'Completed': '#22c55e',
  'Closed Not Interested': '#6b7280',
  'On Hold': '#9ca3af',
};

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

/* ── Styled Select ── */
function StyledSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder: string;
}) {
  return (
    <div className="relative">
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm outline-none cursor-pointer"
        style={{ background: '#141414', border: '1px solid rgba(205,162,116,0.15)', color: value ? '#e8e0d8' : '#6a6058' }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#6a6058' }} />
    </div>
  );
}

/* ── Styled Input ── */
function StyledInput({ value, onChange, placeholder, type = 'text', required = false }: {
  value: string; onChange: (v: string) => void; placeholder: string; type?: string; required?: boolean;
}) {
  return (
    <input
      type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
      style={{ background: '#141414', border: `1px solid ${required && !value ? 'rgba(220,80,80,0.4)' : 'rgba(205,162,116,0.15)'}`, color: '#e8e0d8' }}
    />
  );
}

/* ── Section Header ── */
function SectionHeader({ number, title, icon: Icon, complete }: {
  number: number; title: string; icon: any; complete: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
        style={{ background: complete ? '#CDA274' : 'rgba(205,162,116,0.12)', color: complete ? '#1a1a1a' : '#8a8078' }}
      >
        {complete ? <Check size={14} strokeWidth={3} /> : <span className="text-xs font-bold">{number}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Icon size={16} style={{ color: complete ? '#CDA274' : '#8a8078' }} />
        <span className="text-sm font-semibold" style={{ color: complete ? '#CDA274' : '#e8e0d8' }}>{title}</span>
      </div>
    </div>
  );
}

/* ── KPI Card with YoY comparison ── */
function KpiCard({ label, value, icon: Icon, accent, sub, change, prior }: {
  label: string; value: string | number; icon: any; accent?: string; sub?: string;
  change?: number | null; prior?: string | number;
}) {
  const showChange = change !== null && change !== undefined;
  const isPositive = (change ?? 0) > 0;
  const isNeutral = change === 0 || change === null;
  const changeColor = isNeutral ? '#8a8078' : isPositive ? '#4ade80' : '#f87171';
  const changeArrow = isPositive ? '↑' : (change ?? 0) < 0 ? '↓' : '→';

  return (
    <div className="rounded-lg p-4" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} style={{ color: accent || '#8a8078' }} />
        <span className="text-xs uppercase tracking-wider" style={{ color: '#8a8078' }}>{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <div className="text-2xl font-bold" style={{ color: accent || '#e8e0d8' }}>{value}</div>
        {showChange && (
          <span className="text-xs font-semibold mb-1 px-1.5 py-0.5 rounded" style={{
            background: isNeutral ? 'rgba(138,128,120,0.1)' : isPositive ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
            color: changeColor,
          }}>
            {changeArrow} {Math.abs(change ?? 0)}%
          </span>
        )}
      </div>
      <div className="text-xs mt-1" style={{ color: '#6a6058' }}>
        {sub}
        {prior !== undefined && <span className="ml-1">({prior} prior yr)</span>}
      </div>
    </div>
  );
}

/* ── Funnel Bar Chart ── */
function FunnelChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const colors = ['#8a8078', '#60a5fa', '#a78bfa', '#CDA274', '#4ade80'];
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs" style={{ color: '#e8e0d8' }}>{d.label}</span>
            <span className="text-xs font-bold" style={{ color: colors[i] || '#CDA274' }}>{d.value}</span>
          </div>
          <div className="h-5 rounded-md overflow-hidden" style={{ background: 'rgba(205,162,116,0.06)' }}>
            <div
              className="h-full rounded-md transition-all duration-700"
              style={{
                width: `${Math.max((d.value / max) * 100, 2)}%`,
                background: `linear-gradient(90deg, ${colors[i] || '#CDA274'}, ${colors[i] || '#CDA274'}88)`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Monthly Trend Chart ── */
function MonthlyTrendChart({ data }: { data: { month: string; leads: number; secured: number }[] }) {
  const max = Math.max(...data.map(d => Math.max(d.leads, d.secured)), 1);
  const chartH = 120;
  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#60a5fa' }} />
          <span className="text-xs" style={{ color: '#8a8078' }}>New Leads</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#4ade80' }} />
          <span className="text-xs" style={{ color: '#8a8078' }}>Secured</span>
        </div>
      </div>
      <div className="flex items-end gap-2" style={{ height: chartH }}>
        {data.map((d) => (
          <div key={d.month} className="flex-1 flex flex-col items-center gap-0.5" style={{ height: '100%' }}>
            <div className="flex-1 w-full flex items-end justify-center gap-0.5">
              <div
                className="rounded-t-sm transition-all duration-500"
                style={{
                  width: '40%',
                  height: `${Math.max((d.leads / max) * 100, 4)}%`,
                  background: '#60a5fa',
                }}
                title={`${d.leads} leads`}
              />
              <div
                className="rounded-t-sm transition-all duration-500"
                style={{
                  width: '40%',
                  height: `${Math.max((d.secured / max) * 100, 4)}%`,
                  background: '#4ade80',
                }}
                title={`${d.secured} secured`}
              />
            </div>
            <span className="text-[10px] mt-1" style={{ color: '#6a6058' }}>{d.month}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LEADS DASHBOARD PAGE
   ═══════════════════════════════════════════════════════════════════ */
export default function LeadsPage() {
  const [form, setForm] = useState<FormData>({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [formExpanded, setFormExpanded] = useState(false);
  const formContentRef = useRef<HTMLDivElement>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  // KPI state
  const [kpiData, setKpiData] = useState<KpiData | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [kpiError, setKpiError] = useState('');

  const loadKpis = async () => {
    setKpiLoading(true);
    setKpiError('');
    try {
      const res = await fetch('/api/dashboard/leads-kpi');
      if (!res.ok) throw new Error('Failed to load KPIs');
      const data = await res.json();
      setKpiData(data);
    } catch (err: any) {
      setKpiError(err.message);
    } finally {
      setKpiLoading(false);
    }
  };

  // Spam handling state
  const [spamLoading, setSpamLoading] = useState<string | null>(null); // opportunityId being processed
  const [spamConfirm, setSpamConfirm] = useState<string | null>(null); // opportunityId awaiting confirm

  const handleMarkSpam = async (lead: PendingLead) => {
    setSpamLoading(lead.id);
    try {
      const res = await fetch('/api/dashboard/leads-spam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ opportunityId: lead.id, contactId: lead.contactId }),
      });
      if (!res.ok) throw new Error('Failed to remove spam');
      setSpamConfirm(null);
      loadKpis(); // Refresh all data
    } catch (err: any) {
      console.error('Spam removal failed:', err);
      alert('Failed to remove spam lead. Please try again.');
    } finally {
      setSpamLoading(null);
    }
  };

  useEffect(() => { loadKpis(); }, []);

  const update = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  const section1Complete = !!(form.firstName && form.lastName && form.phone);
  const section2Complete = !!(form.projectType);
  const section3Complete = form.nextStep === 'none' || !!(form.appointmentDate && form.appointmentTime);

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create lead');
      setResult(data);
      setSubmitted(true);
      // Refresh KPIs after creating a lead
      loadKpis();
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setForm({ ...INITIAL_FORM });
    setSubmitted(false);
    setResult(null);
    setError('');
    setFormExpanded(true);
    setTimeout(() => firstNameRef.current?.focus(), 200);
  };

  const kpis = kpiData?.kpis;

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#CDA274', fontFamily: 'Georgia, serif' }}>
            Leads
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
            Enter new leads and track your sales pipeline
          </p>
        </div>
        <button
          onClick={loadKpis}
          disabled={kpiLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
          style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)', color: '#8a8078' }}
        >
          <RefreshCw size={12} className={kpiLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* KPI Cards Row */}
      {kpiLoading && !kpiData ? (
        <div className="flex items-center justify-center gap-2 py-8" style={{ color: '#8a8078' }}>
          <Loader2 size={16} className="animate-spin" /> Loading pipeline data...
        </div>
      ) : kpiError && !kpiData ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-6 text-xs" style={{ background: 'rgba(220,80,80,0.1)', color: '#f87171' }}>
          <AlertCircle size={14} /> {kpiError}
        </div>
      ) : kpis ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KpiCard
              label="Total Leads (12mo)"
              value={kpis.totalLeads12m}
              icon={UserPlus}
              accent="#4ade80"
              change={kpis.totalLeadsChange}
              prior={kpis.totalLeadsPrior}
              sub={`${kpis.newLeadsThisWeek} this week`}
            />
            <KpiCard
              label="On-Site Visits (12mo)"
              value={kpis.onsiteVisits12m}
              icon={MapPin}
              accent="#a78bfa"
              change={kpis.onsiteVisitsChange}
              prior={kpis.onsiteVisitsPrior}
              sub={`${kpis.discoveryCalls12m} discovery calls`}
            />
            <KpiCard
              label="Secured Clients (12mo)"
              value={kpis.securedClients12m}
              icon={Shield}
              accent="#4ade80"
              change={kpis.securedClientsChange}
              prior={kpis.securedClientsPrior}
              sub="In Design or beyond"
            />
            <KpiCard
              label="Conversion Rate"
              value={`${kpis.conversionRate12m}%`}
              icon={Target}
              accent="#CDA274"
              change={kpis.conversionRateChange}
              prior={`${kpis.conversionRatePrior}%`}
              sub={`${kpis.totalPipeline} open in pipeline`}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Funnel Chart */}
            <div className="rounded-xl p-4" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.12)' }}>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={14} style={{ color: '#CDA274' }} />
                <span className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>Lead Funnel</span>
                <span className="text-xs ml-auto" style={{ color: '#6a6058' }}>Last 12 months</span>
              </div>
              <FunnelChart data={kpiData!.funnel} />
            </div>

            {/* Monthly Trend */}
            <div className="rounded-xl p-4" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.12)' }}>
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={14} style={{ color: '#CDA274' }} />
                <span className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>Monthly Trend</span>
                <span className="text-xs ml-auto" style={{ color: '#6a6058' }}>12 months</span>
              </div>
              <MonthlyTrendChart data={kpiData!.monthlyTrend} />
            </div>
          </div>
        </>
      ) : null}

      {/* ═══ Pending New Leads ═══ */}
      {kpiData && kpiData.pendingNewLeads && kpiData.pendingNewLeads.length > 0 && (
        <div className="rounded-xl overflow-hidden mb-6" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.12)' }}>
          <div className="flex items-center gap-2 px-5 py-3" style={{ background: '#242424', borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
            <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
            <span className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>Pending New Leads</span>
            <span className="text-xs px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
              {kpiData.pendingNewLeads.length} awaiting contact
            </span>
            <span className="text-xs ml-auto" style={{ color: '#6a6058' }}>
              Needs discovery call scheduled
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: 'rgba(205,162,116,0.06)' }}>
            {kpiData.pendingNewLeads.map((lead) => (
              <div key={lead.id} className="px-5 py-3 flex items-start gap-4">
                {/* Lead Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>
                      {lead.contactName || lead.name}
                    </span>
                    {lead.daysPending > 3 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                        background: lead.daysPending > 7 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                        color: lead.daysPending > 7 ? '#ef4444' : '#f59e0b',
                      }}>
                        {lead.daysPending}d waiting
                      </span>
                    )}
                    {lead.source && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(205,162,116,0.1)', color: '#8a8078' }}>
                        {lead.source}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs" style={{ color: '#8a8078' }}>
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} className="flex items-center gap-1 hover:opacity-80" style={{ color: '#60a5fa' }}>
                        <Phone size={10} /> {lead.phone}
                      </a>
                    )}
                    {lead.email && (
                      <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:opacity-80" style={{ color: '#60a5fa' }}>
                        <Mail size={10} /> {lead.email}
                      </a>
                    )}
                    <span style={{ color: '#6a6058' }}>{new Date(lead.createdAt).toLocaleDateString()}</span>
                  </div>
                  {lead.tags && lead.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {lead.tags.filter((t: string) => t !== 'Dashboard Lead').slice(0, 4).map((tag: string) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(205,162,116,0.08)', color: '#6a6058' }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                  {spamConfirm === lead.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs" style={{ color: '#f87171' }}>Delete lead?</span>
                      <button
                        onClick={() => handleMarkSpam(lead)}
                        disabled={spamLoading === lead.id}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                        style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                      >
                        {spamLoading === lead.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                        Yes
                      </button>
                      <button
                        onClick={() => setSpamConfirm(null)}
                        className="px-2 py-1 rounded text-xs transition-all"
                        style={{ background: '#242424', color: '#8a8078', border: '1px solid rgba(205,162,116,0.12)' }}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setSpamConfirm(lead.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all hover:opacity-80"
                      style={{ background: 'rgba(239,68,68,0.08)', color: '#8a8078', border: '1px solid rgba(239,68,68,0.12)' }}
                      title="Mark as spam — deletes contact and opportunity"
                    >
                      <Trash2 size={10} /> Spam
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Three Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ═══ LEFT COLUMN: New Lead Form ═══ */}
        <div className="lg:col-span-3">
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.12)' }}
          >
            {/* Form header — clickable toggle */}
            <button
              onClick={() => {
                setFormExpanded((prev) => !prev);
                if (!formExpanded) setTimeout(() => firstNameRef.current?.focus(), 200);
              }}
              className="w-full flex items-center gap-2 px-5 py-3 cursor-pointer"
              style={{ background: '#242424', borderBottom: formExpanded ? '1px solid rgba(205,162,116,0.08)' : 'none' }}
            >
              <UserPlus size={16} style={{ color: '#CDA274' }} />
              <span className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>New Lead</span>
              {!submitted && formExpanded && (
                <div className="flex gap-1.5 ml-auto mr-2">
                  {[section1Complete, section2Complete, section3Complete].map((done, i) => (
                    <div key={i} className="w-2 h-2 rounded-full transition-all" style={{ background: done ? '#CDA274' : 'rgba(205,162,116,0.15)' }} />
                  ))}
                </div>
              )}
              {!formExpanded && (
                <span className="text-xs ml-auto mr-2" style={{ color: '#6a6058' }}>Click to expand</span>
              )}
              <div className="transition-transform duration-200" style={{ transform: formExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                <ChevronRight size={16} style={{ color: '#8a8078' }} />
              </div>
            </button>

            {/* Form content — collapsible */}
            <div
              ref={formContentRef}
              className="overflow-hidden transition-all duration-300 ease-in-out"
              style={{ maxHeight: formExpanded ? '2000px' : '0px', opacity: formExpanded ? 1 : 0 }}
            >
            <div className="px-5 py-5 space-y-5">
              {submitted && result ? (
                <div className="text-center py-8">
                  <CheckCircle2 size={48} className="mx-auto mb-4" style={{ color: '#CDA274' }} />
                  <h3 className="text-lg font-semibold mb-2" style={{ color: '#e8e0d8' }}>Lead Created!</h3>
                  <p className="text-sm mb-4" style={{ color: '#8a8078' }}>
                    {form.firstName} {form.lastName} has been added to the pipeline.
                  </p>
                  <div
                    className="rounded-lg px-4 py-3 text-left text-sm space-y-1.5 mb-6 mx-auto max-w-sm"
                    style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)' }}
                  >
                    <div style={{ color: '#8a8078' }}>Stage: <span style={{ color: '#CDA274' }}>{result.stage}</span></div>
                    {result.appointmentId && (
                      <div style={{ color: '#8a8078' }}>Appointment: <span style={{ color: '#e8e0d8' }}>{form.appointmentDate} at {formatTime(form.appointmentTime)}</span></div>
                    )}
                    {result.jtJobCreated && (
                      <div style={{ color: '#8a8078' }}>JobTread: <span style={{ color: '#4ade80' }}>Job auto-created</span></div>
                    )}
                  </div>
                  <button onClick={resetForm} className="px-6 py-2.5 rounded-lg text-sm font-medium" style={{ background: '#CDA274', color: '#1a1a1a' }}>
                    Add Another Lead
                  </button>
                </div>
              ) : (
                <>
                  {/* Section 1: Contact Info */}
                  <div>
                    <SectionHeader number={1} title="Contact Info" icon={Phone} complete={section1Complete} />
                    <div className="space-y-3 ml-10">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>First Name <span style={{ color: '#ef4444' }}>*</span></label>
                          <input ref={firstNameRef} type="text" value={form.firstName} onChange={(e) => update('firstName', e.target.value)} placeholder="Jane"
                            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                            style={{ background: '#141414', border: `1px solid ${!form.firstName && error ? 'rgba(220,80,80,0.4)' : 'rgba(205,162,116,0.15)'}`, color: '#e8e0d8' }}
                          />
                        </div>
                        <div>
                          <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Last Name <span style={{ color: '#ef4444' }}>*</span></label>
                          <StyledInput value={form.lastName} onChange={(v) => update('lastName', v)} placeholder="Smith" required />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Phone <span style={{ color: '#ef4444' }}>*</span></label>
                        <StyledInput value={form.phone} onChange={(v) => update('phone', v)} placeholder="(215) 555-1234" type="tel" required />
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Email</label>
                        <StyledInput value={form.email} onChange={(v) => update('email', v)} placeholder="jane@example.com" type="email" />
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Project Details */}
                  <div>
                    <SectionHeader number={2} title="Project Details" icon={Home} complete={section2Complete} />
                    <div className="space-y-3 ml-10">
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Project Type <span style={{ color: '#ef4444' }}>*</span></label>
                        <StyledSelect value={form.projectType} onChange={(v) => update('projectType', v)} options={PROJECT_TYPES} placeholder="Select type..." />
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Project Address</label>
                        <StyledInput value={form.address} onChange={(v) => update('address', v)} placeholder="123 Main St" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div><label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>City</label><StyledInput value={form.city} onChange={(v) => update('city', v)} placeholder="Perkasie" /></div>
                        <div><label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>State</label><StyledInput value={form.state} onChange={(v) => update('state', v)} placeholder="PA" /></div>
                        <div><label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>ZIP</label><StyledInput value={form.zip} onChange={(v) => update('zip', v)} placeholder="18944" /></div>
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>How Did They Hear About Us?</label>
                        <StyledSelect value={form.referralSource} onChange={(v) => update('referralSource', v)} options={REFERRAL_SOURCES} placeholder="Select source..." />
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Approximate Budget</label>
                        <StyledSelect value={form.budgetRange} onChange={(v) => update('budgetRange', v)} options={BUDGET_RANGES} placeholder="Select range..." />
                      </div>
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Brief Description</label>
                        <textarea value={form.description} onChange={(e) => update('description', e.target.value)}
                          placeholder="What are they looking to do? Any details from the call..." rows={3}
                          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
                          style={{ background: '#141414', border: '1px solid rgba(205,162,116,0.15)', color: '#e8e0d8' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Next Step */}
                  <div>
                    <SectionHeader number={3} title="Next Step" icon={Calendar} complete={section3Complete} />
                    <div className="space-y-3 ml-10">
                      <div className="space-y-2">
                        {[
                          { key: 'discovery_call' as const, label: 'Schedule Discovery Call', sublabel: 'Phone/video call with Nathan', icon: Phone },
                          { key: 'onsite_visit' as const, label: 'Schedule On-Site Visit', sublabel: 'In-person meeting at the property', icon: MapPin },
                          { key: 'none' as const, label: 'Save Without Scheduling', sublabel: 'Add to pipeline as New Inquiry', icon: FileText },
                        ].map((opt) => {
                          const selected = form.nextStep === opt.key;
                          const Icon = opt.icon;
                          return (
                            <button key={opt.key} onClick={() => {
                              update('nextStep', opt.key);
                              if (opt.key === 'none') { update('appointmentDate', ''); update('appointmentTime', ''); }
                              else if (!form.appointmentDate) { update('appointmentDate', defaultDate); }
                            }}
                              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all"
                              style={{ background: selected ? 'rgba(205,162,116,0.1)' : '#242424', border: `1px solid ${selected ? 'rgba(205,162,116,0.4)' : 'rgba(205,162,116,0.08)'}` }}
                            >
                              <Icon size={16} style={{ color: selected ? '#CDA274' : '#6a6058' }} />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium" style={{ color: selected ? '#CDA274' : '#e8e0d8' }}>{opt.label}</div>
                                <div className="text-xs" style={{ color: '#6a6058' }}>{opt.sublabel}</div>
                              </div>
                              {selected && <Check size={16} style={{ color: '#CDA274' }} />}
                            </button>
                          );
                        })}
                      </div>
                      {form.nextStep !== 'none' && (
                        <div className="rounded-lg p-3 space-y-3" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}>
                          <div className="flex items-center gap-2 mb-2">
                            <Clock size={14} style={{ color: '#CDA274' }} />
                            <span className="text-xs font-medium" style={{ color: '#CDA274' }}>
                              {form.nextStep === 'discovery_call' ? 'Discovery Call' : 'On-Site Visit'} — Nathan&apos;s Calendar
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Date</label>
                              <input type="date" value={form.appointmentDate} onChange={(e) => update('appointmentDate', e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                                style={{ background: '#141414', border: '1px solid rgba(205,162,116,0.15)', color: '#e8e0d8', colorScheme: 'dark' }}
                              />
                            </div>
                            <div>
                              <label className="text-xs mb-1 block" style={{ color: '#8a8078' }}>Time</label>
                              <select value={form.appointmentTime} onChange={(e) => update('appointmentTime', e.target.value)}
                                className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm outline-none cursor-pointer"
                                style={{ background: '#141414', border: '1px solid rgba(205,162,116,0.15)', color: form.appointmentTime ? '#e8e0d8' : '#6a6058' }}
                              >
                                <option value="">Select time...</option>
                                {timeSlots.map((t) => <option key={t} value={t}>{formatTime(t)}</option>)}
                              </select>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Error + Submit */}
                  <div className="pt-2">
                    {error && (
                      <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg mb-3" style={{ background: 'rgba(220,80,80,0.1)', color: '#f87171' }}>
                        <AlertCircle size={14} /> {error}
                      </div>
                    )}
                    <button onClick={handleSubmit} disabled={submitting || !section1Complete}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
                      style={{ background: section1Complete ? '#CDA274' : 'rgba(205,162,116,0.3)', color: '#1a1a1a' }}
                    >
                      {submitting ? <><Loader2 size={16} className="animate-spin" /> Creating Lead...</> : <><UserPlus size={16} /> Create Lead{form.nextStep !== 'none' && ' & Schedule'}</>}
                    </button>
                    <p className="text-center text-xs mt-2" style={{ color: '#6a6058' }}>
                      {form.nextStep === 'discovery_call' && 'Stage → Discovery Scheduled'}
                      {form.nextStep === 'onsite_visit' && 'Stage → Estimating (auto-creates JobTread job)'}
                      {form.nextStep === 'none' && 'Stage → New Inquiry'}
                    </p>
                  </div>
                </>
              )}
            </div>
            </div>{/* end collapsible wrapper */}
          </div>
        </div>

        {/* ═══ RIGHT COLUMN: Pipeline + Recent Leads ═══ */}
        <div className="lg:col-span-2 space-y-4">

          {/* Pipeline Breakdown */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.12)' }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ background: '#242424', borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
              <BarChart3 size={14} style={{ color: '#CDA274' }} />
              <span className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>Sales Pipeline</span>
              {kpis && <span className="text-xs ml-auto" style={{ color: '#6a6058' }}>{kpis.totalPipeline} open</span>}
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {kpiData ? kpiData.pipelineBreakdown.map((row) => (
                <div key={row.stage} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STAGE_COLORS[row.stage] || '#8a8078' }} />
                  <span className="text-sm flex-1" style={{ color: '#e8e0d8' }}>{row.stage}</span>
                  <span className="text-sm font-bold" style={{ color: STAGE_COLORS[row.stage] || '#CDA274' }}>{row.count}</span>
                </div>
              )) : (
                <div className="py-4 text-center text-xs" style={{ color: '#6a6058' }}>Loading...</div>
              )}
            </div>
          </div>

          {/* Recent Leads */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.12)' }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ background: '#242424', borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
              <Users size={14} style={{ color: '#CDA274' }} />
              <span className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>Recent Leads</span>
            </div>
            <div className="divide-y" style={{ borderColor: 'rgba(205,162,116,0.06)' }}>
              {kpiData && kpiData.recentLeads.length > 0 ? kpiData.recentLeads.slice(0, 8).map((lead) => (
                <div key={lead.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STAGE_COLORS[lead.stage] || '#8a8078' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: '#e8e0d8' }}>{lead.name}</div>
                    <div className="text-xs" style={{ color: STAGE_COLORS[lead.stage] || '#6a6058' }}>{lead.stage}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs" style={{ color: '#6a6058' }}>{timeAgo(lead.createdAt)}</div>
                    {lead.status !== 'open' && (
                      <div className="text-[10px] uppercase" style={{ color: lead.status === 'lost' ? '#ef4444' : '#f59e0b' }}>{lead.status}</div>
                    )}
                  </div>
                </div>
              )) : (
                <div className="px-4 py-8 text-center">
                  <Users size={32} className="mx-auto mb-3" style={{ color: 'rgba(205,162,116,0.2)' }} />
                  <p className="text-sm" style={{ color: '#8a8078' }}>No recent leads</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
