// @ts-nocheck
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, FolderKanban, Menu, X, ChevronRight,
  DollarSign, Calculator, MessageSquare, ClipboardList, LogOut, Users, FileText, BarChart3,
  Megaphone, Bug, Receipt, Shield, Mic,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useAccess, clearAccessCache } from '../hooks/useAccess';
import { DASHBOARDS } from '../lib/access-registry';
import AskAgentPanel from './components/AskAgentPanel';
import TicketReporter from './components/TicketReporter';

// Map the registry's icon names to the actual lucide components.
const ICON_MAP: Record<string, any> = {
  LayoutDashboard, Users, FolderKanban, Calculator, DollarSign, BarChart3,
  Receipt, FileText, Megaphone, Bug, ClipboardList, Shield, Mic,
};

// Build the nav from a user's allowed dashboard ids, in registry order.
function buildNav(dashboardIds: string[]) {
  return DASHBOARDS
    .filter((d) => dashboardIds.includes(d.id))
    .map((d) => ({ href: d.href, label: d.label, icon: ICON_MAP[d.icon] || LayoutDashboard, id: d.id }));
}

// Longest-prefix match: which dashboard does a given path belong to?
function dashboardIdForPath(pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const d of DASHBOARDS) {
    if (pathname === d.href || (d.href !== '/dashboard' && pathname.startsWith(d.href))) {
      if (!best || d.href.length > best.len) best = { id: d.id, len: d.href.length };
    }
  }
  // Exact /dashboard handled above; if nothing matched and we're at root, it's overview.
  if (!best && pathname === '/dashboard') return 'overview';
  return best?.id ?? null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const auth = useAuth();
  const { access, loading: accessLoading } = useAccess();
  const isLoginPage = pathname === '/dashboard/login';

  // Allowed dashboards for this user (from per-user access config).
  const allowedDashboards = access?.dashboards || [];
  const navItems = buildNav(allowedDashboards);

  // Redirect to login ONLY after auth has finished loading and user is not authenticated
  useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated && !isLoginPage) {
      router.push('/dashboard/login');
    }
  }, [auth.loading, auth.isAuthenticated, isLoginPage, router]);

  // Access enforcement: once access is loaded, if the user is on a dashboard
  // they're not allowed to see (e.g. typed the URL directly, or a field-only
  // user landed on the overview), send them to their first allowed dashboard.
  useEffect(() => {
    if (isLoginPage || accessLoading || !access) return;
    const currentId = dashboardIdForPath(pathname);
    if (!currentId) return; // unknown sub-route — leave it alone
    if (!allowedDashboards.includes(currentId)) {
      const first = buildNav(allowedDashboards)[0];
      if (first && first.href !== pathname) router.replace(first.href);
    }
  }, [isLoginPage, accessLoading, access, pathname, allowedDashboards, router]);

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
    clearAccessCache();
    setUserMenuOpen(false);
    router.push('/dashboard/login');
  }

  // If on the login page, render children directly (no sidebar/nav shell)
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Show loading while checking auth (reading localStorage) or resolving access
  if (auth.loading || !auth.isAuthenticated || accessLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#ffffff' }}>
        <div className="text-sm" style={{ color: '#8a8078' }}>Loading...</div>
      </div>
    );
  }

  const NAV_ITEMS = navItems;
  const isFieldOnly = allowedDashboards.length > 0 && allowedDashboards.every((d) => d === 'field');
  const canAskAgent = !!access?.features?.includes('ask_agent');
  const canReportIssue = !!access?.features?.includes('report_issue');

  return (
    <div className="min-h-screen" style={{ background: '#f8f6f3', color: '#1a1a1a' }}>
      {/* Top Nav Bar */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-4 h-14"
        style={{ background: '#68050a', borderBottom: '1px solid #5a0408' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg hover:bg-white/10 md:hidden"
            style={{ color: '#ffffff' }}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <img
            src="https://www.brettkingbuilder.com/wp-content/uploads/2021/08/logowhite.png"
            alt="BKB"
            className="h-8 w-auto"
          />
          <span className="hidden sm:inline text-sm font-medium" style={{ color: '#e8c860' }}>
            {isFieldOnly ? 'Field Hub' : 'Operations Platform'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Ask Agent toggle */}
          {canAskAgent && (
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
              chatOpen ? '' : 'hover:bg-white/10'
            }`}
            style={{
              color: chatOpen ? '#68050a' : '#ffffff',
              background: chatOpen ? '#e8c860' : 'transparent',
              border: chatOpen ? 'none' : '1px solid rgba(255,255,255,0.2)',
            }}
          >
            <MessageSquare size={16} />
            <span className="hidden sm:inline font-medium">Ask Agent</span>
          </button>
          )}

          {/* User avatar + logout menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold cursor-pointer transition-all hover:ring-2"
              style={{ background: '#c88c00', color: '#ffffff', border: 'none', ringColor: '#e8c860' }}
              title={access?.name || auth.user?.name || 'User'}
            >
              {access?.initials || auth.user?.initials || 'BK'}
            </button>
            {userMenuOpen && (
              <div
                className="absolute right-0 top-10 rounded-lg shadow-xl overflow-hidden z-50"
                style={{ background: '#ffffff', border: '1px solid #e8e5e0', minWidth: 180 }}
              >
                <div className="px-4 py-3" style={{ borderBottom: '1px solid #e8e5e0' }}>
                  <div className="text-sm font-medium" style={{ color: '#1a1a1a' }}>{access?.name || auth.user?.name || 'User'}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#8a8078' }}>{access?.title || access?.role || auth.role || 'team member'}</div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                  style={{ color: '#1a1a1a', border: 'none', background: 'transparent', cursor: 'pointer' }}
                >
                  <LogOut size={15} style={{ color: '#68050a' }} />
                  Switch User
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div>
        {/* Sidebar — fixed on all screen sizes to avoid layout gaps */}
        <aside
          className={`
            fixed top-14 left-0 z-40 h-[calc(100vh-3.5rem)] w-56
            transition-transform duration-200 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}
          style={{ background: '#ffffff', borderRight: '1px solid #e8e5e0' }}
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
                    active ? 'font-medium' : 'hover:bg-gray-50'
                  }`}
                  style={active ? { background: 'rgba(104,5,10,0.08)', color: '#68050a' } : { color: '#5a5550' }}
                >
                  <Icon size={18} />
                  {item.label}
                  {active && <ChevronRight size={14} className="ml-auto" />}
                </Link>
              );
            })}
          </nav>

          {/* Quick chat shortcut at bottom of sidebar */}
          {canAskAgent && (
          <div className="absolute bottom-4 left-0 right-0 px-3">
            <button
              onClick={() => { setChatOpen(true); setSidebarOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-gray-50"
              style={{ color: '#68050a', border: '1px solid #e8e5e0' }}
            >
              <MessageSquare size={18} />
              Ask Agent
            </button>
          </div>
          )}
        </aside>

        {/* Main content — offset by sidebar width on desktop */}
        <main className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 md:ml-56 max-w-7xl">
          {children}
        </main>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Ask Agent slide-out panel — available from any dashboard page */}
      <AskAgentPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />

      {/* Floating "Report an issue" button + modal — gated by the report_issue feature */}
      {canReportIssue && <TicketReporter />}
    </div>
  );
}
