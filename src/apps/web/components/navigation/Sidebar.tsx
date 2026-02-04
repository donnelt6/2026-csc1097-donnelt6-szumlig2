'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  RectangleStackIcon,
  Cog6ToothIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { ThemeToggle } from './ThemeToggle';
import { HubPanels } from './HubPanels';

type SidebarState = 'open' | 'collapsed' | 'hidden';

interface SidebarProps {
  state: SidebarState;
  onStateChange: (state: SidebarState) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ state, onStateChange, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();

  const expandSidebar = () => {
    localStorage.setItem('sidebar-state', 'open');
    onStateChange('open');
  };

  const collapseSidebar = () => {
    localStorage.setItem('sidebar-state', 'collapsed');
    onStateChange('collapsed');
  };

  const hideSidebar = () => {
    localStorage.setItem('sidebar-state', 'hidden');
    onStateChange('hidden');
  };

  const isCollapsed = state === 'collapsed';
  const isHidden = state === 'hidden';

  const sidebarClasses = [
    'sidebar',
    isCollapsed ? 'sidebar--collapsed' : '',
    isHidden ? 'sidebar--hidden' : '',
    mobileOpen ? 'sidebar--mobile-open' : '',
  ].filter(Boolean).join(' ');

  const handleLinkClick = () => {
    onMobileClose?.();
  };

  return (
    <aside className={sidebarClasses}>
      <div className="sidebar-header">
        <Link href="/" className="sidebar-brand" onClick={handleLinkClick}>
          <span className="sidebar-brand-mark" aria-hidden="true" />
          <span className="sidebar-brand-text">Caddie</span>
        </Link>
        {isCollapsed ? (
          <div className="sidebar-controls">
            <button
              className="sidebar-toggle"
              onClick={expandSidebar}
              aria-label="Expand sidebar"
            >
              <ChevronRightIcon className="sidebar-toggle-icon" />
            </button>
            <button
              className="sidebar-toggle"
              onClick={hideSidebar}
              aria-label="Hide sidebar"
            >
              <ChevronLeftIcon className="sidebar-toggle-icon" />
            </button>
          </div>
        ) : (
          <button
            className="sidebar-toggle"
            onClick={collapseSidebar}
            aria-label="Collapse sidebar"
          >
            <ChevronLeftIcon className="sidebar-toggle-icon" />
          </button>
        )}
        {mobileOpen && (
          <button
            className="sidebar-mobile-close"
            onClick={onMobileClose}
            aria-label="Close menu"
          >
            <XMarkIcon className="sidebar-toggle-icon" />
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        <ul className="sidebar-nav-list">
          <li>
            <Link
              href="/"
              className={`sidebar-item ${pathname === '/' ? 'active' : ''}`}
              title={isCollapsed ? 'All Hubs' : undefined}
              onClick={handleLinkClick}
            >
              <RectangleStackIcon className="sidebar-item-icon" />
              <span className="sidebar-item-text">All Hubs</span>
            </Link>
          </li>
        </ul>
        <HubPanels />
      </nav>

      <div className="sidebar-footer">
        <ThemeToggle />
        <Link
          href="/settings"
          className={`sidebar-item ${pathname === '/settings' ? 'active' : ''}`}
          title={isCollapsed ? 'Settings' : undefined}
          onClick={handleLinkClick}
        >
          <Cog6ToothIcon className="sidebar-item-icon" />
          <span className="sidebar-item-text">Settings</span>
        </Link>
      </div>
    </aside>
  );
}
