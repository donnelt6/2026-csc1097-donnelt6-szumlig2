'use client';

import { useState, useCallback, useLayoutEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { Sidebar } from './navigation/Sidebar';
import { ProfileMenu } from './navigation/ProfileMenu';
import { NotificationsMenu } from './navigation/NotificationsMenu';
import { useAuth } from './auth/AuthProvider';

type SidebarState = 'open' | 'collapsed' | 'hidden';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarState, setSidebarState] = useState<SidebarState | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const { user, loading } = useAuth();

  const isAuthPage = pathname.startsWith('/auth');
  const showChrome = !isAuthPage && !loading && !!user;

  useLayoutEffect(() => {
    const saved = localStorage.getItem('sidebar-state') as SidebarState | null;
    if (saved && ['open', 'collapsed', 'hidden'].includes(saved)) {
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
              <span className="brand-mark" aria-hidden="true" />
              Caddie
            </a>
          </div>
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
