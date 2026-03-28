'use client';

import { useState, useCallback, useLayoutEffect, useMemo } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bars3Icon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Sidebar } from './navigation/Sidebar';
import { ThemeToggle } from './navigation/ThemeToggle';
import { ProfileMenu } from './navigation/ProfileMenu';
import { NotificationsMenu } from './navigation/NotificationsMenu';
import { useAuth } from './auth/AuthProvider';
import { useSearch } from '../lib/SearchContext';
import { useHubTab } from '../lib/HubTabContext';
import { listHubs } from '../lib/api';
import { CurrentHubProvider } from '../lib/CurrentHubContext';
import { resolveHubAppearance } from '../lib/hubAppearance';

type SidebarState = 'open' | 'collapsed' | 'hidden';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarState, setSidebarState] = useState<SidebarState | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [transitionsReady, setTransitionsReady] = useState(false);
  const params = useParams<{ hubId?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const { searchQuery, setSearchQuery } = useSearch();
  const { activeTab } = useHubTab();

  const isAuthPage = pathname.startsWith('/auth');
  const isHome = pathname === '/';
  const isSettingsPage = pathname === '/settings';
  const isHubRoute = pathname.startsWith('/hubs/');
  const isOnHub = isHubRoute;
  const hubId = isHubRoute ? params?.hubId ?? null : null;
  const showChrome = !isAuthPage && !loading && !!user;
  const { data: hubs, isLoading: hubsLoading } = useQuery({
    queryKey: ["hubs"],
    queryFn: listHubs,
    enabled: showChrome && !!hubId,
  });
  const currentHub = useMemo(
    () => hubs?.find((hub) => hub.id === hubId) ?? null,
    [hubId, hubs]
  );
  const currentHubAppearance = currentHub
    ? resolveHubAppearance(currentHub.icon_key, currentHub.color_key)
    : null;
  const CurrentHubIcon = currentHubAppearance?.icon.icon;

  const dashboardTab = searchParams.get('tab') ?? 'home';
  const dashboardTabs = [
    { key: 'home', label: 'Home' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'activity', label: 'Activity' },
  ] as const;

  useLayoutEffect(() => {
    setTransitionsReady(false);
    if (!isOnHub) {
      setSidebarState('hidden');
    } else {
      const saved = localStorage.getItem('sidebar-state') as SidebarState | null;
      if (saved && ['open', 'collapsed'].includes(saved)) {
        setSidebarState(saved);
      } else {
        setSidebarState('open');
      }
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTransitionsReady(true);
      });
    });
  }, [isOnHub]);

  const effectiveSidebarState = isOnHub
    ? (sidebarState ?? 'open')
    : 'hidden';

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

  if (!showChrome) {
    return <div className="app-shell app-shell--no-chrome">{children}</div>;
  }

  return (
    <CurrentHubProvider value={{ currentHub, isLoading: isHubRoute && hubsLoading }}>
      <div className={`app-shell sidebar-${effectiveSidebarState}${!transitionsReady ? ' no-transition' : ''}`}>
        {isOnHub && (
          <>
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
          </>
        )}
        <header className="site-nav">
          <div className={`nav-content${isOnHub ? ' nav-content--hub' : ''}`}>
            <div className="nav-brand">
              <button
                className={`mobile-menu-button ${isOnHub && sidebarHidden ? 'is-visible-desktop' : ''}`}
                onClick={handleMenuClick}
                aria-label="Open menu"
              >
                <Bars3Icon />
              </button>
              <a className="brand" href="/">
                Caddie
              </a>
            </div>
            {isHome ? (
              <div className="dash-nav-tabs">
                {dashboardTabs.map((tab) => (
                  <button
                    key={tab.key}
                    className={`dash-nav-tab ${dashboardTab === tab.key ? 'dash-nav-tab--active' : ''}`}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams.toString());
                      if (tab.key === 'home') {
                        params.delete('tab');
                      } else {
                        params.set('tab', tab.key);
                      }
                      const qs = params.toString();
                      router.push(`/${qs ? `?${qs}` : ''}`, { scroll: false });
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : isOnHub ? (
              <>
                {currentHub && CurrentHubIcon && (
                  <div className="nav-current-hub" title={currentHub.name}>
                    <span className="nav-current-hub-icon" style={currentHubAppearance.badgeStyle}>
                      <CurrentHubIcon />
                    </span>
                    <span className="nav-current-hub-name">{currentHub.name}</span>
                  </div>
                )}
                <div className="nav-search nav-search--hub-chat">
                  <MagnifyingGlassIcon className="nav-search-icon" />
                  <input
                    type="text"
                    placeholder={activeTab === 'sources' ? "Search sources..." : "Search conversations..."}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="nav-search-input"
                  />
                </div>
              </>
            ) : isSettingsPage ? null : (
              <div className="nav-search nav-search--hubs">
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
              <ThemeToggle compact />
              <NotificationsMenu />
              <ProfileMenu />
            </div>
          </div>
        </header>
        {children}
      </div>
    </CurrentHubProvider>
  );
}
