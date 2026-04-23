// @ts-nocheck
/**
 * Public short-URL layout — same shape as /review/layout.tsx.
 * No auth, no dashboard chrome.
 */
export const metadata = {
  title: 'Share your experience with Brett King Builder',
  description: 'Leave a review for Brett King Builder-Contractor.',
};

export default function ShortReviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
