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
  const [sortBy, setSortBy] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [minMembers, setMinMembers] = useState("");
  const [maxMembers, setMaxMembers] = useState("");
  const [minSources, setMinSources] = useState("");
  const [maxSources, setMaxSources] = useState("");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const filterDetailsRef = useRef<HTMLDetailsElement>(null);

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

  const toggleRole = (role: string) => {
    const newRoles = new Set(selectedRoles);
    if (newRoles.has(role)) {
      newRoles.delete(role);
    } else {
      newRoles.add(role);
    }
    setSelectedRoles(newRoles);
  };

  const handleNumberInput = (value: string, setter: (val: string) => void) => {
    const cleanValue = value.replace(/[^0-9]/g, '');

    if (cleanValue !== '') {
      const numValue = parseInt(cleanValue, 10);
      if (numValue > 10000) return;
    }

    setter(cleanValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
      e.preventDefault();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (!/^\d+$/.test(pastedText)) {
      e.preventDefault();
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false;
      }
      if (filterDetailsRef.current && !filterDetailsRef.current.contains(event.target as Node)) {
        filterDetailsRef.current.open = false;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const minMembersNum = minMembers ? parseInt(minMembers, 10) : null;
  const maxMembersNum = maxMembers ? parseInt(maxMembers, 10) : null;
  const minSourcesNum = minSources ? parseInt(minSources, 10) : null;
  const maxSourcesNum = maxSources ? parseInt(maxSources, 10) : null;

  const membersError = minMembersNum !== null && maxMembersNum !== null && minMembersNum > maxMembersNum;
  const sourcesError = minSourcesNum !== null && maxSourcesNum !== null && minSourcesNum > maxSourcesNum;

  let filteredHubs = data?.filter((hub: Hub) => {
    if (normalizedQuery) {
      const matchesName = hub.name?.toLowerCase().includes(normalizedQuery) ?? false;
      const matchesDescription = hub.description?.toLowerCase().includes(normalizedQuery) ?? false;
      if (!matchesName && !matchesDescription) return false;
    }

    if (selectedRoles.size > 0 && hub.role && !selectedRoles.has(hub.role)) {
      return false;
    }

    const memberCount = hub.members_count ?? 0;
    if (minMembersNum !== null && memberCount < minMembersNum) return false;
    if (maxMembersNum !== null && memberCount > maxMembersNum) return false;

    const sourceCount = hub.sources_count ?? 0;
    if (minSourcesNum !== null && sourceCount < minSourcesNum) return false;
    if (maxSourcesNum !== null && sourceCount > maxSourcesNum) return false;

    return true;
  });

  if (filteredHubs && sortBy) {
    filteredHubs = [...filteredHubs].sort((a, b) => {
      const aMembers = a.members_count ?? 0;
      const bMembers = b.members_count ?? 0;
      const aSources = a.sources_count ?? 0;
      const bSources = b.sources_count ?? 0;

      switch (sortBy) {
        case "most-members":
          return bMembers - aMembers;
        case "least-members":
          return aMembers - bMembers;
        case "most-sources":
          return bSources - aSources;
        case "least-sources":
          return aSources - bSources;
        default:
          return 0;
      }
    });
  }

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
      <div style={{ display: "flex", gap: "16px", marginBottom: "24px" }}>
        <div className="search-bar" style={{ flex: 1, marginBottom: 0 }}>
          <MagnifyingGlassIcon className="search-icon" />
          <input
            type="text"
            placeholder="Search hubs by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <details className="filter-menu" ref={filterDetailsRef}>
          <summary className="filter-trigger">
            Filter
          </summary>
          <div className="filter-dropdown">
            <div className="filters-container">
              <div className="filter-group">
                <label className="filter-label">Members</label>
                <div className="range-inputs">
                  <input
                    type="number"
                    placeholder="Min"
                    value={minMembers}
                    onChange={(e) => handleNumberInput(e.target.value, setMinMembers)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    className={`filter-number-input ${membersError ? 'error' : ''}`}
                    min="0"
                    max="10000"
                  />
                  <span className="range-separator">-</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={maxMembers}
                    onChange={(e) => handleNumberInput(e.target.value, setMaxMembers)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    className={`filter-number-input ${membersError ? 'error' : ''}`}
                    min="1"
                    max="10000"
                  />
                </div>
                {membersError && <div className="filter-error-message">Min cannot be greater than max</div>}
              </div>
              <div className="filter-group">
                <label className="filter-label">Sources</label>
                <div className="range-inputs">
                  <input
                    type="number"
                    placeholder="Min"
                    value={minSources}
                    onChange={(e) => handleNumberInput(e.target.value, setMinSources)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    className={`filter-number-input ${sourcesError ? 'error' : ''}`}
                    min="0"
                    max="10000"
                  />
                  <span className="range-separator">-</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={maxSources}
                    onChange={(e) => handleNumberInput(e.target.value, setMaxSources)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    className={`filter-number-input ${sourcesError ? 'error' : ''}`}
                    min="0"
                    max="10000"
                  />
                </div>
                {sourcesError && <div className="filter-error-message">Min cannot be greater than max</div>}
              </div>
              <div className="filter-group">
                <label className="filter-label">Sort by</label>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="filter-select">
                  <option value="">Default</option>
                  <option value="most-members">Most members</option>
                  <option value="least-members">Least members</option>
                  <option value="most-sources">Most sources</option>
                  <option value="least-sources">Least sources</option>
                </select>
              </div>
              <div className="filter-group">
                <label className="filter-label">Role</label>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedRoles.has("owner")}
                      onChange={() => toggleRole("owner")}
                    />
                    <span>Owner</span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedRoles.has("editor")}
                      onChange={() => toggleRole("editor")}
                    />
                    <span>Editor</span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedRoles.has("viewer")}
                      onChange={() => toggleRole("viewer")}
                    />
                    <span>Viewer</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </details>
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
