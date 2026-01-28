'use client';

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { UserIcon, UsersIcon, UserGroupIcon, DocumentIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
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
  const [searchQuery, setSearchQuery] = useState("");
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const onSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ name, description });
    setName("");
    setDescription("");
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredHubs = data?.filter((hub: Hub) => {
    if (!normalizedQuery) return true;
    const matchesName = hub.name?.toLowerCase().includes(normalizedQuery) ?? false;
    const matchesDescription = hub.description?.toLowerCase().includes(normalizedQuery) ?? false;
    return matchesName || matchesDescription;
  });

  return (
    <div className="grid">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "16px" }}>
        <div>
          <h2 style={{ margin: "0 0 8px" }}>Your hubs</h2>
          <p className="muted">Create a workspace to upload sources and start chatting with them.</p>
        </div>
        <details className="create-hub-menu" ref={detailsRef}>
          <summary className="create-hub-trigger">
            Create new hub
          </summary>
          <div className="create-hub-dropdown">
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
        </details>
      </div>
      <div className="search-bar">
        <MagnifyingGlassIcon className="search-icon" />
        <input
          type="text"
          placeholder="Search hubs by name or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>
      {isLoading && <p className="muted">Loading hubs...</p>}
      {error && <p className="muted">Failed to load hubs: {(error as Error).message}</p>}
      <div className="hubs-grid">
        {filteredHubs?.map((hub: Hub) => (
          <Link key={hub.id} href={`/hubs/${hub.id}`} className="hub-card">
            <div className="hub-card-header">
              <h3 className="hub-card-title">{hub.name}</h3>
              <p className="hub-card-description">{hub.description || "No description yet"}</p>
            </div>
            <div className="hub-card-footer">
              {hub.role && <span className="hub-card-role">{hub.role}</span>}
              <div className="hub-card-stats">
                <span className="hub-stat" aria-label={`${hub.members_count ?? 0} ${hub.members_count === 1 ? 'member' : 'members'}`}>
                  {(hub.members_count ?? 0) === 1 ? (
                    <UserIcon className="hub-stat-icon" aria-hidden="true" />
                  ) : (hub.members_count ?? 0) <= 4 ? (
                    <UsersIcon className="hub-stat-icon" aria-hidden="true" />
                  ) : (
                    <UserGroupIcon className="hub-stat-icon" aria-hidden="true" />
                  )}
                  <span className="hub-stat-value">{hub.members_count ?? 0}</span>
                </span>
                <span className="hub-stat" aria-label={`${hub.sources_count ?? 0} ${hub.sources_count === 1 ? 'source' : 'sources'}`}>
                  <DocumentIcon className="hub-stat-icon" aria-hidden="true" />
                  <span className="hub-stat-value">{hub.sources_count ?? 0}</span>
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
