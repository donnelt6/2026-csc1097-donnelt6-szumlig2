'use client';

import { useState, useCallback, useLayoutEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bars3Icon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Sidebar } from './navigation/Sidebar';
import { ProfileMenu } from './navigation/ProfileMenu';
import { NotificationsMenu } from './navigation/NotificationsMenu';
import { useAuth } from './auth/AuthProvider';
import { useSearch } from '../lib/SearchContext';

type SidebarState = 'open' | 'collapsed' | 'hidden';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarState, setSidebarState] = useState<SidebarState | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const { searchQuery, setSearchQuery } = useSearch();

  const isAuthPage = pathname.startsWith('/auth');
  const isDashboard = pathname === '/dashboard';
  const showChrome = !isAuthPage && !loading && !!user;

  const dashboardTab = searchParams.get('tab') ?? 'dashboard';
  const dashboardTabs = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'activity', label: 'Activity' },
  ] as const;

  useLayoutEffect(() => {
    const saved = localStorage.getItem('sidebar-state') as SidebarState | null;
    if (saved && ['open', 'collapsed'].includes(saved)) {
      setSidebarState(saved);
    } else {
      setSidebarState('open');
    }
  }, []);

  const effectiveSidebarState = sidebarState ?? 'open';

  const handleStateChange = useCallback((state: SidebarState) => {
    setSidebarState(state);
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const handleMenuClick = useCallback(() => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      setMobileMenuOpen(true);
    } else {
      setSidebarState('collapsed');
      localStorage.setItem('sidebar-state', 'collapsed');
    }
  }, []);

  const sidebarHidden = effectiveSidebarState === 'hidden';
  const isHydrated = sidebarState !== null;

  if (!showChrome) {
    return <div className="app-shell app-shell--no-chrome">{children}</div>;
  }

  return (
    <div className={`app-shell sidebar-${effectiveSidebarState}${!isHydrated ? ' no-transition' : ''}`}>
      <div
        className={`mobile-overlay ${mobileMenuOpen ? 'is-visible' : ''}`}
        onClick={closeMobileMenu}
      />
      <Sidebar
        state={effectiveSidebarState}
        onStateChange={handleStateChange}
        mobileOpen={mobileMenuOpen}
        onMobileClose={closeMobileMenu}
      />
      <header className="site-nav">
        <div className="nav-content">
          <div className="nav-brand">
            <button
              className={`mobile-menu-button ${sidebarHidden ? 'is-visible-desktop' : ''}`}
              onClick={handleMenuClick}
              aria-label="Open menu"
            >
              <Bars3Icon />
            </button>
            <a className="brand" href="/">
              Caddie
            </a>
          </div>
          {isDashboard ? (
            <div className="dash-nav-tabs">
              {dashboardTabs.map((tab) => (
                <button
                  key={tab.key}
                  className={`dash-nav-tab ${dashboardTab === tab.key ? 'dash-nav-tab--active' : ''}`}
                  onClick={() => {
                    const params = new URLSearchParams(searchParams.toString());
                    if (tab.key === 'dashboard') {
                      params.delete('tab');
                    } else {
                      params.set('tab', tab.key);
                    }
                    const qs = params.toString();
                    router.push(`/dashboard${qs ? `?${qs}` : ''}`, { scroll: false });
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="nav-search">
              <MagnifyingGlassIcon className="nav-search-icon" />
              <input
                type="text"
                placeholder="Search documentation hubs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="nav-search-input"
              />
            </div>
          )}
          <div className="nav-actions">
            <NotificationsMenu />
            <ProfileMenu />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
