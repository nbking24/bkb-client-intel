// @ts-nocheck
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, FolderKanban, Menu, X, ChevronRight,
  DollarSign, Calculator, MessageSquare, ClipboardList, LogOut,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import AskAgentPanel from './components/AskAgentPanel';

// Full nav for admin/owner roles
const ADMIN_NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/precon', label: 'Pre-Construction', icon: FolderKanban },
  { href: '/dashboard/estimate', label: 'Estimating', icon: Calculator },
  { href: '/dashboard/invoicing', label: 'Invoicing', icon: DollarSign },
];

// Simplified nav for field staff
const FIELD_NAV = [
  { href: '/dashboard/field', label: 'My Tasks', icon: ClipboardList },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const auth = useAuth();
  const isLoginPage = pathname === '/dashboard/login';

  // Determine if user is field staff
  const isFieldStaff = auth.role === 'field_sup' || auth.role === 'field';

  // Redirect to login ONLY after auth has finished loading and user is not authenticated
  useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated && !isLoginPage) {
      router.push('/dashboard/login');
    }
  }, [auth.loading, auth.isAuthenticated, isLoginPage, router]);

  // Field staff: redirect to their dashboard if they land on the admin overview
  useEffect(() => {
    if (!auth.loading && auth.isAuthenticated && isFieldStaff && pathname === '/dashboard') {
      router.replace('/dashboard/field');
    }
  }, [auth.loading, auth.isAuthenticated, isFieldStaff, pathname, router]);

  // Close user menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen]);

  function handleLogout() {
    localStorage.removeItem('bkb-token');
    setUserMenuOpen(false);
    router.push('/dashboard/login');
  }

  // If on the login page, render children directly (no sidebar/nav shell)
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Show loading while checking auth (reading localStorage)
  if (auth.loading || !auth.isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#141414' }}>
        <div className="text-sm" style={{ color: '#8a8078' }}>Loading...</div>
      </div>
    );
  }

  const NAV_ITEMS = isFieldStaff ? FIELD_NAV : ADMIN_NAV;

  return (
    <div className="min-h-screen" style={{ background: '#141414', color: '#e8e0d8' }}>
      {/* Top Nav Bar */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-4 h-14"
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
            {isFieldStaff ? 'Field Hub' : 'Operations Platform'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Ask Agent toggle */}
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
              chatOpen ? 'ring-1' : 'hover:bg-white/5'
            }`}
            style={{
              color: chatOpen ? '#1a1a1a' : '#CDA274',
              background: chatOpen ? '#CDA274' : 'transparent',
              ringColor: '#CDA274',
            }}
          >
            <MessageSquare size={16} />
            <span className="hidden sm:inline font-medium">Ask Agent</span>
          </button>

          {/* User avatar + logout menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold cursor-pointer transition-all hover:ring-2"
              style={{ background: '#1B3A5C', color: '#C9A84C', border: 'none', ringColor: '#CDA274' }}
              title={auth.user?.name || 'User'}
            >
              {auth.user?.initials || 'BK'}
            </button>
            {userMenuOpen && (
              <div
                className="absolute right-0 top-10 rounded-lg shadow-xl overflow-hidden z-50"
                style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.15)', minWidth: 180 }}
              >
                <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(205,162,116,0.1)' }}>
                  <div className="text-sm font-medium" style={{ color: '#e8e0d8' }}>{auth.user?.name || 'User'}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#6a6058' }}>{auth.role || 'team member'}</div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors"
                  style={{ color: '#e8e0d8', border: 'none', background: 'transparent', cursor: 'pointer' }}
                >
                  <LogOut size={15} style={{ color: '#CDA274' }} />
                  Switch User
                </button>
              </div>
            )}
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
                (item.href !== '/dashboard' && item.href !== '/dashboard/field' && pathname.startsWith(item.href));
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

          {/* Quick chat shortcut at bottom of sidebar */}
          <div className="absolute bottom-4 left-0 right-0 px-3">
            <button
              onClick={() => { setChatOpen(true); setSidebarOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-white/5"
              style={{ color: '#CDA274', border: '1px solid rgba(205,162,116,0.12)' }}
            >
              <MessageSquare size={18} />
              Ask Agent
            </button>
          </div>
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

      {/* Ask Agent slide-out panel — available from any dashboard page */}
      <AskAgentPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
