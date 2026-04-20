// @ts-nocheck
'use client';

/**
 * TicketReporter — floating "Report an issue" button + submission modal.
 *
 * Rendered by the dashboard layout. Visible only to admins and owners
 * (Terri + Nathan) so field staff aren't distracted by it.
 *
 * Captures:
 *   - title, description, severity
 *   - page_url (current route), viewport, user agent
 *   - optional screenshot (file picker OR clipboard paste)
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { Bug, X, Image as ImageIcon, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

type Severity = 'low' | 'medium' | 'high' | 'urgent';

const SEVERITY_OPTIONS: { value: Severity; label: string; hint: string; color: string }[] = [
  { value: 'low',    label: 'Low',     hint: 'Minor annoyance, no rush', color: '#8a8078' },
  { value: 'medium', label: 'Medium',  hint: 'Something looks wrong',    color: '#c88c00' },
  { value: 'high',   label: 'High',    hint: 'Blocking my workflow',     color: '#ea580c' },
  { value: 'urgent', label: 'Urgent',  hint: 'Costing us money',         color: '#dc2626' },
];

export default function TicketReporter() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedTicket, setSubmittedTicket] = useState<{ number: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSee = auth.role === 'admin' || auth.role === 'owner';

  // Clipboard paste support inside the modal
  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!open) return;
    const items = e.clipboardData?.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          applyScreenshot(file);
          e.preventDefault();
          return;
        }
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [open, handlePaste]);

  function applyScreenshot(file: File) {
    setScreenshot(file);
    const reader = new FileReader();
    reader.onload = () => setScreenshotPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  function resetForm() {
    setTitle('');
    setDescription('');
    setSeverity('medium');
    setScreenshot(null);
    setScreenshotPreview(null);
    setError(null);
    setSubmittedTicket(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Give the issue a short title so we can find it later');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('bkb-token') : null;
      if (!token) {
        setError('You need to be logged in to submit a ticket');
        setSubmitting(false);
        return;
      }

      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('description', description.trim());
      fd.append('severity', severity);
      fd.append('page_url', typeof window !== 'undefined' ? window.location.href : '');
      fd.append('viewport_width', String(window.innerWidth || 0));
      fd.append('viewport_height', String(window.innerHeight || 0));
      fd.append('user_agent', navigator.userAgent || '');
      if (screenshot) fd.append('screenshot', screenshot);

      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Could not submit ticket');
        setSubmitting(false);
        return;
      }

      setSubmittedTicket({ number: data.ticket.ticket_number });
      setSubmitting(false);
      // Clear the form for next use after a short victory lap
      setTimeout(() => {
        setOpen(false);
        resetForm();
      }, 2600);
    } catch (err: any) {
      setError(err?.message || 'Submission failed');
      setSubmitting(false);
    }
  }

  if (!canSee) return null;

  return (
    <>
      {/* Floating launcher button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed z-40 rounded-full flex items-center gap-2 shadow-lg transition-all hover:shadow-xl"
          style={{
            bottom: 20,
            right: 20,
            background: '#68050a',
            color: '#ffffff',
            padding: '12px 18px',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
          title="Report a glitch or issue with the dashboard"
        >
          <Bug size={18} />
          <span className="text-sm font-medium hidden sm:inline">Report an issue</span>
        </button>
      )}

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => !submitting && setOpen(false)}
        >
          <div
            className="w-full md:max-w-lg rounded-t-2xl md:rounded-2xl overflow-hidden"
            style={{ background: '#ffffff', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ background: '#68050a', color: '#ffffff' }}
            >
              <div className="flex items-center gap-2">
                <Bug size={18} style={{ color: '#e8c860' }} />
                <span className="font-medium">Report an issue</span>
              </div>
              <button
                onClick={() => !submitting && setOpen(false)}
                className="p-1 rounded hover:bg-white/10"
                style={{ color: '#ffffff' }}
                disabled={submitting}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto' }}>
              {submittedTicket ? (
                <div className="p-8 text-center">
                  <div
                    className="mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center"
                    style={{ background: '#dcfce7' }}
                  >
                    <Check size={28} style={{ color: '#16a34a' }} />
                  </div>
                  <div className="text-lg font-medium mb-1" style={{ color: '#1a1a1a' }}>
                    Thanks! Ticket #{submittedTicket.number} is in.
                  </div>
                  <div className="text-sm" style={{ color: '#5a5550' }}>
                    Nathan has been notified. You'll get an email the moment it's being worked on and again when the fix is live.
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#5a5550' }}>
                      What's wrong? <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Short summary, e.g. 'Invoice totals showing wrong on dashboard'"
                      maxLength={200}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={{ border: '1px solid #e8e5e0', color: '#1a1a1a' }}
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#5a5550' }}>
                      More detail (optional)
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What were you trying to do? What did you expect to happen? What actually happened?"
                      rows={4}
                      maxLength={4000}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={{ border: '1px solid #e8e5e0', color: '#1a1a1a', resize: 'vertical' }}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#5a5550' }}>
                      How urgent?
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {SEVERITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setSeverity(opt.value)}
                          className="text-left p-2.5 rounded-lg text-sm transition-all"
                          style={{
                            border: severity === opt.value ? `2px solid ${opt.color}` : '1px solid #e8e5e0',
                            background: severity === opt.value ? `${opt.color}10` : '#ffffff',
                          }}
                        >
                          <div className="font-medium" style={{ color: severity === opt.value ? opt.color : '#1a1a1a' }}>
                            {opt.label}
                          </div>
                          <div className="text-xs" style={{ color: '#8a8078' }}>
                            {opt.hint}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: '#5a5550' }}>
                      Screenshot (paste or upload)
                    </label>
                    {screenshotPreview ? (
                      <div
                        className="relative rounded-lg overflow-hidden"
                        style={{ border: '1px solid #e8e5e0' }}
                      >
                        <img
                          src={screenshotPreview}
                          alt="Screenshot preview"
                          style={{ width: '100%', maxHeight: 240, objectFit: 'contain', background: '#f8f6f3' }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setScreenshot(null);
                            setScreenshotPreview(null);
                          }}
                          className="absolute top-2 right-2 rounded-full p-1 shadow"
                          style={{ background: 'rgba(0,0,0,0.7)', color: '#ffffff' }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full p-4 rounded-lg text-sm flex flex-col items-center justify-center gap-2"
                        style={{ border: '1px dashed #e8e5e0', background: '#f8f6f3', color: '#5a5550' }}
                      >
                        <ImageIcon size={22} style={{ color: '#8a8078' }} />
                        <span>Click to upload, or paste a screenshot (Cmd/Ctrl+V)</span>
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) applyScreenshot(file);
                      }}
                      style={{ display: 'none' }}
                    />
                  </div>

                  {error && (
                    <div
                      className="flex items-start gap-2 p-3 rounded-lg text-sm"
                      style={{ background: '#fef2f2', color: '#b91c1c' }}
                    >
                      <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      disabled={submitting}
                      className="px-4 py-2 rounded-lg text-sm"
                      style={{ color: '#5a5550', background: 'transparent', border: '1px solid #e8e5e0' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                      style={{ background: '#68050a', color: '#ffffff' }}
                    >
                      {submitting ? <><Loader2 size={14} className="animate-spin" /> Submitting...</> : 'Submit ticket'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
