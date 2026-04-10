'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Wrench,
  FolderPlus,
  ListPlus,
  ArrowRightLeft,
  Link2Off,
  Eye,
  Play,
  RotateCcw,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================
interface SurveyQuestion {
  id: string;
  label: string;
  type: 'boolean' | 'select' | 'text';
  options?: string[];
  defaultValue: boolean | string;
}

interface PlanSummary {
  phasesToCreate: number;
  tasksToCreate: number;
  tasksToMove: number;
  orphansToAssign: number;
  existingTasksKept: number;
}

interface PreviewData {
  jobId: string;
  jobName: string;
  existingPhases: { phaseNumber: number; name: string; id: string; taskCount: number }[];
  plan: {
    phasesToCreate: any[];
    tasksToCreate: any[];
    tasksToMove: any[];
    orphansToAssign: any[];
    existingTasksKept: any[];
    skippedTasks: any[];
  };
  summary: PlanSummary;
}

// ============================================================
// Scope options (matches survey-templates.ts)
// ============================================================
const SCOPES = [
  { key: 'kitchen', label: 'Kitchen Remodel', desc: 'Full or partial kitchen renovation' },
  { key: 'bathroom', label: 'Bathroom Remodel', desc: 'Full or partial bathroom renovation' },
  { key: 'renovation', label: 'Whole-House / Multi-Room', desc: 'Large-scale renovation across multiple rooms' },
  { key: 'addition', label: 'Addition', desc: 'Room addition, floor addition, or bump-out' },
  { key: 'new_structure', label: 'New Structure', desc: 'Garage, pool house, barn, in-law suite' },
  { key: 'exterior', label: 'Exterior / Roof / Windows', desc: 'Roofing, siding, windows, doors' },
  { key: 'commercial', label: 'Commercial', desc: 'Commercial build-out or renovation' },
  { key: 'other', label: 'Other', desc: 'Custom scope — all default tasks included' },
];

// ============================================================
// Step indicator
// ============================================================
function StepIndicator({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: done ? '#c88c00' : active ? 'rgba(201,168,76,0.2)' : '#ffffff',
                color: done ? '#0d0d0d' : active ? '#c88c00' : '#8a8078',
                border: `1px solid ${done || active ? '#c88c00' : 'rgba(200,140,0,0.15)'}`,
              }}
            >
              {done ? <Check size={12} /> : i + 1}
            </div>
            <span
              className="text-xs font-medium hidden sm:inline"
              style={{ color: active ? '#c88c00' : '#8a8078' }}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div className="w-8 h-px" style={{ background: done ? '#c88c00' : 'rgba(200,140,0,0.15)' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Main Setup Wizard Content (inner component)
// ============================================================
function ScheduleSetupContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const preselectedJobId = searchParams.get('jobId') || '';

  // Wizard state
  const [step, setStep] = useState(0); // 0=scope, 1=survey, 2=preview, 3=apply
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 0: Job + Scope
  const [jobs, setJobs] = useState<{ id: string; name: string; number: string; customStatus: string | null }[]>([]);
  const [selectedJobId, setSelectedJobId] = useState(preselectedJobId);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);

  // Step 1: Survey
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, boolean | string>>({});

  // Step 2: Preview
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    phasesToCreate: true,
    tasksToCreate: true,
    tasksToMove: true,
    orphansToAssign: true,
    existingTasksKept: false,
  });

  // Step 3: Apply results
  const [applyResults, setApplyResults] = useState<{
    phasesCreated: number;
    tasksCreated: number;
    tasksMoved: number;
    orphansAssigned: number;
    errors: string[];
  } | null>(null);

  // Load jobs on mount
  useEffect(() => {
    async function loadJobs() {
      try {
        const res = await fetch('/api/dashboard/projects');
        const json = await res.json();
        setJobs(json.projects || json.jobs || []);
      } catch (err: any) {
        setError('Failed to load projects: ' + err.message);
      }
    }
    loadJobs();
  }, []);

  // Step 0 -> Step 1: Load survey questions
  function toggleScope(key: string) {
    setSelectedScopes((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  }

  async function handleScopeNext() {
    if (!selectedJobId || selectedScopes.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dashboard/schedule-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'survey', scopes: selectedScopes }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setQuestions(json.questions || []);
      setAnswers(json.defaults || {});
      setStep(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Step 1 -> Step 2: Generate preview
  async function handleSurveyNext() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dashboard/schedule-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          jobId: selectedJobId,
          scopes: selectedScopes,
          surveyAnswers: answers,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPreview(json);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Step 2 -> Step 3: Apply changes
  async function handleApply() {
    if (!preview) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/dashboard/schedule-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply',
          jobId: selectedJobId,
          scopes: selectedScopes,
          surveyAnswers: answers,
          plan: preview.plan,
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setApplyResults(json.results);
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleSection(key: string) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const selectedJobName = jobs.find((j) => j.id === selectedJobId)?.name || '';

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/precon"
          className="p-2 rounded-lg hover:bg-[#222] transition-colors"
          style={{ color: '#8a8078' }}
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1
            className="text-xl font-bold"
            style={{ fontFamily: 'Georgia, serif', color: '#c88c00' }}
          >
            Schedule Setup Wizard
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#8a8078' }}>
            Standardize project schedule to BKB 9-phase template
          </p>
        </div>
      </div>

      <StepIndicator
        current={step}
        steps={['Scope', 'Survey', 'Preview', 'Apply']}
      />

      {error && (
        <div
          className="rounded-lg p-3 text-sm flex items-center gap-2"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* ============================================ */}
      {/* STEP 0: Select Job + Scope */}
      {/* ============================================ */}
      {step === 0 && (
        <div className="space-y-4">
          <div
            className="rounded-lg p-4"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
          >
            <label className="block text-sm font-semibold mb-2" style={{ color: '#1a1a1a' }}>
              Select Project
            </label>
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{
                background: '#0d0d0d',
                color: '#1a1a1a',
                border: '1px solid rgba(200,140,0,0.2)',
              }}
            >
              <option value="">— Choose a project —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name} (#{j.number})
                </option>
              ))}
            </select>
          </div>

          <div
            className="rounded-lg p-4"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
          >
            <label className="block text-sm font-semibold mb-1" style={{ color: '#1a1a1a' }}>
              Project Scope
            </label>
            <p className="text-xs mb-3" style={{ color: '#8a8078' }}>
              Select all that apply — e.g. Addition + Kitchen + Bathroom
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SCOPES.map((s) => {
                const isSelected = selectedScopes.includes(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => toggleScope(s.key)}
                    className="text-left rounded-lg px-3 py-2.5 transition-colors relative"
                    style={{
                      background: isSelected ? 'rgba(201,168,76,0.15)' : '#0d0d0d',
                      border: `1px solid ${isSelected ? '#c88c00' : 'rgba(200,140,0,0.1)'}`,
                    }}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2">
                        <Check size={14} style={{ color: '#c88c00' }} />
                      </div>
                    )}
                    <div className="text-sm font-medium" style={{ color: isSelected ? '#c88c00' : '#1a1a1a' }}>
                      {s.label}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: '#8a8078' }}>{s.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleScopeNext}
              disabled={!selectedJobId || selectedScopes.length === 0 || loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{ background: '#c88c00', color: '#0d0d0d' }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Next: Survey
            </button>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* STEP 1: Survey Questions */}
      {/* ============================================ */}
      {step === 1 && (
        <div className="space-y-4">
          <div
            className="rounded-lg p-4"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
          >
            <h3 className="text-sm font-semibold mb-1" style={{ color: '#1a1a1a' }}>
              {selectedJobName}
            </h3>
            <p className="text-xs mb-4" style={{ color: '#8a8078' }}>
              Answer these questions to customize the schedule template for this project.
              Toggle items that apply — excluded items won&apos;t be added.
            </p>

            <div className="space-y-3">
              {questions.map((q) => (
                <div key={q.id} className="flex items-center justify-between py-1">
                  <span className="text-sm" style={{ color: '#d4ccc4' }}>{q.label}</span>
                  {q.type === 'boolean' && (
                    <button
                      onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: !prev[q.id] }))}
                      className="w-10 h-5 rounded-full relative transition-colors"
                      style={{
                        background: answers[q.id] ? '#c88c00' : '#333',
                      }}
                    >
                      <div
                        className="w-4 h-4 rounded-full absolute top-0.5 transition-all"
                        style={{
                          background: '#fff',
                          left: answers[q.id] ? '22px' : '2px',
                        }}
                      />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(0)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
              style={{ color: '#8a8078', border: '1px solid rgba(200,140,0,0.15)' }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              onClick={handleSurveyNext}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{ background: '#c88c00', color: '#0d0d0d' }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              Preview Changes
            </button>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* STEP 2: Preview Plan */}
      {/* ============================================ */}
      {step === 2 && preview && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Phases to Create', value: preview.summary.phasesToCreate, icon: FolderPlus, color: '#22c55e' },
              { label: 'Tasks to Create', value: preview.summary.tasksToCreate, icon: ListPlus, color: '#c88c00' },
              { label: 'Tasks to Move', value: preview.summary.tasksToMove, icon: ArrowRightLeft, color: '#eab308' },
              { label: 'Orphans to Assign', value: preview.summary.orphansToAssign, icon: Link2Off, color: '#f97316' },
            ].map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.label}
                  className="rounded-lg p-3"
                  style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon size={12} style={{ color: c.color }} />
                    <span className="text-[10px]" style={{ color: '#8a8078' }}>{c.label}</span>
                  </div>
                  <div className="text-xl font-bold" style={{ color: c.color }}>{c.value}</div>
                </div>
              );
            })}
          </div>

          <div
            className="rounded-lg p-3 text-xs"
            style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.15)', color: '#c88c00' }}
          >
            <strong>{preview.summary.existingTasksKept}</strong> existing tasks will be kept as-is.
            Review the changes below, then click &quot;Apply&quot; to standardize.
          </div>

          {/* Phases to Create */}
          {preview.plan.phasesToCreate.length > 0 && (
            <PlanSection
              title={`Phases to Create (${preview.plan.phasesToCreate.length})`}
              icon={FolderPlus}
              color="#22c55e"
              expanded={expandedSections.phasesToCreate}
              onToggle={() => toggleSection('phasesToCreate')}
            >
              {preview.plan.phasesToCreate.map((p: any, i: number) => (
                <div key={i} className="text-xs py-1 flex items-center gap-2">
                  <span className="w-5 text-center font-bold" style={{ color: '#22c55e' }}>
                    {p.phaseNumber}
                  </span>
                  <span style={{ color: '#d4ccc4' }}>{p.name}</span>
                  <span style={{ color: '#8a8078' }}>— {p.description}</span>
                </div>
              ))}
            </PlanSection>
          )}

          {/* Tasks to Create */}
          {preview.plan.tasksToCreate.length > 0 && (
            <PlanSection
              title={`Tasks to Create (${preview.plan.tasksToCreate.length})`}
              icon={ListPlus}
              color="#c88c00"
              expanded={expandedSections.tasksToCreate}
              onToggle={() => toggleSection('tasksToCreate')}
            >
              {preview.plan.tasksToCreate.map((t: any, i: number) => (
                <div key={i} className="text-xs py-1 flex items-start gap-2">
                  <span className="w-5 text-center flex-shrink-0" style={{ color: '#c88c00' }}>+</span>
                  <span style={{ color: '#d4ccc4' }}>{t.taskName}</span>
                  <span style={{ color: '#8a8078' }}>→ {t.phaseName}</span>
                </div>
              ))}
            </PlanSection>
          )}

          {/* Tasks to Move */}
          {preview.plan.tasksToMove.length > 0 && (
            <PlanSection
              title={`Tasks to Move (${preview.plan.tasksToMove.length})`}
              icon={ArrowRightLeft}
              color="#eab308"
              expanded={expandedSections.tasksToMove}
              onToggle={() => toggleSection('tasksToMove')}
            >
              {preview.plan.tasksToMove.map((t: any, i: number) => (
                <div key={i} className="text-xs py-1.5 flex items-start gap-2">
                  <ArrowRightLeft size={10} className="flex-shrink-0 mt-0.5" style={{ color: '#eab308' }} />
                  <div>
                    <span style={{ color: '#d4ccc4' }}>{t.taskName}</span>
                    <span style={{ color: '#8a8078' }}> — from {t.fromPhase} → {t.toPhaseName}</span>
                    <span
                      className="ml-1 text-[10px] px-1 rounded"
                      style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308' }}
                    >
                      {t.confidence}
                    </span>
                  </div>
                </div>
              ))}
            </PlanSection>
          )}

          {/* Orphans to Assign */}
          {preview.plan.orphansToAssign.length > 0 && (
            <PlanSection
              title={`Orphan Tasks to Assign (${preview.plan.orphansToAssign.length})`}
              icon={Link2Off}
              color="#f97316"
              expanded={expandedSections.orphansToAssign}
              onToggle={() => toggleSection('orphansToAssign')}
            >
              {preview.plan.orphansToAssign.map((t: any, i: number) => (
                <div key={i} className="text-xs py-1.5 flex items-start gap-2">
                  <Link2Off size={10} className="flex-shrink-0 mt-0.5" style={{ color: '#f97316' }} />
                  <div>
                    <span style={{ color: '#d4ccc4' }}>{t.taskName}</span>
                    <span style={{ color: '#8a8078' }}> → {t.toPhaseName}</span>
                    <span
                      className="ml-1 text-[10px] px-1 rounded"
                      style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}
                    >
                      {t.confidence}
                    </span>
                  </div>
                </div>
              ))}
            </PlanSection>
          )}

          {/* Existing Tasks Kept */}
          <PlanSection
            title={`Existing Tasks Kept (${preview.plan.existingTasksKept.length})`}
            icon={CheckCircle2}
            color="#8a8078"
            expanded={expandedSections.existingTasksKept}
            onToggle={() => toggleSection('existingTasksKept')}
          >
            {preview.plan.existingTasksKept.map((t: any, i: number) => (
              <div key={i} className="text-xs py-0.5" style={{ color: '#8a8078' }}>
                {t.taskName} ({t.phaseName})
              </div>
            ))}
          </PlanSection>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
              style={{ color: '#8a8078', border: '1px solid rgba(200,140,0,0.15)' }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              onClick={handleApply}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{ background: '#c88c00', color: '#0d0d0d' }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Apply Standardization
            </button>
          </div>
        </div>
      )}

      {/* ============================================ */}
      {/* STEP 3: Results */}
      {/* ============================================ */}
      {step === 3 && applyResults && (
        <div className="space-y-4">
          <div
            className="rounded-lg p-6 text-center"
            style={{ background: '#ffffff', border: '1px solid rgba(34,197,94,0.3)' }}
          >
            <CheckCircle2 size={40} style={{ color: '#22c55e' }} className="mx-auto mb-3" />
            <h2 className="text-lg font-bold mb-1" style={{ color: '#1a1a1a' }}>
              Schedule Standardized!
            </h2>
            <p className="text-sm" style={{ color: '#8a8078' }}>
              {selectedJobName} has been updated.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Phases Created', value: applyResults.phasesCreated, color: '#22c55e' },
              { label: 'Tasks Created', value: applyResults.tasksCreated, color: '#c88c00' },
              { label: 'Tasks Moved', value: applyResults.tasksMoved, color: '#eab308' },
              { label: 'Orphans Assigned', value: applyResults.orphansAssigned, color: '#f97316' },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-lg p-3 text-center"
                style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
              >
                <div className="text-xl font-bold" style={{ color: c.color }}>{c.value}</div>
                <div className="text-[10px]" style={{ color: '#8a8078' }}>{c.label}</div>
              </div>
            ))}
          </div>

          {applyResults.errors.length > 0 && (
            <div
              className="rounded-lg p-3"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <h4 className="text-xs font-semibold mb-1" style={{ color: '#ef4444' }}>
                Errors ({applyResults.errors.length})
              </h4>
              {applyResults.errors.map((e, i) => (
                <div key={i} className="text-xs py-0.5" style={{ color: '#d4ccc4' }}>{e}</div>
              ))}
            </div>
          )}

          <div className="flex justify-between">
            <Link
              href="/dashboard/precon"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
              style={{ color: '#8a8078', border: '1px solid rgba(200,140,0,0.15)' }}
            >
              <ArrowLeft size={14} /> Back to Dashboard
            </Link>
            <button
              onClick={() => {
                setStep(0);
                setSelectedJobId('');
                setSelectedScopes([]);
                setPreview(null);
                setApplyResults(null);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'rgba(201,168,76,0.15)', color: '#c88c00', border: '1px solid rgba(201,168,76,0.3)' }}
            >
              <RotateCcw size={14} /> Standardize Another
            </button>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div
          className="fixed bottom-4 right-4 rounded-lg px-4 py-3 flex items-center gap-3 shadow-lg"
          style={{ background: '#ffffff', border: '1px solid rgba(201,168,76,0.3)', zIndex: 50 }}
        >
          <Loader2 size={16} className="animate-spin" style={{ color: '#c88c00' }} />
          <span className="text-sm" style={{ color: '#c88c00' }}>
            {step === 2 ? 'Applying changes to JobTread...' : 'Loading...'}
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Default export — wraps content in Suspense for useSearchParams
// ============================================================
export default function ScheduleSetupPage() {
  return (
    <Suspense fallback={
      <div className="max-w-3xl mx-auto p-8 text-center">
        <Loader2 size={24} className="animate-spin mx-auto" style={{ color: '#c88c00' }} />
        <p className="text-sm mt-2" style={{ color: '#8a8078' }}>Loading wizard...</p>
      </div>
    }>
      <ScheduleSetupContent />
    </Suspense>
  );
}

// ============================================================
// PlanSection — collapsible section in preview
// ============================================================
function PlanSection({
  title,
  icon: Icon,
  color,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: any;
  color: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-[#222] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} style={{ color: '#8a8078' }} />
        ) : (
          <ChevronRight size={14} style={{ color: '#8a8078' }} />
        )}
        <Icon size={14} style={{ color }} />
        <span className="text-xs font-semibold" style={{ color }}>{title}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-3" style={{ borderTop: '1px solid rgba(200,140,0,0.06)' }}>
          {children}
        </div>
      )}
    </div>
  );
}
