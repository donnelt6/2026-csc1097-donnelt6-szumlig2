'use client';

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatPanel } from "../../../components/ChatPanel";
import type { ChatPanelHandle } from "../../../components/ChatPanel";
import { HubModerationPanel } from "../../../components/HubModerationPanel";
import { UploadPanel } from "../../../components/UploadPanel";
import { MembersPanel } from "../../../components/MembersPanel";
import { GuidePanel } from "../../../components/GuidePanel";
import { FaqPanel } from "../../../components/FaqPanel";
import { DashboardOverview } from "../../../components/hub-dashboard/DashboardOverview";
import { GuidesPage } from "../../../components/hub-dashboard/GuidesPage";
import { RemindersPage } from "../../../components/hub-dashboard/RemindersPage";

import { acceptInvite, listInvites, listSources, trackHubAccess } from "../../../lib/api";
import { useCurrentHub } from "../../../lib/CurrentHubContext";
import { useHubTab } from "../../../lib/HubTabContext";
import { useHubDashboardTab } from "../../../lib/HubDashboardTabContext";
import { useSearch } from "../../../lib/SearchContext";
import type { HubTab } from "../../../lib/HubTabContext";
import type { Hub } from "../../../lib/types";

const EMPTY_SOURCES: never[] = [];

const VALID_TABS: HubTab[] = ['chat', 'sources', 'dashboard', 'members', 'settings', 'admin'];

export default function HubDetail({ params }: { params: { hubId: string } }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasTrackedAccess = useRef(false);
  const previousHubId = useRef<string | null>(null);
  const { activeTab, setActiveTab } = useHubTab();
  const { activeDashTab, setActiveDashTab } = useHubDashboardTab();
  const { currentHub: hub, isLoading: currentHubLoading } = useCurrentHub();
  const { setSearchQuery } = useSearch();
  // Switch to the tab specified in ?tab= URL param (e.g. from dashboard prompt links)
  // Only override if the URL explicitly contains a tab param; otherwise leave the current tab alone
  useEffect(() => {
    const tabParam = searchParams.get('tab') as HubTab | null;
    const isNewHub = previousHubId.current !== params.hubId;
    previousHubId.current = params.hubId;

    if (tabParam && VALID_TABS.includes(tabParam)) {
      setActiveTab(tabParam);
    } else if (isNewHub) {
      setActiveTab('chat');
    }
  }, [params.hubId, searchParams, setActiveTab]);

  // Clear search when switching tabs so stale queries don't carry over
  useEffect(() => {
    setSearchQuery('');
  }, [activeTab, setSearchQuery]);

  const hubResolved = !!hub;
  const canUpload = hub?.role === 'owner' || hub?.role === 'admin' || hub?.role === 'editor';
  const canModerate = hub?.role === 'owner' || hub?.role === 'admin';

  const { data: invites = [] } = useQuery({
    queryKey: ['invites'],
    queryFn: listInvites,
    enabled: !hubResolved,
    staleTime: 0,
  });

  const pendingInvite = invites.find((invite) => invite.hub.id === params.hubId) ?? null;
  const acceptInviteMutation = useMutation({
    mutationFn: () => acceptInvite(params.hubId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invites'] }),
        queryClient.invalidateQueries({ queryKey: ['hubs'] }),
      ]);
    },
  });

  const { data: sources, refetch: refetchSources, isLoading: sourcesLoading } = useQuery({
    queryKey: ['sources', params.hubId],
    queryFn: () => listSources(params.hubId),
    enabled: hubResolved,
    refetchInterval: activeTab === 'sources' ? 4000 : false,
  });

  const chatPanelRef = useRef<ChatPanelHandle>(null);
  const [chatSourceIds, setChatSourceIds] = useState<string[]>([]);
  const completeSourceIds = (sources ?? EMPTY_SOURCES).filter((s) => s.status === 'complete').map((s) => s.id);
  const handleChatSourceChange = useCallback((ids: string[]) => setChatSourceIds(ids), []);
  const handleToggleSource = useCallback((sourceId: string) => chatPanelRef.current?.toggleSource(sourceId), []);
  const handleSelectAllSources = useCallback((scope?: string[]) => chatPanelRef.current?.selectAllSources(scope), []);
  const handleClearSourceSelection = useCallback((scope?: string[]) => chatPanelRef.current?.clearSourceSelection(scope), []);

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

  if (!currentHubLoading && !hubResolved) {
    return (
      <main className="page-content page-content--no-hero">
        <div className="content-inner">
          <div className="card" style={{ maxWidth: '720px', margin: '0 auto', padding: '24px' }}>
            <h2 style={{ marginTop: 0 }}>
              {pendingInvite ? 'Accept your invite to open this hub' : 'Hub access required'}
            </h2>
            <p className="muted" style={{ marginBottom: '16px' }}>
              {pendingInvite
                ? 'This invite has not been accepted yet. Accept it before viewing chat, sources, or other hub content.'
                : 'This hub is not available from your accepted memberships.'}
            </p>
            {pendingInvite && (
              <button
                type="button"
                className="button"
                onClick={() => acceptInviteMutation.mutate()}
                disabled={acceptInviteMutation.isPending}
              >
                {acceptInviteMutation.isPending ? 'Accepting...' : 'Accept invite'}
              </button>
            )}
            {acceptInviteMutation.error && (
              <p className="muted" role="alert" style={{ marginTop: '12px' }}>
                {(acceptInviteMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={`page-content page-content--no-hero${activeTab === 'chat' ? ' page-content--fullscreen' : ''}`}>
      <div className="content-inner">
        {activeTab !== 'chat' && activeTab !== 'admin' && activeTab !== 'sources' && activeTab !== 'members' && activeTab !== 'dashboard' && (
          <header className="hub-header">
            <h2 className="hub-header__name">{hub?.name ?? "Hub"}</h2>
            {hub?.description && (
              <p className="hub-header__desc">{hub.description}</p>
            )}
          </header>
        )}

        <div className="hub-tab-content">
          <div style={{ display: activeTab === 'chat' ? 'contents' : 'none' }}>
            <ChatPanel
              ref={chatPanelRef}
              hubId={params.hubId}
              hubRole={hub?.role ?? undefined}
              sources={sources ?? []}
              sourcesLoading={sourcesLoading}
              onSourceSelectionChange={handleChatSourceChange}
            />
          </div>
          {activeTab === 'sources' && (
            <UploadPanel
              hubId={params.hubId}
              sources={sources ?? []}
              sourcesLoading={currentHubLoading || !hubResolved || sourcesLoading}
              onRefresh={() => refetchSources()}
              canUpload={canUpload}
              canReviewSuggestions={canUpload}
              selectedSourceIds={chatSourceIds}
              onToggleSource={handleToggleSource}
              onSelectAllSources={handleSelectAllSources}
              onClearSourceSelection={handleClearSourceSelection}
              autoOpenModal={searchParams.get('addSource') === 'true'}
              onModalOpened={() => {
                const p = new URLSearchParams(searchParams.toString());
                p.delete('addSource');
                router.replace(`/hubs/${params.hubId}?${p.toString()}`, { scroll: false });
              }}
            />
          )}
          {activeTab === 'members' && (
            <MembersPanel hubId={params.hubId} role={hub?.role ?? undefined} />
          )}
          {activeTab === 'dashboard' && (
            <div className="hub-dashboard">
              {activeDashTab === 'overview' && (
                <DashboardOverview
                  hubId={params.hubId}
                  canEdit={canUpload}
                  onSwitchTab={setActiveDashTab}
                />
              )}
              {activeDashTab === 'guides' && (
                <GuidesPage
                  hubId={params.hubId}
                  sources={sources ?? []}
                  canEdit={canUpload}
                />
              )}
              {activeDashTab === 'reminders' && (
                <RemindersPage hubId={params.hubId} />
              )}
              {activeDashTab === 'faqs' && (
                <FaqPanel
                  hubId={params.hubId}
                  selectedSourceIds={chatSourceIds}
                  hasSelectableSources={completeSourceIds.length > 0}
                  canEdit={canUpload}
                />
              )}
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
