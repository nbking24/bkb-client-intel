'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: '#141414' }}
    >
      <div className="text-sm" style={{ color: '#8a8078' }}>
        Loading...
      </div>
    </div>
  );
}
