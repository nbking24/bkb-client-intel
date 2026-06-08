// @ts-nocheck
'use client';

/**
 * NeedsAttentionZone
 *
 * Top-of-page section on the Leads dashboard that catches the three failure
 * modes Nathan complained about:
 *   1. New leads that have entered Loop with no scheduled call and no
 *      outbound contact in the last 48 hours (the "Susan Williams" case).
 *   2. Upcoming calls / meetings for active leads, sorted chronologically.
 *   3. Stale leads (>7 days with no touch + no booked meeting).
 *
 * Backed by GET /api/dashboard/leads/needs-attention which does the bucketing
 * server-side from Loop opportunities + appointments + ghl_messages cache.
 *
 * Clicking a row fires `onOpenLead(contactId, opportunityId)` so the parent
 * page can open the existing LeadDetailModal with everything we know about
 * that lead.
 */
import { useEffect, useState, useMemo } from 'react';
import {
  AlertTriangle, Calendar, Phone, Mail, Clock, RefreshCw, Loader2,
  CheckCircle2, ChevronDown, ChevronRight, MessageSquareWarning, Hourglass,
} from 'lucide-react';

interface RowBase {
  contactId: string;
  contactName: string;
  phone: string;
  email: string;
  opportunityId: string;
  opportunityName: string;
  stage: string;
  leadCreatedAt: string | null;
  leadAgeHours: number | null;
  lastOutboundAt: string | null;
  hoursSinceLastOutbound: number | null;
}
interface AppointmentRow extends RowBase {
  appointment: {
    id: string;
    title: string;
    kind: 'discovery' | 'onsite' | 'design' | 'followup' | 'meeting';
    startTime: string;
    endTime: string | null;
    status: string;
    calendarName: string | null;
    location: string;
    notes: string;
    whenLabel: string;
  };
}
interface StaleRow extends RowBase {
  daysSinceLastTouch: number;
}

interface NeedsAttentionPayload {
  newUncontacted: RowBase[];
  upcoming: AppointmentRow[];
  stale: StaleRow[];
  nextStepByContact: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' }>;
  counts: {
    newUncontacted: number;
    upcoming: number;
    stale: number;
    totalActive: number;
  };
  generatedAt: string;
}

const GOLD = '#c88c00';
const TONE_BG: Record<string, string> = { bad: '#fff1f0', warn: '#fff8e6', good: '#f1f8f4' };
const TONE_BORDER: Record<string, string> = { bad: '#fda4a4', warn: '#f0c060', good: '#a7d8ba' };
const TONE_TEXT: Record<string, string> = { bad: '#9a1c1c', warn: '#7a5200', good: '#1e6b35' };

function fmtAge(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours)) return '—';
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  return `${d}d`;
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

export default function NeedsAttentionZone({
  onOpenLead,
  reloadKey,
  onData,
}: {
  onOpenLead: (contactId: string, opportunityId: string | null) => void;
  reloadKey?: number;
  // Lets the parent page reuse the nextStepByContact map to render the
  // per-row "Next Step" badge across the existing pipeline lists without
  // refetching.
  onData?: (data: NeedsAttentionPayload) => void;
}) {
  const [data, setData] = useState<NeedsAttentionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The three buckets are independently collapsible. Default: New is open
  // (the most urgent), Upcoming open, Stale collapsed.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    newUncontacted: true,
    upcoming: true,
    stale: false,
  });

  const load = async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/leads/needs-attention', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setData(json);
      if (onData) onData(json);
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [reloadKey]);

  const toggle = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const summary = useMemo(() => {
    if (!data) return '';
    const parts: string[] = [];
    if (data.counts.newUncontacted > 0) parts.push(`${data.counts.newUncontacted} need first touch`);
    if (data.counts.upcoming > 0) parts.push(`${data.counts.upcoming} upcoming`);
    if (data.counts.stale > 0) parts.push(`${data.counts.stale} stale`);
    return parts.join(' · ') || 'All caught up';
  }, [data]);

  return (
    <div
      style={{
        marginBottom: 16,
        borderRadius: 10,
        border: `1px solid ${GOLD}33`,
        background: '#fffdf8',
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <AlertTriangle size={16} style={{ color: GOLD }} />
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#2a2520', margin: 0 }}>
          Needs Your Attention
        </h2>
        <span style={{ fontSize: 12, color: '#6a6058' }}>{summary}</span>
        <button
          onClick={load}
          title="Refresh"
          style={{
            marginLeft: 'auto', padding: 4, borderRadius: 5, border: 'none',
            background: 'rgba(200,140,0,0.08)', cursor: 'pointer', lineHeight: 0,
          }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" style={{ color: GOLD }} /> : <RefreshCw size={13} style={{ color: GOLD }} />}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#9a1c1c', padding: '6px 0' }}>
          {error}
        </div>
      )}

      {!data && !error && (
        <div style={{ fontSize: 12, color: '#6a6058', padding: '6px 0' }}>Loading…</div>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Bucket
            id="newUncontacted"
            label="NEW & UNCONTACTED"
            tone="bad"
            count={data.counts.newUncontacted}
            isOpen={openSections.newUncontacted}
            onToggle={() => toggle('newUncontacted')}
            emptyText="No new leads waiting on first touch. Nice."
          >
            {data.newUncontacted.map((r) => (
              <UncontactedRow key={r.contactId} row={r} onOpen={onOpenLead} />
            ))}
          </Bucket>

          <Bucket
            id="upcoming"
            label="UPCOMING CALLS & MEETINGS"
            tone="good"
            count={data.counts.upcoming}
            isOpen={openSections.upcoming}
            onToggle={() => toggle('upcoming')}
            emptyText="No scheduled calls or meetings in the next 14 days."
          >
            {data.upcoming.map((r) => (
              <UpcomingRow key={`${r.contactId}-${r.appointment.id}`} row={r} onOpen={onOpenLead} />
            ))}
          </Bucket>

          <Bucket
            id="stale"
            label="STALE — NEEDS A NUDGE"
            tone="warn"
            count={data.counts.stale}
            isOpen={openSections.stale}
            onToggle={() => toggle('stale')}
            emptyText="No stale leads. All active leads have been touched recently."
          >
            {data.stale.map((r) => (
              <StaleRowView key={r.contactId} row={r} onOpen={onOpenLead} />
            ))}
          </Bucket>
        </div>
      )}
    </div>
  );
}

function Bucket({
  id, label, tone, count, isOpen, onToggle, emptyText, children,
}: {
  id: string;
  label: string;
  tone: 'good' | 'warn' | 'bad';
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: `1px solid ${TONE_BORDER[tone]}`, borderRadius: 7, background: '#ffffff', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 10px', background: TONE_BG[tone], border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {isOpen ? <ChevronDown size={13} style={{ color: TONE_TEXT[tone] }} /> : <ChevronRight size={13} style={{ color: TONE_TEXT[tone] }} />}
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: TONE_TEXT[tone] }}>{label}</span>
        <span style={{ fontSize: 11, color: TONE_TEXT[tone], opacity: 0.7, marginLeft: 'auto' }}>
          {count === 0 ? 'none' : count}
        </span>
      </button>
      {isOpen && (
        count === 0 ? (
          <div style={{ padding: '8px 12px', fontSize: 12, color: '#8a8078' }}>{emptyText}</div>
        ) : (
          <div>{children}</div>
        )
      )}
    </div>
  );
}

function rowStyle(): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px', borderTop: '1px solid #f1ebde',
    cursor: 'pointer', background: '#ffffff',
  };
}
function smallLink(): React.CSSProperties {
  return { fontSize: 11, color: '#6a6058', display: 'inline-flex', alignItems: 'center', gap: 3 };
}

function UncontactedRow({ row, onOpen }: { row: RowBase; onOpen: (cid: string, oid: string | null) => void }) {
  return (
    <div style={rowStyle()} onClick={() => onOpen(row.contactId, row.opportunityId)}>
      <Hourglass size={14} style={{ color: '#9a1c1c', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2a2520' }}>
          {row.contactName}
          <span style={{ marginLeft: 6, fontSize: 11, color: '#9a1c1c', fontWeight: 600 }}>
            {fmtAge(row.leadAgeHours)} old
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#6a6058', marginTop: 1, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{row.stage || 'Active lead'}</span>
          {row.phone && <span style={smallLink()}><Phone size={10} /> {row.phone}</span>}
          {row.email && <span style={smallLink()}><Mail size={10} /> {row.email}</span>}
        </div>
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#9a1c1c',
        background: '#fff1f0', border: '1px solid #fda4a4', borderRadius: 4,
        padding: '2px 6px', whiteSpace: 'nowrap',
      }}>
        First touch needed
      </span>
    </div>
  );
}

function UpcomingRow({ row, onOpen }: { row: AppointmentRow; onOpen: (cid: string, oid: string | null) => void }) {
  const kindLabel = (k: AppointmentRow['appointment']['kind']) =>
    k === 'discovery' ? 'Discovery call'
    : k === 'onsite' ? 'Onsite visit'
    : k === 'design' ? 'Design meeting'
    : k === 'followup' ? 'Follow-up'
    : 'Meeting';
  return (
    <div style={rowStyle()} onClick={() => onOpen(row.contactId, row.opportunityId)}>
      <Calendar size={14} style={{ color: '#1e6b35', flexShrink: 0 }} />
      <div style={{ width: 130, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#2a2520' }}>{row.appointment.whenLabel}</div>
        <div style={{ fontSize: 10, color: '#6a6058' }}>{kindLabel(row.appointment.kind)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2a2520' }}>{row.contactName}</div>
        <div style={{ fontSize: 11, color: '#6a6058', marginTop: 1, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{row.stage}</span>
          {row.appointment.location && <span>{row.appointment.location}</span>}
        </div>
      </div>
      <span style={{
        fontSize: 11, fontWeight: 600, color: '#1e6b35',
        background: '#f1f8f4', border: '1px solid #a7d8ba', borderRadius: 4,
        padding: '2px 8px', whiteSpace: 'nowrap',
      }}>
        Open prep
      </span>
    </div>
  );
}

function StaleRowView({ row, onOpen }: { row: StaleRow; onOpen: (cid: string, oid: string | null) => void }) {
  return (
    <div style={rowStyle()} onClick={() => onOpen(row.contactId, row.opportunityId)}>
      <MessageSquareWarning size={14} style={{ color: '#7a5200', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2a2520' }}>
          {row.contactName}
          <span style={{ marginLeft: 6, fontSize: 11, color: '#7a5200', fontWeight: 600 }}>
            {row.daysSinceLastTouch}d since last touch
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#6a6058', marginTop: 1 }}>{row.stage}</div>
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#7a5200',
        background: '#fff8e6', border: '1px solid #f0c060', borderRadius: 4,
        padding: '2px 6px', whiteSpace: 'nowrap',
      }}>
        Nudge
      </span>
    </div>
  );
}

/**
 * Helper exported so the existing rows on the rest of the leads page can show
 * the same "Next Step:" badge that the buckets compute.
 */
export function NextStepBadge({
  step,
}: {
  step: { label: string; tone: 'good' | 'warn' | 'bad' } | undefined;
}) {
  if (!step) return null;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
        background: TONE_BG[step.tone], color: TONE_TEXT[step.tone],
        border: `1px solid ${TONE_BORDER[step.tone]}`,
      }}
      title="Computed from upcoming appointments + recent outbound messages."
    >
      <Clock size={10} /> {step.label}
    </span>
  );
}
