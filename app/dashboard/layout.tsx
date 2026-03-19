'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, FolderKanban, Bell, MessageSquare,
  FileText, Menu, X, ChevronRight, ClipboardEdit, DollarSign, Calculator
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/precon', label: 'Pre-Construction', icon: FolderKanban },
  { href: '/dashboard/spec-writer', label: 'Spec Writer', icon: ClipboardEdit },
  { href: '/dashboard/estimate', label: 'Estimating', icon: Calculator },
  { href: '/dashboard/invoicing', label: 'Invoicing', icon: DollarSign },
  { href: '/dashboard/documents', label: 'Documents', icon: FileText },
  { href: '/dashboard/ask', label: 'Ask Agent', icon: MessageSquare },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifCount] = useState(3); // TODO: wire to Supabase realtime
  const auth = useAuth();
  const isLoginPage = pathname === '/dashboard/login';

  // Redirect to login if not authenticated (must be before any early returns to satisfy hooks rules)
  useEffect(() => {
    if (!auth.isAuthenticated && !isLoginPage) {
      router.push('/dashboard/login');
    }
  }, [auth.isAuthenticated, isLoginPage, router]);

  // If on the login page, render children directly (no sidebar/nav shell)
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Show nothing while checking auth / redirecting
  if (!auth.isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#141414' }}>
        <div className="text-sm" style={{ color: '#8a8078' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#141414', color: '#e8e0d8' }}>
      {/* Top Nav Bar */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-4 h-14"
        style={{ background: '#1a1a1a', borderBottom: '1px solid rgba(205,162,116,0.12)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg hover:bg-white/5 md:hidden"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <img
            src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png"
            alt="BKB"
            className="h-8 w-auto"
          />
          <span className="hidden sm:inline text-sm font-medium" style={{ color: '#C9A84C' }}>
            Operations Platform
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Notification Bell */}
          <button className="relative p-2 rounded-lg hover:bg-white/5">
            <Bell size={20} style={{ color: '#8a8078' }} />
            {notifCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full"
                style={{ background: '#ef4444', color: '#fff' }}
              >
                {notifCount}
              </span>
            )}
          </button>

          {/* User avatar */}
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: '#1B3A5C', color: '#C9A84C' }}
          >
            {auth.user?.initials || 'BK'}
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`
            fixed md:sticky top-14 left-0 z-40 h-[calc(100vh-3.5rem)] w-56
            transition-transform duration-200 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}
          style={{ background: '#1a1a1a', borderRight: '1px solid rgba(205,162,116,0.12)' }}
        >
          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    active ? 'font-medium' : 'hover:bg-white/5'
                  }`}
                  style={active ? { background: 'rgba(205,162,116,0.1)', color: '#C9A84C' } : { color: '#8a8078' }}
                >
                  <Icon size={18} />
                  {item.label}
                  {active && <ChevronRight size={14} className="ml-auto" />}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-7xl">
          {children}
        </main>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
