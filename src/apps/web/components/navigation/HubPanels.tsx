'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  DocumentTextIcon,
  BellIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { listHubs, listSources } from '../../lib/api';
import { SlidePanel } from '../SlidePanel';
import { TabSwitcher } from '../TabSwitcher';
import { UploadPanel } from '../UploadPanel';
import { RemindersPanel } from '../RemindersPanel';
import { ReminderCandidatesPanel } from '../ReminderCandidatesPanel';
import { MembersPanel } from '../MembersPanel';

type PanelKey = 'sources' | 'reminders' | 'members';

const REMINDER_TABS = [
  { key: 'suggested', label: 'Suggested' },
  { key: 'manual', label: 'Manual' },
];

export function HubPanels() {
  const pathname = usePathname();
  const [activePanel, setActivePanel] = useState<PanelKey | null>(null);
  const [reminderTab, setReminderTab] = useState('suggested');

  // Extract hubId from URL pattern /hubs/:hubId
  const hubMatch = pathname.match(/^\/hubs\/([^/]+)/);
  const hubId = hubMatch?.[1] ?? null;

  const { data: hubs } = useQuery({
    queryKey: ['hubs'],
    queryFn: listHubs,
    enabled: !!hubId,
  });

  const {
    data: sources,
    refetch: refetchSources,
  } = useQuery({
    queryKey: ['sources', hubId],
    queryFn: () => listSources(hubId!),
    enabled: !!hubId,
    refetchInterval: 4000,
  });

  if (!hubId) return null;

  const hub = hubs?.find((h) => h.id === hubId);
  const canUpload = hub?.role === 'owner' || hub?.role === 'editor';

  const toggle = (key: PanelKey) => {
    setActivePanel((prev) => (prev === key ? null : key));
  };

  const close = () => setActivePanel(null);

  const items: { key: PanelKey; icon: typeof DocumentTextIcon; label: string }[] = [
    { key: 'sources', icon: DocumentTextIcon, label: 'Sources' },
    { key: 'reminders', icon: BellIcon, label: 'Reminders' },
    { key: 'members', icon: UsersIcon, label: 'Members' },
  ];

  return (
    <>
      <div className="sidebar-section">
        <p className="sidebar-section-title">Hub</p>
        <ul className="sidebar-nav-list">
          {items.map(({ key, icon: Icon, label }) => (
            <li key={key}>
              <button
                className={`sidebar-item hub-nav-button${activePanel === key ? ' active' : ''}`}
                onClick={() => toggle(key)}
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

      <SlidePanel open={activePanel === 'sources'} onClose={close} title="Sources">
        <UploadPanel
          hubId={hubId}
          sources={sources ?? []}
          onRefresh={() => refetchSources()}
          canUpload={canUpload}
        />
      </SlidePanel>

      <SlidePanel open={activePanel === 'reminders'} onClose={close} title="Reminders">
        <div className="grid" style={{ gap: '16px' }}>
          <TabSwitcher
            tabs={REMINDER_TABS}
            activeKey={reminderTab}
            onTabChange={setReminderTab}
          />
          {reminderTab === 'suggested' ? (
            <ReminderCandidatesPanel hubId={hubId} />
          ) : (
            <RemindersPanel hubId={hubId} />
          )}
        </div>
      </SlidePanel>

      <SlidePanel open={activePanel === 'members'} onClose={close} title="Members">
        <MembersPanel hubId={hubId} role={hub?.role ?? undefined} />
      </SlidePanel>
    </>
  );
}
