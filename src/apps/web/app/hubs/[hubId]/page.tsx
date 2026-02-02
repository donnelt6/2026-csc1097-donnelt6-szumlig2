'use client';

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ChatPanel } from "../../../components/ChatPanel";
import { MembersPanel } from "../../../components/MembersPanel";
import { ReminderCandidatesPanel } from "../../../components/ReminderCandidatesPanel";
import { RemindersPanel } from "../../../components/RemindersPanel";
import { UploadPanel } from "../../../components/UploadPanel";
import { listHubs, listSources, trackHubAccess } from "../../../lib/api";
import { useSourceSelection } from "../../../lib/useSourceSelection";

export default function HubDetail({ params }: { params: { hubId: string } }) {
  const queryClient = useQueryClient();
  const hasTrackedAccess = useRef(false);
  const { data: hubs, isLoading: hubsLoading } = useQuery({ queryKey: ["hubs"], queryFn: listHubs });
  const {
    data: sources,
    isLoading: sourcesLoading,
    refetch,
  } = useQuery({
    queryKey: ["sources", params.hubId],
    queryFn: () => listSources(params.hubId),
    refetchInterval: 4000,
  });

  const hub = hubs?.find((h) => h.id === params.hubId);
  const canUpload = hub?.role === "owner" || hub?.role === "editor";
  const roleResolved = !hubsLoading;
  const sourceSelection = useSourceSelection(params.hubId, sources ?? []);

  useEffect(() => {
    hasTrackedAccess.current = false;
  }, [params.hubId]);

  useEffect(() => {
    if (hub && !hasTrackedAccess.current) {
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
  }, [hub, params.hubId, queryClient, hubs]);

  return (
    <main className="page-content page-content--no-hero">
      <div className="content-inner">
        <Link href="/" className="muted" style={{ display: "block", marginBottom: "20px" }}>
          ← Back to hubs
        </Link>
        <header className="card" style={{ marginBottom: "20px" }}>
          <h2 style={{ margin: "0 0 4px" }}>{hub?.name ?? "Hub"}</h2>
          <p className="muted">{hub?.description ?? params.hubId}</p>
        </header>
        <div className="grid" style={{ gap: "20px" }}>
          {roleResolved ? (
            <UploadPanel
              hubId={params.hubId}
              sources={sources ?? []}
              onRefresh={() => refetch()}
              canUpload={canUpload}
              selectedSourceIds={sourceSelection.selectedIds}
              onToggleSource={sourceSelection.toggleSource}
              onSelectAllSources={sourceSelection.selectAll}
              onClearSourceSelection={sourceSelection.clearAll}
            />
          ) : (
            <div className="card">
              <p className="muted">Loading permissions...</p>
            </div>
          )}
          {hub && <ReminderCandidatesPanel hubId={params.hubId} />}
          {hub && <RemindersPanel hubId={params.hubId} />}
          {hub && <MembersPanel hubId={params.hubId} role={hub.role ?? undefined} />}
          {sourcesLoading && <p className="muted">Loading sources...</p>}
          <ChatPanel
            hubId={params.hubId}
            selectedSourceIds={sourceSelection.selectedIds}
            hasSelectableSources={sourceSelection.completeCount > 0}
          />
        </div>
      </div>
    </main>
  );
}
