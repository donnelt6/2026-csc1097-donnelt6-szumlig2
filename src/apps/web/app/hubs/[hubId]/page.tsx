'use client';

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChatPanel } from "../../../components/ChatPanel";
import { FaqPanel } from "../../../components/FaqPanel";
import { GuidePanel } from "../../../components/GuidePanel";
import { HubModerationPanel } from "../../../components/HubModerationPanel";
import { TabSwitcher } from "../../../components/TabSwitcher";
import { UploadPanel } from "../../../components/UploadPanel";
import { MembersPanel } from "../../../components/MembersPanel";
import { RemindersPanel } from "../../../components/RemindersPanel";
import { ReminderCandidatesPanel } from "../../../components/ReminderCandidatesPanel";
import { listSources, trackHubAccess } from "../../../lib/api";
import { useCurrentHub } from "../../../lib/CurrentHubContext";
import { useSourceSelection } from "../../../lib/useSourceSelection";
import { useHubTab } from "../../../lib/HubTabContext";
import type { HubTab } from "../../../lib/HubTabContext";
import type { Hub } from "../../../lib/types";

const REMINDER_TABS = [
  { key: 'suggested', label: 'Suggested' },
  { key: 'manual', label: 'Manual' },
];

const EMPTY_SOURCES: never[] = [];

const VALID_TABS: HubTab[] = ['chat', 'sources', 'dashboard', 'members', 'settings'];

export default function HubDetail({ params }: { params: { hubId: string } }) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const hasTrackedAccess = useRef(false);
  const { activeTab, setActiveTab } = useHubTab();
  const { currentHub: hub } = useCurrentHub();
  const [reminderSubTab, setReminderSubTab] = useState('suggested');

  // Switch to the tab specified in ?tab= URL param (e.g. from dashboard prompt links)
  useEffect(() => {
    const tabParam = searchParams.get('tab') as HubTab | null;
    if (tabParam && VALID_TABS.includes(tabParam)) {
      setActiveTab(tabParam);
    } else {
      setActiveTab('chat');
    }
  }, [params.hubId]);

  const hubResolved = !!hub;
  const canUpload = hub?.role === 'owner' || hub?.role === 'admin' || hub?.role === 'editor';
  const canModerate = hub?.role === 'owner' || hub?.role === 'admin';

  const { data: sources, refetch: refetchSources, isLoading: sourcesLoading } = useQuery({
    queryKey: ['sources', params.hubId],
    queryFn: () => listSources(params.hubId),
    refetchInterval: activeTab === 'sources' ? 4000 : false,
  });

  const sourceSelection = useSourceSelection(params.hubId, sources ?? EMPTY_SOURCES);

  useEffect(() => {
    hasTrackedAccess.current = false;
  }, [params.hubId]);

  useEffect(() => {
    if (hubResolved && !hasTrackedAccess.current) {
      hasTrackedAccess.current = true;
      const timestamp = new Date().toISOString();

      const updateCache = () => {
        queryClient.setQueryData(["hubs"], (oldHubs: Hub[] | undefined) => {
          if (!oldHubs) return oldHubs;
          return oldHubs.map((h) =>
            h.id === params.hubId
              ? { ...h, last_accessed_at: timestamp }
              : h
          );
        });
      };

      updateCache();

      trackHubAccess(params.hubId)
        .then(() => {
          updateCache();
        })
        .catch((error) => {
          console.error("Failed to track hub access:", error);
          queryClient.invalidateQueries({ queryKey: ["hubs"] });
        });
    }
  }, [hubResolved, params.hubId, queryClient]);

  useEffect(() => {
    if (activeTab === 'admin' && hubResolved && !canModerate) {
      setActiveTab('chat');
    }
  }, [activeTab, canModerate, hubResolved, setActiveTab]);

  return (
    <main className={`page-content page-content--no-hero${activeTab === 'chat' ? ' page-content--fullscreen' : ''}`}>
      <div className="content-inner">
        {activeTab !== 'chat' && activeTab !== 'admin' && (
          <header className="hub-header">
            <h2 className="hub-header__name">{hub?.name ?? "Hub"}</h2>
            {hub?.description && (
              <p className="hub-header__desc">{hub.description}</p>
            )}
          </header>
        )}

        <div className="hub-tab-content">
          {activeTab === 'chat' && (
            <ChatPanel
              hubId={params.hubId}
              hubName={hub?.name ?? undefined}
              hubDescription={hub?.description ?? undefined}
              hubRole={hub?.role ?? undefined}
              sources={sources ?? []}
              sourcesLoading={sourcesLoading}
            />
          )}
          {activeTab === 'sources' && (
            <UploadPanel
              hubId={params.hubId}
              sources={sources ?? []}
              onRefresh={() => refetchSources()}
              canUpload={canUpload}
              canReviewSuggestions={canUpload}
              selectedSourceIds={sourceSelection.selectedIds}
              onToggleSource={sourceSelection.toggleSource}
              onSelectAllSources={sourceSelection.selectAll}
              onClearSourceSelection={sourceSelection.clearAll}
            />
          )}
          {activeTab === 'members' && (
            <MembersPanel hubId={params.hubId} role={hub?.role ?? undefined} />
          )}
          {activeTab === 'dashboard' && (
            <div className="hub-dashboard">
              <section className="hub-dashboard__section">
                <h3 className="hub-dashboard__section-title">Guides</h3>
                <GuidePanel
                  hubId={params.hubId}
                  selectedSourceIds={sourceSelection.selectedIds}
                  hasSelectableSources={sourceSelection.completeCount > 0}
                  canEdit={canUpload}
                />
              </section>
              <section className="hub-dashboard__section">
                <h3 className="hub-dashboard__section-title">FAQs</h3>
                <FaqPanel
                  hubId={params.hubId}
                  selectedSourceIds={sourceSelection.selectedIds}
                  hasSelectableSources={sourceSelection.completeCount > 0}
                  canEdit={canUpload}
                />
              </section>
              <section className="hub-dashboard__section">
                <h3 className="hub-dashboard__section-title">Reminders</h3>
                <div className="grid" style={{ gap: '16px' }}>
                  <TabSwitcher
                    tabs={REMINDER_TABS}
                    activeKey={reminderSubTab}
                    onTabChange={setReminderSubTab}
                  />
                  {reminderSubTab === 'suggested' ? (
                    <ReminderCandidatesPanel hubId={params.hubId} />
                  ) : (
                    <RemindersPanel hubId={params.hubId} />
                  )}
                </div>
              </section>
            </div>
          )}
          {activeTab === 'settings' && (
            <div className="hub-settings">
              <p className="muted">Hub settings coming soon.</p>
            </div>
          )}
          {activeTab === 'admin' && (
            <HubModerationPanel
              hubId={params.hubId}
              hubRole={hub?.role ?? undefined}
            />
          )}
        </div>
      </div>
    </main>
  );
}
