'use client';

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChatPanel } from "../../../components/ChatPanel";
import { MembersPanel } from "../../../components/MembersPanel";
import { UploadPanel } from "../../../components/UploadPanel";
import { listHubs, listSources } from "../../../lib/api";

export default function HubDetail({ params }: { params: { hubId: string } }) {
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

  return (
    <main className="page grid" style={{ gap: "20px" }}>
      <Link href="/" className="muted">
        ← Back to hubs
      </Link>
      <header className="card">
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
          />
        ) : (
          <div className="card">
            <p className="muted">Loading permissions...</p>
          </div>
        )}
        {hub && <MembersPanel hubId={params.hubId} role={hub.role ?? undefined} />}
        {sourcesLoading && <p className="muted">Loading sources...</p>}
        <ChatPanel hubId={params.hubId} />
      </div>
    </main>
  );
}
