'use client';

import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import {
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  BellIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';

type HubTab = 'chat' | 'sources' | 'members' | 'reminders';

const items: { key: HubTab; icon: typeof DocumentTextIcon; label: string }[] = [
  { key: 'chat', icon: ChatBubbleLeftRightIcon, label: 'Chat' },
  { key: 'sources', icon: DocumentTextIcon, label: 'Sources' },
  { key: 'members', icon: UsersIcon, label: 'Members' },
  { key: 'reminders', icon: BellIcon, label: 'Reminders' },
];

export function HubPanels() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const hubMatch = pathname.match(/^\/hubs\/([^/]+)/);
  const hubId = hubMatch?.[1] ?? null;

  if (!hubId) return null;

  const activeTab = (searchParams.get('tab') as HubTab) || 'chat';

  const setTab = (key: HubTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === 'chat') {
      params.delete('tab');
    } else {
      params.set('tab', key);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  return (
    <div className="sidebar-section">
      <p className="sidebar-section-title">Hub</p>
      <ul className="sidebar-nav-list">
        {items.map(({ key, icon: Icon, label }) => (
          <li key={key}>
            <button
              className={`sidebar-item hub-nav-button${activeTab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}
              title={label}
              type="button"
            >
              <Icon className="sidebar-item-icon" />
              <span className="sidebar-item-text">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
