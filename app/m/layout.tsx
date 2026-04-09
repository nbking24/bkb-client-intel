'use client';

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh]" style={{ background: '#ffffff', color: '#1a1a1a' }}>
      {children}
    </div>
  );
}
