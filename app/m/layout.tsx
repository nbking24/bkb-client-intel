'use client';

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh]" style={{ background: '#111', color: '#e8e0d8' }}>
      {children}
    </div>
  );
}
