// @ts-nocheck
'use client';

/**
 * Public Review Gateway — /review/[contactId]
 *
 * Flow:
 *   1. Client lands from an SMS/email link.
 *   2. Picks 1-5 stars.
 *   3. Writes a few words (optional).
 *   4. Submit:
 *      - 5 stars → API logs, text auto-copies to clipboard, redirect to Google in new tab
 *      - 1-4 stars → API logs, shows a warm "I'll reach out personally — Nathan" confirmation
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

type Stage = 'rating' | 'writing' | 'submitting' | 'five_star_done' | 'low_star_done' | 'error';

export default function ReviewGatewayPage() {
  const params = useParams();
  const contactId = String(params?.contactId || '');

  const [stage, setStage] = useState<Stage>('rating');
  const [stars, setStars] = useState<number>(0);
  const [hoveredStar, setHoveredStar] = useState<number>(0);
  const [reviewText, setReviewText] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [googleUrl, setGoogleUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  async function handleSubmit() {
    if (stars < 1) return;
    setStage('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/public/review-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          stars,
          reviewText: reviewText.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMsg(data?.error || 'Something went wrong. Please try again.');
        setStage('error');
        return;
      }
      if (data.routedTo === 'google') {
        setGoogleUrl(data.googleReviewUrl || '');
        // Try to copy review text to clipboard automatically
        if (reviewText.trim()) {
          try {
            await navigator.clipboard.writeText(reviewText.trim());
            setCopied(true);
          } catch {
            // Clipboard may be blocked; the user can click "Copy" manually
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
    if (!reviewText.trim()) return;
    try {
      await navigator.clipboard.writeText(reviewText.trim());
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
            maxWidth: 560,
            width: '100%',
            border: '1px solid #e8e5e0',
          }}
        >
          {stage === 'rating' && (
            <RatingStage
              stars={stars}
              hoveredStar={hoveredStar}
              setStars={(n) => {
                setStars(n);
                setStage('writing');
              }}
              setHoveredStar={setHoveredStar}
            />
          )}

          {(stage === 'writing' || stage === 'submitting' || stage === 'error') && (
            <WritingStage
              stars={stars}
              hoveredStar={hoveredStar}
              setStars={setStars}
              setHoveredStar={setHoveredStar}
              reviewText={reviewText}
              setReviewText={setReviewText}
              onSubmit={handleSubmit}
              submitting={stage === 'submitting'}
              errorMsg={stage === 'error' ? errorMsg : ''}
            />
          )}

          {stage === 'five_star_done' && (
            <FiveStarDone
              reviewText={reviewText}
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
        Tap a star to share your honest feedback. Takes 30 seconds.
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

// ---------- Stage: writing (after picking stars) ----------

function WritingStage({
  stars,
  hoveredStar,
  setStars,
  setHoveredStar,
  reviewText,
  setReviewText,
  onSubmit,
  submitting,
  errorMsg,
}: any) {
  const isFiveStar = stars === 5;
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: BKB_RED, textAlign: 'center' }}>
        {isFiveStar ? 'Awesome — thank you!' : 'Thanks for the honest feedback'}
      </h1>

      <StarPicker
        stars={stars}
        hoveredStar={hoveredStar}
        setStars={setStars}
        setHoveredStar={setHoveredStar}
      />

      <p style={{ color: '#4b4b4b', fontSize: 16, lineHeight: 1.5, margin: '0 0 12px 0' }}>
        {isFiveStar
          ? "If you'd share a few words about your experience, it goes a long way for a small family business like ours."
          : "I take this seriously. Anything you write here comes directly to me and stays private. I'll reach out personally."}
      </p>

      <label
        htmlFor="reviewText"
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
        {isFiveStar ? 'Your review (optional)' : 'What could we have done better?'}
      </label>
      <textarea
        id="reviewText"
        value={reviewText}
        onChange={(e) => setReviewText(e.target.value)}
        rows={6}
        placeholder={
          isFiveStar
            ? 'Brett King Builder did an incredible job on our kitchen renovation. From design through the final walkthrough, the team was...'
            : 'I want to know what missed the mark.'
        }
        style={{
          width: '100%',
          border: '1px solid #d8d4cd',
          borderRadius: 8,
          padding: '10px 12px',
          fontFamily: 'inherit',
          fontSize: 16,
          lineHeight: 1.5,
          resize: 'vertical',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      {isFiveStar && (
        <p style={{ color: '#8a8078', fontSize: 13, margin: '8px 0 0 0', lineHeight: 1.4 }}>
          When you hit Continue, we'll copy this to your clipboard and open Google in a new tab so
          you can paste it without retyping.
        </p>
      )}

      {errorMsg && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '10px 12px',
            borderRadius: 8,
            fontSize: 14,
            marginTop: 12,
          }}
        >
          {errorMsg}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={submitting}
        style={{
          marginTop: 16,
          width: '100%',
          background: BKB_RED,
          color: '#ffffff',
          padding: '14px 18px',
          border: 'none',
          borderRadius: 8,
          fontSize: 16,
          fontWeight: 600,
          cursor: submitting ? 'not-allowed' : 'pointer',
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Submitting...' : isFiveStar ? 'Continue to Google' : 'Send to Nathan'}
      </button>
    </div>
  );
}

// ---------- Stage: five_star_done ----------

function FiveStarDone({
  reviewText,
  googleUrl,
  copied,
  onCopy,
}: {
  reviewText: string;
  googleUrl: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const hasText = !!reviewText.trim();

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: BKB_RED, textAlign: 'center' }}>
        Thanks, {/* name is not needed here since we have it on the prior page */}that means a lot.
      </h1>

      <p
        style={{
          color: '#4b4b4b',
          fontSize: 16,
          lineHeight: 1.5,
          margin: '12px 0',
          textAlign: 'center',
        }}
      >
        One last step to get your review on Google:
      </p>

      <ol style={{ paddingLeft: 22, color: '#333', fontSize: 15, lineHeight: 1.6 }}>
        {hasText && (
          <li>
            Your review is {copied ? 'copied to your clipboard' : 'ready to copy'} — click below if
            it didn't auto-copy.
          </li>
        )}
        <li>Click <strong>Open Google Review</strong> — it opens in a new tab.</li>
        {hasText && <li>Paste your review (Cmd+V / Ctrl+V / long-press → Paste) and submit.</li>}
        {!hasText && (
          <li>
            Write a quick note about your experience on Google and click post.
          </li>
        )}
      </ol>

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
            Your review
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
            {reviewText}
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
            {copied ? '\u2713 Copied! Ready to paste on Google' : 'Copy my review'}
          </button>
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
        Open Google Review \u2192
      </a>

      <p style={{ color: '#8a8078', fontSize: 13, margin: '16px 0 0 0', textAlign: 'center' }}>
        Thanks again. — Nathan
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
        Got it — thank you.
      </h1>
      <p style={{ color: '#4b4b4b', fontSize: 16, lineHeight: 1.6, margin: '16px 0 8px 0' }}>
        Your feedback came directly to me. I take this seriously, and I'd like to understand what
        happened and how we can make it right.
      </p>
      <p style={{ color: '#4b4b4b', fontSize: 16, lineHeight: 1.6, margin: '0 0 16px 0' }}>
        I'll reach out personally within the next day or two.
      </p>
      <p style={{ color: '#8a8078', fontSize: 14, fontStyle: 'italic', textAlign: 'center' }}>
        — Nathan King<br />Brett King Builder-Contractor
      </p>
    </div>
  );
}
