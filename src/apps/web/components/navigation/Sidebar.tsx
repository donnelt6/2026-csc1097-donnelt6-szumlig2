'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Squares2X2Icon,
  RectangleStackIcon,
  ArchiveBoxIcon,
  Cog6ToothIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { ThemeToggle } from './ThemeToggle';
import { HubPanels } from './HubPanels';

type SidebarState = 'open' | 'collapsed' | 'hidden';

interface SidebarProps {
  state: SidebarState;
  onStateChange: (state: SidebarState) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onCreateHub?: () => void;
}

export function Sidebar({ state, onStateChange, mobileOpen, onMobileClose, onCreateHub }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const expandSidebar = () => {
    localStorage.setItem('sidebar-state', 'open');
    onStateChange('open');
  };

  const collapseSidebar = () => {
    localStorage.setItem('sidebar-state', 'collapsed');
    onStateChange('collapsed');
  };

  const isCollapsed = state === 'collapsed';

  const sidebarClasses = [
    'sidebar',
    isCollapsed ? 'sidebar--collapsed' : '',
    mobileOpen ? 'sidebar--mobile-open' : '',
  ].filter(Boolean).join(' ');

  const handleLinkClick = () => {
    onMobileClose?.();
  };

  return (
    <aside className={sidebarClasses}>
      <div className="sidebar-header">
        <Link href="/" className="sidebar-brand" onClick={handleLinkClick}>
          <span className="sidebar-brand-text">Caddie</span>
        </Link>
        {isCollapsed ? (
          <button
            className="sidebar-toggle"
            onClick={expandSidebar}
            aria-label="Expand sidebar"
          >
            <ChevronRightIcon className="sidebar-toggle-icon" />
          </button>
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
              href="/dashboard"
              className={`sidebar-item ${pathname === '/dashboard' ? 'active' : ''}`}
              title={isCollapsed ? 'Dashboard' : undefined}
              onClick={handleLinkClick}
            >
              <Squares2X2Icon className="sidebar-item-icon" />
              <span className="sidebar-item-text">Dashboard</span>
            </Link>
          </li>
          <li>
            <Link
              href="/"
              className={`sidebar-item ${pathname === '/' ? 'active' : ''}`}
              title={isCollapsed ? 'Hubs' : undefined}
              onClick={handleLinkClick}
            >
              <RectangleStackIcon className="sidebar-item-icon" />
              <span className="sidebar-item-text">Hubs</span>
            </Link>
          </li>
          <li>
            <Link
              href="/vault"
              className={`sidebar-item ${pathname === '/vault' ? 'active' : ''}`}
              title={isCollapsed ? 'Vault' : undefined}
              onClick={handleLinkClick}
            >
              <ArchiveBoxIcon className="sidebar-item-icon" />
              <span className="sidebar-item-text">Vault</span>
            </Link>
          </li>
          <li>
            <Link
              href="/settings"
              className={`sidebar-item ${pathname === '/settings' ? 'active' : ''}`}
              title={isCollapsed ? 'Settings' : undefined}
              onClick={handleLinkClick}
            >
              <Cog6ToothIcon className="sidebar-item-icon" />
              <span className="sidebar-item-text">Settings</span>
            </Link>
          </li>
        </ul>
        <HubPanels />
      </nav>

      <div className="sidebar-footer">
        <button
          className="sidebar-item sidebar-new-hub-button"
          onClick={() => {
            if (onCreateHub) {
              onCreateHub();
            } else {
              router.push('/?create=true');
            }
            onMobileClose?.();
          }}
          title={isCollapsed ? 'New Hub' : undefined}
        >
          <PlusIcon className="sidebar-item-icon" />
          <span className="sidebar-item-text">New Hub</span>
        </button>
        <div className="sidebar-footer-links">
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
