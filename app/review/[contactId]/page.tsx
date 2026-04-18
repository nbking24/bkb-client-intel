// @ts-nocheck
'use client';

/**
 * Public Review Gateway — /review/[contactId]
 *
 * Flow:
 *   1. Client lands from an SMS/email link.
 *   2. Picks 1-5 stars.
 *   3. Answers three open-ended questions about their experience.
 *   4. Clicks a single "Submit Review" button (wording stays constant).
 *   5. Routing:
 *        - 5 stars → warm thank-you + show their response + copy-to-clipboard
 *                    + link to Google + $25 Wawa gift card callout.
 *        - 1-4 stars → warm thank-you + "we take all feedback seriously" note.
 *
 * No auth. The only identifier is the contactId in the URL.
 */

import { useState } from 'react';
import { useParams } from 'next/navigation';

const BKB_RED = '#68050a';
const BKB_GOLD = '#c88c00';
const BKB_CREAM = '#f8f6f3';
const BKB_LOGO =
  'https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png';

type Stage = 'rating' | 'questions' | 'submitting' | 'five_star_done' | 'low_star_done' | 'error';

const QUESTIONS: { key: 'experience' | 'standout' | 'improve'; label: string; placeholder: string }[] = [
  {
    key: 'experience',
    label: 'Tell us about your experience working with our team.',
    placeholder: 'From the first call through the final walkthrough, what was it like?',
  },
  {
    key: 'standout',
    label: 'What stood out about the finished project?',
    placeholder: 'Anything specific about craftsmanship, communication, or the result?',
  },
  {
    key: 'improve',
    label: 'Is there anything we could have done better?',
    placeholder: 'Honest input helps us get better.',
  },
];

type AnswerKey = 'experience' | 'standout' | 'improve';

export default function ReviewGatewayPage() {
  const params = useParams();
  const contactId = String(params?.contactId || '');

  const [stage, setStage] = useState<Stage>('rating');
  const [stars, setStars] = useState<number>(0);
  const [hoveredStar, setHoveredStar] = useState<number>(0);
  const [answers, setAnswers] = useState<Record<AnswerKey, string>>({
    experience: '',
    standout: '',
    improve: '',
  });
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [googleUrl, setGoogleUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [publicResponseText, setPublicResponseText] = useState<string>('');

  function updateAnswer(key: AnswerKey, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  // For Google copy, we share only the positive questions (experience + standout).
  // The "improve" answer stays private — it goes to the DB but not onto a public review.
  function buildPublicResponse() {
    const parts: string[] = [];
    if (answers.experience.trim()) parts.push(answers.experience.trim());
    if (answers.standout.trim()) parts.push(answers.standout.trim());
    return parts.join('\n\n');
  }

  // For the DB, we save all three answers labeled, so internal readers see the full structured feedback.
  function buildDbText() {
    const labeled = QUESTIONS
      .map((q) => {
        const val = answers[q.key]?.trim();
        if (!val) return null;
        return `${q.label}\n${val}`;
      })
      .filter(Boolean);
    return labeled.join('\n\n');
  }

  async function handleSubmit() {
    if (stars < 1) return;
    setStage('submitting');
    setErrorMsg('');
    const dbText = buildDbText();
    try {
      const res = await fetch('/api/public/review-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          stars,
          reviewText: dbText || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMsg(data?.error || 'Something went wrong. Please try again.');
        setStage('error');
        return;
      }
      if (data.routedTo === 'google') {
        const publicText = buildPublicResponse();
        setPublicResponseText(publicText);
        setGoogleUrl(data.googleReviewUrl || '');
        if (publicText) {
          try {
            await navigator.clipboard.writeText(publicText);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }
        setStage('five_star_done');
      } else {
        setStage('low_star_done');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error. Please try again.');
      setStage('error');
    }
  }

  async function copyToClipboard() {
    if (!publicResponseText.trim()) return;
    try {
      await navigator.clipboard.writeText(publicResponseText.trim());
      setCopied(true);
    } catch {
      setCopied(false);
      setErrorMsg('Clipboard access was blocked. You can still copy the text above manually.');
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: BKB_CREAM,
        display: 'flex',
        flexDirection: 'column',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        color: '#1a1a1a',
      }}
    >
      {/* Header */}
      <header
        style={{
          background: BKB_RED,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img src={BKB_LOGO} alt="Brett King Builder" style={{ height: 36 }} />
      </header>

      {/* Main card */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '32px 16px',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            borderRadius: 12,
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
            padding: '28px 24px',
            maxWidth: 600,
            width: '100%',
            border: '1px solid #e8e5e0',
          }}
        >
          {stage === 'rating' && (
            <RatingStage
              stars={stars}
              hoveredStar={hoveredStar}
              setStars={(n: number) => {
                setStars(n);
                setStage('questions');
              }}
              setHoveredStar={setHoveredStar}
            />
          )}

          {(stage === 'questions' || stage === 'submitting' || stage === 'error') && (
            <QuestionsStage
              stars={stars}
              hoveredStar={hoveredStar}
              setStars={setStars}
              setHoveredStar={setHoveredStar}
              answers={answers}
              updateAnswer={updateAnswer}
              onSubmit={handleSubmit}
              submitting={stage === 'submitting'}
              errorMsg={stage === 'error' ? errorMsg : ''}
            />
          )}

          {stage === 'five_star_done' && (
            <FiveStarDone
              publicResponseText={publicResponseText}
              googleUrl={googleUrl}
              copied={copied}
              onCopy={copyToClipboard}
            />
          )}

          {stage === 'low_star_done' && <LowStarDone />}
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          padding: '20px',
          textAlign: 'center',
          fontSize: 12,
          color: '#8a8078',
        }}
      >
        <div>Brett King Builder-Contractor · Perkasie, PA · Bucks County</div>
        <div style={{ marginTop: 4, fontStyle: 'italic' }}>
          "Building upon a solid foundation." (Luke 6:47-49)
        </div>
      </footer>
    </div>
  );
}

// ---------- Star selector ----------

function StarPicker({
  stars,
  hoveredStar,
  setStars,
  setHoveredStar,
}: {
  stars: number;
  hoveredStar: number;
  setStars: (n: number) => void;
  setHoveredStar: (n: number) => void;
}) {
  const rendered = hoveredStar || stars;
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '8px 0 16px 0' }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n <= rendered;
        return (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            onMouseEnter={() => setHoveredStar(n)}
            onMouseLeave={() => setHoveredStar(0)}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              fontSize: 40,
              lineHeight: 1,
              color: active ? BKB_GOLD : '#e0dbd3',
              transition: 'color 120ms ease',
            }}
          >
            {active ? '\u2605' : '\u2606'}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Stage: rating ----------

function RatingStage({ stars, hoveredStar, setStars, setHoveredStar }: any) {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: BKB_RED, textAlign: 'center' }}>
        How was your experience?
      </h1>
      <p
        style={{
          textAlign: 'center',
          color: '#4b4b4b',
          margin: '12px 0 16px 0',
          fontSize: 16,
          lineHeight: 1.5,
        }}
      >
        Tap a star to get started. Takes about 60 seconds.
      </p>
      <StarPicker
        stars={stars}
        hoveredStar={hoveredStar}
        setStars={setStars}
        setHoveredStar={setHoveredStar}
      />
    </div>
  );
}

// ---------- Stage: questions (3 textareas + submit) ----------

function QuestionsStage({
  stars,
  hoveredStar,
  setStars,
  setHoveredStar,
  answers,
  updateAnswer,
  onSubmit,
  submitting,
  errorMsg,
}: any) {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: BKB_RED, textAlign: 'center' }}>
        Tell us how it went
      </h1>

      <StarPicker
        stars={stars}
        hoveredStar={hoveredStar}
        setStars={setStars}
        setHoveredStar={setHoveredStar}
      />

      <p style={{ color: '#4b4b4b', fontSize: 15, lineHeight: 1.5, margin: '0 0 18px 0', textAlign: 'center' }}>
        A few quick questions. Answer what you'd like, then hit Submit.
      </p>

      {QUESTIONS.map((q: any) => (
        <div key={q.key} style={{ marginBottom: 16 }}>
          <label
            htmlFor={`q-${q.key}`}
            style={{
              display: 'block',
              fontSize: 14,
              fontWeight: 600,
              color: '#333',
              marginBottom: 6,
              lineHeight: 1.4,
            }}
          >
            {q.label}
          </label>
          <textarea
            id={`q-${q.key}`}
            value={answers[q.key]}
            onChange={(e) => updateAnswer(q.key, e.target.value)}
            rows={3}
            placeholder={q.placeholder}
            style={{
              width: '100%',
              border: '1px solid #d8d4cd',
              borderRadius: 8,
              padding: '10px 12px',
              fontFamily: 'inherit',
              fontSize: 15,
              lineHeight: 1.5,
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      ))}

      {errorMsg && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '10px 12px',
            borderRadius: 8,
            fontSize: 14,
            marginTop: 4,
            marginBottom: 12,
          }}
        >
          {errorMsg}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={submitting || stars < 1}
        style={{
          marginTop: 8,
          width: '100%',
          background: BKB_RED,
          color: '#ffffff',
          padding: '14px 18px',
          border: 'none',
          borderRadius: 8,
          fontSize: 16,
          fontWeight: 600,
          cursor: submitting || stars < 1 ? 'not-allowed' : 'pointer',
          opacity: submitting || stars < 1 ? 0.7 : 1,
        }}
      >
        {submitting ? 'Submitting...' : 'Submit Review'}
      </button>
    </div>
  );
}

// ---------- Stage: five_star_done ----------

function FiveStarDone({
  publicResponseText,
  googleUrl,
  copied,
  onCopy,
}: {
  publicResponseText: string;
  googleUrl: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const hasText = !!publicResponseText.trim();

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: BKB_RED, textAlign: 'center' }}>
        Thank you. That means more than you might realize.
      </h1>

      <p style={{ color: '#4b4b4b', fontSize: 16, lineHeight: 1.6, margin: '14px 0' }}>
        Would you take a minute to share that on Google? For a small family business like ours,
        Google reviews are one of the biggest ways new families find us when they're thinking
        about their own project. Every one of them genuinely helps.
      </p>

      {/* Wawa gift card callout */}
      <div
        style={{
          background: '#fff8e6',
          border: '1px solid #f1d89a',
          borderRadius: 8,
          padding: '12px 14px',
          margin: '14px 0',
          fontSize: 15,
          lineHeight: 1.5,
          color: '#4a3a10',
        }}
      >
        <strong>A small thank-you:</strong> everyone who posts their review on Google gets a{' '}
        <strong>$25 Wawa gift card</strong> sent their way. We'll send it once we see your review
        come through.
      </div>

      {hasText && (
        <div style={{ marginTop: 16 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 600,
              color: '#555',
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Your response{' '}
            {copied && <span style={{ color: BKB_GOLD, fontWeight: 700 }}> · copied!</span>}
          </label>
          <div
            style={{
              background: '#faf7f2',
              border: '1px solid #e8e0d0',
              borderRadius: 8,
              padding: '12px 14px',
              whiteSpace: 'pre-wrap',
              fontSize: 15,
              lineHeight: 1.5,
              color: '#333',
            }}
          >
            {publicResponseText}
          </div>

          <button
            onClick={onCopy}
            style={{
              marginTop: 10,
              width: '100%',
              background: copied ? BKB_GOLD : '#ffffff',
              color: copied ? '#1a1a1a' : BKB_RED,
              padding: '12px 18px',
              border: `2px solid ${copied ? BKB_GOLD : BKB_RED}`,
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {copied ? '\u2713 Copied! Ready to paste on Google' : 'Copy my response'}
          </button>

          <p style={{ color: '#8a8078', fontSize: 13, margin: '8px 0 0 0', lineHeight: 1.4 }}>
            When Google opens, just paste (Cmd+V / Ctrl+V / long-press → Paste) and submit.
          </p>
        </div>
      )}

      <a
        href={googleUrl || '#'}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'block',
          textAlign: 'center',
          marginTop: 16,
          background: BKB_RED,
          color: '#ffffff',
          padding: '14px 18px',
          borderRadius: 8,
          fontSize: 16,
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        Open Google Review →
      </a>

      <p style={{ color: '#8a8078', fontSize: 13, margin: '16px 0 0 0', textAlign: 'center' }}>
        Thanks again,<br />Nathan
      </p>
    </div>
  );
}

// ---------- Stage: low_star_done ----------

function LowStarDone() {
  return (
    <div>
      <h1
        style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 700,
          color: BKB_RED,
          textAlign: 'center',
        }}
      >
        Thank you. Your feedback matters.
      </h1>
      <p style={{ color: '#4b4b4b', fontSize: 16, lineHeight: 1.6, margin: '16px 0 12px 0' }}>
        We take all reviews seriously. Our team will go through what you shared carefully, and
        we're constantly looking for ways to make the experience better for the families who
        trust us with their homes.
      </p>
      <p style={{ color: '#4b4b4b', fontSize: 16, lineHeight: 1.6, margin: '0 0 16px 0' }}>
        Thank you for taking the time to help us get better.
      </p>
      <p style={{ color: '#8a8078', fontSize: 14, fontStyle: 'italic', textAlign: 'center' }}>
        Nathan King<br />Brett King Builder-Contractor
      </p>
    </div>
  );
}
