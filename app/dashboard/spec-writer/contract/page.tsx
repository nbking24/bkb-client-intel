'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  Save,
  Upload,
  X,
  AlertTriangle,
  CheckCircle,
  Search,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================
interface CostItemInfo {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
}

interface BudgetCostGroup {
  id: string;
  name: string;
  description: string;
  costItems: CostItemInfo[];
}

interface BudgetSection {
  id: string;
  name: string;
  costGroups: BudgetCostGroup[];
}

interface FollowUpQuestion {
  id: string;
  question: string;
  options: string[];
  allowCustom: boolean;
}

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  content?: string;
}

type Step =
  | 'select-job'
  | 'review-budget'
  | 'scope-entry'
  | 'category-qna'
  | 'review'
  | 'summary';

// Flatten all cost groups from sections into a single ordered list for Q&A
function flattenCostGroups(
  sections: BudgetSection[],
  selectedIds: Set<string>
): { section: BudgetSection; group: BudgetCostGroup }[] {
  const result: { section: BudgetSection; group: BudgetCostGroup }[] = [];
  for (const section of sections) {
    for (const group of section.costGroups) {
      if (selectedIds.has(group.id)) {
        result.push({ section, group });
      }
    }
  }
  return result;
}

// ============================================================
// Component
// ============================================================
export default function ContractSpecWriter() {
  // Step navigation
  const [step, setStep] = useState<Step>('select-job');

  // Step 1: Job selection
  const [jobIdInput, setJobIdInput] = useState('');
  const [jobName, setJobName] = useState('');
  const [jobId, setJobId] = useState('');

  // Step 2: Budget review
  const [budgetSections, setBudgetSections] = useState<BudgetSection[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Step 3: Scope + documents
  const [projectScope, setProjectScope] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 4: Category Q&A
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [currentQuestions, setCurrentQuestions] = useState<FollowUpQuestion[]>([]);
  const [allAnswers, setAllAnswers] = useState<Record<string, Record<string, string>>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  // Step 5: Review & approve
  const [generatedSpecs, setGeneratedSpecs] = useState<Record<string, string>>({});
  const [editingSpec, setEditingSpec] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [savedSpecs, setSavedSpecs] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // Shared state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // Derived: flattened ordered list of selected cost groups
  const flatGroups = flattenCostGroups(budgetSections, selectedGroups);

  // ============================================================
  // Step 1: Load budget
  // ============================================================
  async function loadBudget() {
    const id = jobIdInput.trim();
    if (!id) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/spec-writer/contract/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load budget');

      setJobId(id);
      setJobName(data.jobName || id);
      setBudgetSections(data.sections || []);

      // Pre-select all cost groups
      const allIds = new Set<string>();
      for (const section of data.sections || []) {
        for (const group of section.costGroups) {
          allIds.add(group.id);
        }
      }
      setSelectedGroups(allIds);

      // Expand all sections
      setExpandedSections(new Set((data.sections || []).map((s: BudgetSection) => s.id)));

      setStep('review-budget');
    } catch (err: any) {
      setError(err.message || 'Failed to load budget');
    } finally {
      setIsLoading(false);
    }
  }

  // ============================================================
  // Step 3: File upload handling
  // ============================================================
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const content = typeof reader.result === 'string' ? reader.result : '';
        setUploadedFiles((prev) => [
          ...prev,
          { name: file.name, size: file.size, type: file.type, content },
        ]);
      };
      // Read text-based files
      if (
        file.type.includes('text') ||
        file.name.endsWith('.txt') ||
        file.name.endsWith('.csv') ||
        file.name.endsWith('.md')
      ) {
        reader.readAsText(file);
      } else {
        // For PDFs and other binary files, we can't read content client-side easily
        setUploadedFiles((prev) => [
          ...prev,
          { name: file.name, size: file.size, type: file.type, content: '' },
        ]);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // ============================================================
  // Step 4: Load questions for current category
  // ============================================================
  async function loadQuestionsForCategory(groupIndex: number) {
    if (flatGroups.length === 0) return;
    const { section, group } = flatGroups[groupIndex];
    setIsLoading(true);
    setError('');
    setCurrentQuestions([]);

    try {
      const res = await fetch('/api/spec-writer/contract/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryName: group.name,
          categoryDescription: group.description || '',
          sectionName: section.name,
          costItems: group.costItems.map((ci) => ({
            name: ci.name,
            description: ci.description,
            quantity: ci.quantity,
          })),
          projectScope,
          files: uploadedFiles.map((f) => ({
            name: f.name,
            content: f.content || '',
            type: f.type,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate questions');
      setCurrentQuestions(data.questions || []);
    } catch (err: any) {
      setError(err.message || 'Failed to generate questions');
    } finally {
      setIsLoading(false);
    }
  }

  function startQnA() {
    setCurrentGroupIndex(0);
    setStep('category-qna');
    loadQuestionsForCategory(0);
  }

  function answerQuestion(groupId: string, questionId: string, answer: string) {
    setAllAnswers((prev) => ({
      ...prev,
      [groupId]: { ...(prev[groupId] || {}), [questionId]: answer },
    }));
  }

  async function nextCategory() {
    const nextIdx = currentGroupIndex + 1;
    if (nextIdx >= flatGroups.length) {
      // All categories answered — generate specs and go to review
      setStep('review');
      generateAllSpecs();
      return;
    }
    setCurrentGroupIndex(nextIdx);
    setCustomInputs({});
    await loadQuestionsForCategory(nextIdx);
  }

  async function prevCategory() {
    if (currentGroupIndex <= 0) return;
    const prevIdx = currentGroupIndex - 1;
    setCurrentGroupIndex(prevIdx);
    setCustomInputs({});
    await loadQuestionsForCategory(prevIdx);
  }

  // ============================================================
  // Step 5: Generate specs for all answered categories
  // ============================================================
  async function generateSpecForGroup(
    section: BudgetSection,
    group: BudgetCostGroup
  ): Promise<string> {
    const answers = allAnswers[group.id] || {};
    const questionsAndAnswers = Object.entries(answers).map(([id, answer]) => ({
      id,
      question: id, // We don't store question text separately, but the AI doesn't need it
      answer,
    }));

    const res = await fetch('/api/spec-writer/contract/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoryName: group.name,
        categoryDescription: group.description || '',
        sectionName: section.name,
        costGroupName: group.name,
        projectScope,
        questionsAndAnswers,
        costItems: group.costItems.map((ci) => ({
          name: ci.name,
          description: ci.description,
          quantity: ci.quantity,
        })),
        files: uploadedFiles.map((f) => ({
          name: f.name,
          content: f.content || '',
          type: f.type,
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate specification');
    return data.specification || '';
  }

  async function generateAllSpecs() {
    setIsLoading(true);
    setError('');
    const newSpecs: Record<string, string> = {};

    for (const { section, group } of flatGroups) {
      try {
        const spec = await generateSpecForGroup(section, group);
        newSpecs[group.id] = spec;
        // Update state incrementally so user sees progress
        setGeneratedSpecs((prev) => ({ ...prev, [group.id]: spec }));
      } catch (err: any) {
        newSpecs[group.id] = `ERROR: ${err.message}`;
        setGeneratedSpecs((prev) => ({
          ...prev,
          [group.id]: `ERROR: ${err.message}`,
        }));
      }
    }
    setIsLoading(false);
  }

  async function regenerateSpec(groupId: string) {
    const item = flatGroups.find((fg) => fg.group.id === groupId);
    if (!item) return;
    setIsLoading(true);
    try {
      const spec = await generateSpecForGroup(item.section, item.group);
      setGeneratedSpecs((prev) => ({ ...prev, [groupId]: spec }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  // ============================================================
  // Step 5: Save to JobTread
  // ============================================================
  async function saveToJobTread(groupId: string) {
    const spec = generatedSpecs[groupId];
    if (!spec) return;

    setSavingId(groupId);
    setError('');
    try {
      const res = await fetch('/api/spec-writer/contract/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costGroupId: groupId, description: spec }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setSavedSpecs((prev) => ({ ...prev, [groupId]: new Date().toISOString() }));
    } catch (err: any) {
      setError(err.message || 'Failed to save to JobTread');
    } finally {
      setSavingId(null);
    }
  }

  // ============================================================
  // Utilities
  // ============================================================
  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function toggleGroupSelection(groupId: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header with Tabs */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/precon"
          className="p-2 rounded-lg hover:bg-[#222] transition-colors"
          style={{ color: '#8a8078' }}
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1
            className="text-xl font-bold"
            style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}
          >
            Spec Writer
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#8a8078' }}>
            Generate contract &amp; change order specifications
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'rgba(205,162,116,0.15)' }}>
        <Link
          href="/dashboard/spec-writer"
          className="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
          style={{ color: '#8a8078', background: 'transparent' }}
        >
          Quick Specs
        </Link>
        <button
          className="px-4 py-2 text-sm font-medium rounded-t-lg"
          style={{
            color: '#C9A84C',
            background: 'rgba(205,162,116,0.08)',
            borderBottom: '2px solid #C9A84C',
          }}
        >
          Contract
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div
          className="rounded-lg p-3 flex items-start gap-2"
          style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)' }}
        >
          <AlertTriangle size={16} className="mt-0.5 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
          <button onClick={() => setError('')} className="ml-auto text-red-400">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ========================================== */}
      {/* STEP 1: JOB SELECTION */}
      {/* ========================================== */}
      {step === 'select-job' && (
        <div className="space-y-4">
          <div
            className="rounded-lg p-4"
            style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
          >
            <label className="block text-sm font-semibold mb-2" style={{ color: '#e8e0d8' }}>
              Enter Job ID
            </label>
            <p className="text-xs mb-3" style={{ color: '#8a8078' }}>
              Enter the JobTread Job ID to load its budget. You can find this in the URL when viewing the job.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={jobIdInput}
                onChange={(e) => setJobIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadBudget()}
                placeholder="e.g. 22P5qEW5VPq5"
                className="flex-1 rounded-lg px-3 py-2 text-sm"
                style={{
                  background: '#0d0d0d',
                  border: '1px solid rgba(205,162,116,0.15)',
                  color: '#e8e0d8',
                }}
              />
              <button
                onClick={loadBudget}
                disabled={isLoading || !jobIdInput.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                style={{ background: '#C9A84C', color: '#0d0d0d' }}
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                Load Budget
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* STEP 2: BUDGET REVIEW */}
      {/* ========================================== */}
      {step === 'review-budget' && (
        <div className="space-y-4">
          {/* Job info */}
          <div
            className="rounded-lg p-3 flex items-center gap-2"
            style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(205,162,116,0.15)' }}
          >
            <FileText size={16} style={{ color: '#C9A84C' }} />
            <span className="text-sm font-medium" style={{ color: '#e8e0d8' }}>
              {jobName}
            </span>
            <span className="text-xs" style={{ color: '#8a8078' }}>
              ({selectedGroups.size} sections selected)
            </span>
          </div>

          {/* Budget tree */}
          <div
            className="rounded-lg p-4"
            style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
          >
            <label className="block text-sm font-semibold mb-3" style={{ color: '#e8e0d8' }}>
              Select Sections for Specifications
            </label>

            {budgetSections.length === 0 ? (
              <p className="text-sm" style={{ color: '#8a8078' }}>
                No budget sections found under Scope of Work.
              </p>
            ) : (
              <div className="space-y-2">
                {budgetSections.map((section) => (
                  <div key={section.id}>
                    {/* Section header (area) */}
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[#222] transition-colors"
                    >
                      {expandedSections.has(section.id) ? (
                        <ChevronDown size={14} style={{ color: '#C9A84C' }} />
                      ) : (
                        <ChevronRight size={14} style={{ color: '#8a8078' }} />
                      )}
                      <span className="text-sm font-medium" style={{ color: '#C9A84C' }}>
                        {section.name}
                      </span>
                      <span className="text-xs ml-auto" style={{ color: '#8a8078' }}>
                        {section.costGroups.length} groups
                      </span>
                    </button>

                    {/* Cost groups under this section */}
                    {expandedSections.has(section.id) && (
                      <div className="ml-6 space-y-1 mt-1">
                        {section.costGroups.map((group) => (
                          <label
                            key={group.id}
                            className="flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-[#222] transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={selectedGroups.has(group.id)}
                              onChange={() => toggleGroupSelection(group.id)}
                              className="rounded"
                              style={{ accentColor: '#C9A84C' }}
                            />
                            <span className="text-sm" style={{ color: '#e8e0d8' }}>
                              {group.name}
                            </span>
                            <span className="text-xs ml-auto" style={{ color: '#8a8078' }}>
                              {group.costItems.length} items
                            </span>
                            {group.description && (
                              <span
                                className="text-xs px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}
                              >
                                has spec
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex gap-2">
            <button
              onClick={() => setStep('select-job')}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: '#8a8078', border: '1px solid rgba(205,162,116,0.15)' }}
            >
              Back
            </button>
            <button
              onClick={() => setStep('scope-entry')}
              disabled={selectedGroups.size === 0}
              className="ml-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              style={{ background: '#C9A84C', color: '#0d0d0d' }}
            >
              Continue
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* STEP 3: SCOPE + DOCUMENTS */}
      {/* ========================================== */}
      {step === 'scope-entry' && (
        <div className="space-y-4">
          {/* Project scope */}
          <div
            className="rounded-lg p-4"
            style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
          >
            <label className="block text-sm font-semibold mb-2" style={{ color: '#e8e0d8' }}>
              Describe the Project Scope
            </label>
            <p className="text-xs mb-3" style={{ color: '#8a8078' }}>
              Provide an overview of the project. This helps the AI write more accurate and specific specifications.
            </p>
            <textarea
              value={projectScope}
              onChange={(e) => setProjectScope(e.target.value)}
              rows={6}
              placeholder="We are building a 4-season room addition on the rear of the home. The project includes new foundation, framing, roofing tied into existing, windows on 3 walls, HVAC extension, electrical..."
              className="w-full rounded-lg px-3 py-3 text-sm resize-none"
              style={{
                background: '#0d0d0d',
                border: '1px solid rgba(205,162,116,0.15)',
                color: '#e8e0d8',
              }}
            />
          </div>

          {/* File upload */}
          <div
            className="rounded-lg p-4"
            style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
          >
            <label className="block text-sm font-semibold mb-2" style={{ color: '#e8e0d8' }}>
              Upload Project Documents (Optional)
            </label>
            <p className="text-xs mb-3" style={{ color: '#8a8078' }}>
              Construction plans, window orders, vendor estimates, material selections, etc.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              accept=".pdf,.txt,.csv,.md,.doc,.docx"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
              style={{
                border: '1px dashed rgba(205,162,116,0.3)',
                color: '#8a8078',
                background: 'transparent',
              }}
            >
              <Upload size={16} />
              Choose files
            </button>

            {uploadedFiles.length > 0 && (
              <div className="mt-3 space-y-1">
                {uploadedFiles.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1.5 rounded"
                    style={{ background: '#0d0d0d' }}
                  >
                    <Paperclip size={12} style={{ color: '#C9A84C' }} />
                    <span className="text-xs flex-1" style={{ color: '#e8e0d8' }}>
                      {file.name}
                    </span>
                    <span className="text-xs" style={{ color: '#8a8078' }}>
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                    <button onClick={() => removeFile(i)} className="text-red-400">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex gap-2">
            <button
              onClick={() => setStep('review-budget')}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: '#8a8078', border: '1px solid rgba(205,162,116,0.15)' }}
            >
              Back
            </button>
            <button
              onClick={startQnA}
              disabled={!projectScope.trim()}
              className="ml-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              style={{ background: '#C9A84C', color: '#0d0d0d' }}
            >
              Start Writing Specs
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* STEP 4: CATEGORY Q&A (one at a time) */}
      {/* ========================================== */}
      {step === 'category-qna' && (
        <div className="space-y-4">
          {flatGroups.length > 0 && (
            <>
              {/* Progress indicator */}
              <div className="flex items-center gap-3">
                <div
                  className="flex-1 h-1.5 rounded-full overflow-hidden"
                  style={{ background: '#222' }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${((currentGroupIndex + 1) / flatGroups.length) * 100}%`,
                      background: '#C9A84C',
                    }}
                  />
                </div>
                <span className="text-xs font-medium" style={{ color: '#8a8078' }}>
                  {currentGroupIndex + 1} of {flatGroups.length}
                </span>
              </div>

              {/* Current category header */}
              <div
                className="rounded-lg p-4"
                style={{
                  background: 'rgba(201,168,76,0.06)',
                  border: '1px solid rgba(205,162,116,0.15)',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs" style={{ color: '#8a8078' }}>
                    {flatGroups[currentGroupIndex].section.name}
                  </span>
                </div>
                <h2 className="text-lg font-bold" style={{ color: '#C9A84C', fontFamily: 'Georgia, serif' }}>
                  {flatGroups[currentGroupIndex].group.name}
                </h2>

                {/* Cost items list */}
                {flatGroups[currentGroupIndex].group.costItems.length > 0 && (
                  <div className="mt-3">
                    <span className="text-xs font-medium" style={{ color: '#8a8078' }}>
                      Budget line items:
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {flatGroups[currentGroupIndex].group.costItems.map((ci) => (
                        <span
                          key={ci.id}
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ background: '#222', color: '#e8e0d8' }}
                        >
                          {ci.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Questions */}
              {isLoading ? (
                <div className="flex items-center justify-center py-8 gap-2" style={{ color: '#8a8078' }}>
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-sm">Generating questions...</span>
                </div>
              ) : currentQuestions.length === 0 ? (
                <div
                  className="rounded-lg p-4 flex items-start gap-3"
                  style={{
                    background: 'rgba(34,197,94,0.06)',
                    border: '1px solid rgba(34,197,94,0.2)',
                  }}
                >
                  <CheckCircle size={18} className="mt-0.5 shrink-0" style={{ color: '#22c55e' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: '#e8e0d8' }}>
                      Covered by BKB Standards
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#8a8078' }}>
                      This category will use your company standard specifications. No project-specific questions needed.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {currentQuestions.map((q) => {
                    const groupId = flatGroups[currentGroupIndex].group.id;
                    const currentAnswer = allAnswers[groupId]?.[q.id] || '';

                    return (
                      <div
                        key={q.id}
                        className="rounded-lg p-4"
                        style={{
                          background: '#1a1a1a',
                          border: '1px solid rgba(205,162,116,0.1)',
                        }}
                      >
                        <p className="text-sm font-medium mb-3" style={{ color: '#e8e0d8' }}>
                          {q.question}
                        </p>

                        {/* Option pills */}
                        <div className="flex flex-wrap gap-2 mb-2">
                          {q.options.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => answerQuestion(groupId, q.id, opt)}
                              className="px-3 py-1.5 rounded-full text-xs transition-colors"
                              style={{
                                background:
                                  currentAnswer === opt
                                    ? 'rgba(201,168,76,0.2)'
                                    : '#222',
                                border:
                                  currentAnswer === opt
                                    ? '1px solid #C9A84C'
                                    : '1px solid rgba(205,162,116,0.15)',
                                color: currentAnswer === opt ? '#C9A84C' : '#e8e0d8',
                              }}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>

                        {/* Custom input */}
                        {q.allowCustom && (
                          <div className="flex gap-2 mt-2">
                            <input
                              type="text"
                              placeholder="Custom answer..."
                              value={customInputs[q.id] || ''}
                              onChange={(e) =>
                                setCustomInputs((prev) => ({ ...prev, [q.id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && customInputs[q.id]?.trim()) {
                                  answerQuestion(groupId, q.id, customInputs[q.id].trim());
                                }
                              }}
                              className="flex-1 rounded-lg px-3 py-1.5 text-xs"
                              style={{
                                background: '#0d0d0d',
                                border: '1px solid rgba(205,162,116,0.15)',
                                color: '#e8e0d8',
                              }}
                            />
                            <button
                              onClick={() => {
                                if (customInputs[q.id]?.trim()) {
                                  answerQuestion(groupId, q.id, customInputs[q.id].trim());
                                }
                              }}
                              className="px-2 py-1 rounded-lg text-xs"
                              style={{ background: '#222', color: '#C9A84C' }}
                            >
                              Set
                            </button>
                          </div>
                        )}

                        {/* Current answer indicator */}
                        {currentAnswer && !q.options.includes(currentAnswer) && (
                          <p className="text-xs mt-2" style={{ color: '#C9A84C' }}>
                            Custom: {currentAnswer}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Navigation */}
              <div className="flex gap-2">
                <button
                  onClick={currentGroupIndex === 0 ? () => setStep('scope-entry') : prevCategory}
                  className="px-4 py-2 rounded-lg text-sm"
                  style={{ color: '#8a8078', border: '1px solid rgba(205,162,116,0.15)' }}
                >
                  Back
                </button>
                <button
                  onClick={nextCategory}
                  disabled={isLoading}
                  className="ml-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                  style={{ background: '#C9A84C', color: '#0d0d0d' }}
                >
                  {currentGroupIndex + 1 >= flatGroups.length ? 'Generate All Specs' : 'Next Section'}
                  <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========================================== */}
      {/* STEP 5: REVIEW & APPROVE */}
      {/* ========================================== */}
      {step === 'review' && (
        <div className="space-y-4">
          {isLoading && (
            <div className="flex items-center gap-2 py-4 justify-center" style={{ color: '#8a8078' }}>
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">
                Generating specifications... ({Object.keys(generatedSpecs).length} of {flatGroups.length})
              </span>
            </div>
          )}

          {flatGroups.map(({ section, group }) => {
            const spec = generatedSpecs[group.id];
            const isSaved = !!savedSpecs[group.id];
            const isSaving = savingId === group.id;
            const isEditing = editingSpec === group.id;

            if (!spec) return null;

            return (
              <div
                key={group.id}
                className="rounded-lg overflow-hidden"
                style={{
                  background: '#1a1a1a',
                  border: isSaved
                    ? '1px solid rgba(34,197,94,0.3)'
                    : '1px solid rgba(205,162,116,0.1)',
                }}
              >
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
                  <div className="flex-1">
                    <span className="text-xs" style={{ color: '#8a8078' }}>
                      {section.name}
                    </span>
                    <h3 className="text-sm font-bold" style={{ color: '#C9A84C' }}>
                      {group.name}
                    </h3>
                  </div>
                  {isSaved && (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                      <CheckCircle size={12} /> Saved
                    </span>
                  )}
                </div>

                {/* Spec content */}
                <div className="px-4 py-3">
                  {isEditing ? (
                    <textarea
                      value={editBuffer}
                      onChange={(e) => setEditBuffer(e.target.value)}
                      rows={12}
                      className="w-full rounded-lg px-3 py-2 text-xs font-mono resize-y"
                      style={{
                        background: '#0d0d0d',
                        border: '1px solid rgba(205,162,116,0.15)',
                        color: '#e8e0d8',
                      }}
                    />
                  ) : (
                    <pre
                      className="text-xs whitespace-pre-wrap font-mono overflow-x-auto"
                      style={{ color: '#e8e0d8' }}
                    >
                      {spec}
                    </pre>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 px-4 py-2" style={{ borderTop: '1px solid rgba(205,162,116,0.08)' }}>
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => {
                          setGeneratedSpecs((prev) => ({ ...prev, [group.id]: editBuffer }));
                          setEditingSpec(null);
                        }}
                        className="px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1"
                        style={{ background: '#C9A84C', color: '#0d0d0d' }}
                      >
                        <Check size={12} /> Save Edit
                      </button>
                      <button
                        onClick={() => setEditingSpec(null)}
                        className="px-3 py-1.5 rounded text-xs"
                        style={{ color: '#8a8078' }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingSpec(group.id);
                          setEditBuffer(spec);
                        }}
                        className="px-3 py-1.5 rounded text-xs flex items-center gap-1"
                        style={{ color: '#8a8078', border: '1px solid rgba(205,162,116,0.15)' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => regenerateSpec(group.id)}
                        disabled={isLoading}
                        className="px-3 py-1.5 rounded text-xs flex items-center gap-1"
                        style={{ color: '#8a8078', border: '1px solid rgba(205,162,116,0.15)' }}
                      >
                        <RefreshCw size={12} /> Regenerate
                      </button>
                      <button
                        onClick={() => copyToClipboard(spec, group.id)}
                        className="px-3 py-1.5 rounded text-xs flex items-center gap-1"
                        style={{ color: '#8a8078', border: '1px solid rgba(205,162,116,0.15)' }}
                      >
                        {copied === group.id ? <Check size={12} /> : <Copy size={12} />}
                        {copied === group.id ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={() => saveToJobTread(group.id)}
                        disabled={isSaving || isSaved}
                        className="ml-auto px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1 disabled:opacity-50"
                        style={{
                          background: isSaved ? 'rgba(34,197,94,0.15)' : '#C9A84C',
                          color: isSaved ? '#22c55e' : '#0d0d0d',
                        }}
                      >
                        {isSaving ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : isSaved ? (
                          <CheckCircle size={12} />
                        ) : (
                          <Save size={12} />
                        )}
                        {isSaving ? 'Saving...' : isSaved ? 'Saved' : 'Save to JobTread'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* Navigation */}
          {!isLoading && (
            <div className="flex gap-2">
              <button
                onClick={() => setStep('category-qna')}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ color: '#8a8078', border: '1px solid rgba(205,162,116,0.15)' }}
              >
                Back to Questions
              </button>
              <button
                onClick={() => setStep('summary')}
                className="ml-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                style={{ background: '#C9A84C', color: '#0d0d0d' }}
              >
                View Summary
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========================================== */}
      {/* STEP 6: SUMMARY */}
      {/* ========================================== */}
      {step === 'summary' && (
        <div className="space-y-4">
          <div
            className="rounded-lg p-4"
            style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
          >
            <h2
              className="text-lg font-bold mb-3"
              style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}
            >
              Specification Summary
            </h2>
            <p className="text-xs mb-4" style={{ color: '#8a8078' }}>
              {jobName} &mdash; {Object.keys(savedSpecs).length} of {flatGroups.length} sections saved to JobTread
            </p>

            <div className="space-y-2">
              {flatGroups.map(({ section, group }) => {
                const isSaved = !!savedSpecs[group.id];
                const hasSpec = !!generatedSpecs[group.id];

                return (
                  <div
                    key={group.id}
                    className="flex items-center gap-3 px-3 py-2 rounded"
                    style={{ background: '#0d0d0d' }}
                  >
                    {isSaved ? (
                      <CheckCircle size={16} className="text-green-400 shrink-0" />
                    ) : hasSpec ? (
                      <AlertTriangle size={16} className="text-yellow-400 shrink-0" />
                    ) : (
                      <X size={16} className="text-red-400 shrink-0" />
                    )}
                    <div className="flex-1">
                      <span className="text-sm" style={{ color: '#e8e0d8' }}>
                        {group.name}
                      </span>
                      <span className="text-xs ml-2" style={{ color: '#8a8078' }}>
                        {section.name}
                      </span>
                    </div>
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: isSaved
                          ? 'rgba(34,197,94,0.1)'
                          : hasSpec
                          ? 'rgba(234,179,8,0.1)'
                          : 'rgba(220,38,38,0.1)',
                        color: isSaved ? '#22c55e' : hasSpec ? '#eab308' : '#ef4444',
                      }}
                    >
                      {isSaved ? 'Saved' : hasSpec ? 'Pending' : 'Not generated'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => setStep('review')}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: '#8a8078', border: '1px solid rgba(205,162,116,0.15)' }}
            >
              Back to Review
            </button>
            <a
              href={`https://app.jobtread.com/jobs/${jobId}/budget`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
              style={{ background: '#C9A84C', color: '#0d0d0d' }}
            >
              Open in JobTread
              <ArrowRight size={16} />
            </a>
          </div>

          {/* Start over */}
          <div className="text-center">
            <button
              onClick={() => {
                setStep('select-job');
                setJobId('');
                setJobName('');
                setJobIdInput('');
                setBudgetSections([]);
                setSelectedGroups(new Set());
                setProjectScope('');
                setUploadedFiles([]);
                setAllAnswers({});
                setGeneratedSpecs({});
                setSavedSpecs({});
                setCurrentGroupIndex(0);
                setError('');
              }}
              className="text-xs underline"
              style={{ color: '#8a8078' }}
            >
              Start Over with New Job
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
