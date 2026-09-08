'use client';

// Minimal full-screen layout for public share pages (/s/[token]) —
// no dashboard chrome, prints clean.
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh]" style={{ background: '#efece7', color: '#1a1a1a' }}>
      {children}
    </div>
  );
}
