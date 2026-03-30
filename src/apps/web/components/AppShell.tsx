'use client';

import { useState, useCallback, useLayoutEffect, useMemo, useEffect, useRef } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bars3Icon, ChatBubbleLeftRightIcon, DocumentTextIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Sidebar } from './navigation/Sidebar';
import { ThemeToggle } from './navigation/ThemeToggle';
import { ProfileMenu } from './navigation/ProfileMenu';
import { NotificationsMenu } from './navigation/NotificationsMenu';
import { useAuth } from './auth/AuthProvider';
import { useSearch } from '../lib/SearchContext';
import { useHubTab } from '../lib/HubTabContext';
import { listHubs, searchChatMessages } from '../lib/api';
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
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [debouncedChatSearchQuery, setDebouncedChatSearchQuery] = useState('');
  const [chatSearchFocused, setChatSearchFocused] = useState(false);
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
  const chatSearchRef = useRef<HTMLDivElement>(null);

  const dashboardTab = searchParams.get('tab') ?? 'home';
  const dashboardTabs = [
    { key: 'home', label: 'Home' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'activity', label: 'Activity' },
  ] as const;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedChatSearchQuery(chatSearchQuery.trim());
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [chatSearchQuery]);

  useEffect(() => {
    setChatSearchFocused(false);
    setChatSearchQuery('');
    setDebouncedChatSearchQuery('');
  }, [hubId, activeTab]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (chatSearchRef.current && !chatSearchRef.current.contains(event.target as Node)) {
        setChatSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const { data: chatSearchResults = [], isFetching: chatSearchLoading } = useQuery({
    queryKey: ['hub-chat-search', hubId, debouncedChatSearchQuery],
    queryFn: () => searchChatMessages(hubId!, debouncedChatSearchQuery),
    enabled: isOnHub && activeTab === 'chat' && !!hubId && debouncedChatSearchQuery.length >= 2,
    staleTime: 15_000,
  });
  const showChatSearchDropdown = isOnHub && activeTab === 'chat' && chatSearchFocused && chatSearchQuery.trim().length >= 2;

  const handleChatSearchResultClick = useCallback((sessionId: string, messageId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'chat');
    params.set('session', sessionId);
    if (messageId) {
      params.set('message', messageId);
    } else {
      params.delete('message');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setChatSearchFocused(false);
  }, [pathname, router, searchParams]);

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
                  {activeTab === 'chat' ? (
                    <div className="nav-chat-search" ref={chatSearchRef}>
                      <MagnifyingGlassIcon className="nav-search-icon" />
                      <input
                        type="text"
                        placeholder="Search conversations..."
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        onFocus={() => setChatSearchFocused(true)}
                        className="nav-search-input"
                      />
                      {showChatSearchDropdown && (
                        <div className="nav-chat-search-dropdown">
                          {chatSearchLoading ? (
                            <div className="nav-chat-search-empty">Searching chats...</div>
                          ) : chatSearchResults.length > 0 ? (
                            chatSearchResults.map((result) => (
                              <button
                                key={`${result.session_id}-${result.message_id ?? 'title'}`}
                                type="button"
                                className="nav-chat-search-item"
                                onClick={() => handleChatSearchResultClick(result.session_id, result.message_id)}
                              >
                                {result.matched_role === 'title' ? (
                                  <DocumentTextIcon className="nav-chat-search-item-icon nav-chat-search-item-icon--title" />
                                ) : (
                                  <ChatBubbleLeftRightIcon className="nav-chat-search-item-icon nav-chat-search-item-icon--message" />
                                )}
                                <div className="nav-chat-search-item-info">
                                  <div className="nav-chat-search-item-header">
                                    <span className="nav-chat-search-item-name">{result.session_title}</span>
                                    <span className={`nav-chat-search-item-kind nav-chat-search-item-kind--${result.matched_role === 'title' ? 'title' : result.matched_role === 'user' ? 'query' : 'response'}`}>
                                      {result.matched_role === 'title' ? 'Title' : result.matched_role === 'user' ? 'Query' : 'Response'}
                                    </span>
                                  </div>
                                  <span className="nav-chat-search-item-meta">
                                    {result.matched_role === 'title'
                                      ? `Title: ${result.snippet}`
                                      : `${result.matched_role === 'user' ? 'You' : 'Caddie'}: ${result.snippet}`}
                                  </span>
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className="nav-chat-search-empty">No matching messages found.</div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <MagnifyingGlassIcon className="nav-search-icon" />
                      <input
                        type="text"
                        placeholder={activeTab === 'sources' ? "Search sources..." : activeTab === 'members' ? "Search members..." : "Search conversations..."}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="nav-search-input"
                      />
                    </>
                  )}
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
