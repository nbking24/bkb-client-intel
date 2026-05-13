// @ts-nocheck
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Mail, Check, Clock, FileText, AlertTriangle, ChevronRight,
  Edit3, RefreshCw, Send, ExternalLink, Calendar,
} from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

interface NewsletterIssue {
  id: string;
  issue_month: string;
  status: string;
  theme: string | null;
  featured_project_jt_id: string | null;
  notes: string | null;
  curator_run_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

interface NewsletterSection {
  id: string;
  issue_id: string;
  section_type: string;
  position: number;
  title: string | null;
  body_markdown: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
}

interface SubjectLineOption {
  text: string;
  pattern?: string;
  why?: string;
  preview?: string;
}

export default function NewsletterPage() {
  const [issues, setIssues] = useState<NewsletterIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function loadIssues() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/marketing/newsletter/issues?limit=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.error) setError(data.error);
      else setIssues(data.issues || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIssues();
  }, []);

  if (loading && issues.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading newsletters...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">Failed to load: {error}</div>
    );
  }

  // Approval queue at top — any in 'review' status
  const inReview = issues.filter((i) => i.status === 'review');
  const drafting = issues.filter((i) => i.status === 'drafting' || i.status === 'editing');
  const approved = issues.filter((i) => i.status === 'approved' || i.status === 'sent');

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-700" />
            Newsletter Issues
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Monthly newsletter drafts from the Cowork Newsletter Writer. Review, edit, approve.
          </p>
        </div>
        <button
          onClick={loadIssues}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {inReview.length > 0 && (
        <Section title="Awaiting your review" count={inReview.length} accent="amber">
          {inReview.map((i) => (
            <IssueRow
              key={i.id}
              issue={i}
              selected={selectedId === i.id}
              onSelect={() => setSelectedId(selectedId === i.id ? null : i.id)}
              onChange={loadIssues}
            />
          ))}
        </Section>
      )}

      {drafting.length > 0 && (
        <Section title="Drafting / Editing" count={drafting.length} accent="gray">
          {drafting.map((i) => (
            <IssueRow
              key={i.id}
              issue={i}
              selected={selectedId === i.id}
              onSelect={() => setSelectedId(selectedId === i.id ? null : i.id)}
              onChange={loadIssues}
            />
          ))}
        </Section>
      )}

      {approved.length > 0 && (
        <Section title="Approved / Sent" count={approved.length} accent="green">
          {approved.map((i) => (
            <IssueRow
              key={i.id}
              issue={i}
              selected={selectedId === i.id}
              onSelect={() => setSelectedId(selectedId === i.id ? null : i.id)}
              onChange={loadIssues}
            />
          ))}
        </Section>
      )}

      {issues.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-600">
            No newsletter issues yet. The Cowork Newsletter Writer creates one each month — the
            next scheduled run is the 1st Monday at 10am ET.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            You can also run the agent manually from Cowork.
          </p>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent: 'amber' | 'gray' | 'green';
  children: React.ReactNode;
}) {
  const colors = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    gray: 'border-gray-200 bg-gray-50 text-gray-700',
    green: 'border-green-200 bg-green-50 text-green-800',
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

function IssueRow({
  issue,
  selected,
  onSelect,
  onChange,
}: {
  issue: NewsletterIssue;
  selected: boolean;
  onSelect: () => void;
  onChange: () => void;
}) {
  return (
    <div>
      <button
        onClick={onSelect}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium text-gray-900 text-sm">
              {formatIssueMonth(issue.issue_month)}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {issue.theme || 'No theme set'} · status: {issue.status}
              {issue.approved_at && ` · approved by ${issue.approved_by}`}
            </div>
          </div>
        </div>
        <ChevronRight
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${selected ? 'rotate-90' : ''}`}
        />
      </button>
      {selected && <IssueDetail issueId={issue.id} onChange={onChange} />}
    </div>
  );
}

function IssueDetail({ issueId, onChange }: { issueId: string; onChange: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [chosenSubject, setChosenSubject] = useState<string>('');
  const [savingSubject, setSavingSubject] = useState(false);
  const [approving, setApproving] = useState(false);

  async function load() {
    const token = getToken();
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing/newsletter/issues/${issueId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      setData(d);
      setChosenSubject(d?.parsed_notes?.chosen_subject_line || '');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [issueId]);

  async function saveSubject(line: string) {
    const token = getToken();
    setSavingSubject(true);
    try {
      await fetch(`/api/marketing/newsletter/issues/${issueId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chosen_subject_line: line }),
      });
      setChosenSubject(line);
    } finally {
      setSavingSubject(false);
    }
  }

  async function approve() {
    if (!chosenSubject) {
      alert('Pick a subject line before approving.');
      return;
    }
    setApproving(true);
    try {
      const token = getToken();
      await fetch(`/api/marketing/newsletter/issues/${issueId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      onChange();
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-6 bg-gray-50 text-sm text-gray-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading detail...
      </div>
    );
  }
  if (!data || data.error) {
    return (
      <div className="px-4 py-3 bg-red-50 text-sm text-red-700">
        Failed to load. {data?.error}
      </div>
    );
  }

  const issue: NewsletterIssue = data.issue;
  const sections: NewsletterSection[] = data.sections || [];
  const notes = data.parsed_notes || {};
  const subjectOptions: SubjectLineOption[] = notes.subject_line_options || [];
  const isReview = issue.status === 'review';
  const isApproved = issue.status === 'approved' || issue.status === 'sent';

  return (
    <div className="px-4 py-4 bg-gray-50 space-y-4">
      {/* Subject line picker */}
      {subjectOptions.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Subject lines from the agent
          </div>
          <div className="space-y-2">
            {subjectOptions.map((opt, i) => (
              <label
                key={i}
                className={`flex gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                  chosenSubject === opt.text
                    ? 'bg-blue-50 border-blue-300'
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="subject"
                  className="mt-1"
                  checked={chosenSubject === opt.text}
                  onChange={() => saveSubject(opt.text)}
                  disabled={savingSubject || isApproved}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900">{opt.text}</div>
                  {opt.preview && (
                    <div className="text-xs text-gray-500 mt-0.5">Preview: {opt.preview}</div>
                  )}
                  {opt.why && (
                    <div className="text-xs text-gray-400 italic mt-0.5">{opt.why}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      {sections.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Newsletter sections
          </div>
          <div className="space-y-2">
            {sections.map((s) => (
              <div key={s.id} className="bg-white border border-gray-200 rounded-md p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">
                    {s.section_type}
                  </span>
                  {s.title && <span className="font-medium text-sm text-gray-900">{s.title}</span>}
                </div>
                {s.body_markdown && (
                  <div className="text-sm text-gray-700 whitespace-pre-wrap mt-1.5">
                    {s.body_markdown}
                  </div>
                )}
                {s.image_url && (
                  <div className="text-xs text-gray-500 mt-1.5">
                    <ExternalLink className="w-3 h-3 inline mr-1" />
                    <a href={s.image_url} target="_blank" rel="noreferrer" className="underline">
                      {s.image_url}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent notes */}
      {notes.agent_notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-900">
          <div className="font-semibold mb-1">Notes from the agent:</div>
          <div className="whitespace-pre-wrap">{notes.agent_notes}</div>
        </div>
      )}

      {/* Approve action */}
      {isReview && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
          <div className="text-xs text-gray-500">
            {chosenSubject
              ? `Selected: ${chosenSubject.slice(0, 60)}${chosenSubject.length > 60 ? '…' : ''}`
              : 'Pick a subject line above before approving.'}
          </div>
          <button
            onClick={approve}
            disabled={!chosenSubject || approving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-700 text-white rounded-md disabled:opacity-50 hover:bg-blue-800"
          >
            {approving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Approve & send to GHL
          </button>
        </div>
      )}

      {isApproved && (
        <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-800 flex items-center gap-2">
          <Check className="w-4 h-4" />
          Approved {issue.approved_at && `on ${new Date(issue.approved_at).toLocaleDateString()}`}
          {issue.approved_by && ` by ${issue.approved_by}`}.
        </div>
      )}
    </div>
  );
}

function formatIssueMonth(d: string) {
  try {
    const dt = new Date(d + (d.length === 10 ? 'T12:00:00Z' : ''));
    return dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  } catch {
    return d;
  }
}
