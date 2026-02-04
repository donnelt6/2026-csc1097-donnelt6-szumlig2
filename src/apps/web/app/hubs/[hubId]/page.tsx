'use client';

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ChatPanel } from "../../../components/ChatPanel";
import { listHubs, trackHubAccess } from "../../../lib/api";

export default function HubDetail({ params }: { params: { hubId: string } }) {
  const queryClient = useQueryClient();
  const hasTrackedAccess = useRef(false);
  const { data: hubs } = useQuery({ queryKey: ["hubs"], queryFn: listHubs });

  const hub = hubs?.find((h) => h.id === params.hubId);

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
        <ChatPanel hubId={params.hubId} />
      </div>
    </main>
  );
}
