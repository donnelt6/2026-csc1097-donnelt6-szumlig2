'use client';

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChatPanel } from "../../../components/ChatPanel";
import { FaqPanel } from "../../../components/FaqPanel";
import { GuidePanel } from "../../../components/GuidePanel";
import { TabSwitcher } from "../../../components/TabSwitcher";
import { UploadPanel } from "../../../components/UploadPanel";
import { MembersPanel } from "../../../components/MembersPanel";
import { RemindersPanel } from "../../../components/RemindersPanel";
import { ReminderCandidatesPanel } from "../../../components/ReminderCandidatesPanel";
import { listHubs, listSources, trackHubAccess } from "../../../lib/api";
import { useSourceSelection } from "../../../lib/useSourceSelection";
import { useHubTab } from "../../../lib/HubTabContext";
import type { HubTab } from "../../../lib/HubTabContext";

const REMINDER_TABS = [
  { key: 'suggested', label: 'Suggested' },
  { key: 'manual', label: 'Manual' },
];

const EMPTY_SOURCES: never[] = [];

const VALID_TABS: HubTab[] = ['chat', 'sources', 'members', 'reminders', 'faq', 'guides'];

export default function HubDetail({ params }: { params: { hubId: string } }) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const hasTrackedAccess = useRef(false);
  const { activeTab, setActiveTab } = useHubTab();
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

  const { data: hubs } = useQuery({ queryKey: ["hubs"], queryFn: listHubs });
  const hub = hubs?.find((h) => h.id === params.hubId);
  const hubResolved = !!hub;
  const canUpload = hub?.role === 'owner' || hub?.role === 'editor';

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
        queryClient.setQueryData(["hubs"], (oldHubs: typeof hubs) => {
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

  return (
    <main className={`page-content page-content--no-hero${activeTab === 'chat' ? ' page-content--fullscreen' : ''}`}>
      <div className="content-inner">
        {activeTab !== 'chat' && (
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
              hubDescription={hub?.description ?? undefined}
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
          {activeTab === 'guides' && (
            <GuidePanel
              hubId={params.hubId}
              selectedSourceIds={sourceSelection.selectedIds}
              hasSelectableSources={sourceSelection.completeCount > 0}
              canEdit={canUpload}
            />
          )}
          {activeTab === 'faq' && (
            <FaqPanel
              hubId={params.hubId}
              selectedSourceIds={sourceSelection.selectedIds}
              hasSelectableSources={sourceSelection.completeCount > 0}
              canEdit={canUpload}
            />
          )}
          {activeTab === 'reminders' && (
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
          )}
        </div>
      </div>
    </main>
  );
}
