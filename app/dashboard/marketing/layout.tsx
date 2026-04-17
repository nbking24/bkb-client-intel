// @ts-nocheck
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Megaphone, Star, Mail, MessageCircle, LayoutDashboard } from 'lucide-react';

const TABS = [
  { href: '/dashboard/marketing', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/marketing/reviews', label: 'Reviews', icon: Star },
  { href: '/dashboard/marketing/newsletter', label: 'Newsletter', icon: Mail },
  { href: '/dashboard/marketing/facebook', label: 'Facebook', icon: MessageCircle },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-full">
      <header className="border-b border-gray-200 bg-white">
        <div className="px-6 pt-5 pb-3 flex items-center gap-3">
          <Megaphone className="w-6 h-6 text-blue-700" />
          <h1 className="text-2xl font-semibold text-gray-900">Marketing</h1>
        </div>
        <nav className="px-6 flex gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.exact
              ? pathname === tab.href
              : pathname?.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ' +
                  (active
                    ? 'border-blue-700 text-blue-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800')
                }
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <div className="p-6">{children}</div>
    </div>
  );
}
