// @ts-nocheck
/**
 * Public review-gateway layout — no auth, no dashboard chrome.
 * Independent from /dashboard/* which is behind PIN auth.
 */
export const metadata = {
  title: 'Share your experience — Brett King Builder',
  description: 'Leave a review for Brett King Builder-Contractor.',
};

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
