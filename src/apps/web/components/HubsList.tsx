'use client';

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createHub, listHubs } from "../lib/api";
import type { Hub } from "../lib/types";

export function HubsList() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["hubs"],
    queryFn: listHubs,
  });
  const createMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string }) => createHub(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hubs"] }),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const onSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ name, description });
    setName("");
    setDescription("");
  };

  return (
    <div className="card grid">
      <div>
        <h2 style={{ margin: "0 0 8px" }}>Your hubs</h2>
        <p className="muted">Create a workspace to upload sources and start chatting with them.</p>
      </div>
      {isLoading && <p className="muted">Loading hubs...</p>}
      {error && <p className="muted">Failed to load hubs: {(error as Error).message}</p>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {data?.map((hub: Hub) => (
          <Link key={hub.id} href={`/hubs/${hub.id}`} className="card" style={{ borderColor: "#22304b" }}>
            <strong>{hub.name}</strong>
            <p className="muted">{hub.description || "No description yet"}</p>
            {hub.role && <span className="role-pill">{hub.role}</span>}
          </Link>
        ))}
      </div>
      <form onSubmit={onSubmit} className="grid">
        <label>
          <span className="muted">Hub name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Onboarding hub" />
        </label>
        <label>
          <span className="muted">Description (optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this hub for?" />
        </label>
        <button className="button" type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating..." : "Create hub"}
        </button>
      </form>
    </div>
  );
}
