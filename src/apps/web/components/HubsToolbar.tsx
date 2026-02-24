'use client';

import { useRef, useEffect } from 'react';
import { FunnelIcon, Bars3BottomLeftIcon } from '@heroicons/react/24/outline';

export interface HubsFilterState {
  sortField: string;
  sortDirection: 'asc' | 'desc';
  selectedRoles: Set<string>;
  minMembers: string;
  maxMembers: string;
  minSources: string;
  maxSources: string;
  showOnlyFavourites: boolean;
}

interface HubsToolbarProps {
  filters: HubsFilterState;
  onFiltersChange: (filters: HubsFilterState) => void;
  hubCount: number;
}

export function HubsToolbar({ filters, onFiltersChange, hubCount }: HubsToolbarProps) {
  const filterDetailsRef = useRef<HTMLDetailsElement>(null);
  const sortDetailsRef = useRef<HTMLDetailsElement>(null);

  const {
    sortField,
    sortDirection,
    selectedRoles,
    minMembers,
    maxMembers,
    minSources,
    maxSources,
    showOnlyFavourites,
  } = filters;

  const toggleRole = (role: string) => {
    const newRoles = new Set(selectedRoles);
    if (newRoles.has(role)) {
      newRoles.delete(role);
    } else {
      newRoles.add(role);
    }
    onFiltersChange({ ...filters, selectedRoles: newRoles });
  };

  const handleNumberInput = (value: string, field: keyof HubsFilterState) => {
    const cleanValue = value.replace(/[^0-9]/g, '');
    if (cleanValue !== '') {
      const numValue = parseInt(cleanValue, 10);
      if (numValue > 10000) return;
    }
    onFiltersChange({ ...filters, [field]: cleanValue });
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
      if (filterDetailsRef.current && !filterDetailsRef.current.contains(event.target as Node)) {
        filterDetailsRef.current.open = false;
      }
      if (sortDetailsRef.current && !sortDetailsRef.current.contains(event.target as Node)) {
        sortDetailsRef.current.open = false;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const minMembersNum = minMembers ? parseInt(minMembers, 10) : null;
  const maxMembersNum = maxMembers ? parseInt(maxMembers, 10) : null;
  const minSourcesNum = minSources ? parseInt(minSources, 10) : null;
  const maxSourcesNum = maxSources ? parseInt(maxSources, 10) : null;

  const membersError = minMembersNum !== null && maxMembersNum !== null && minMembersNum > maxMembersNum;
  const sourcesError = minSourcesNum !== null && maxSourcesNum !== null && minSourcesNum > maxSourcesNum;

  return (
    <div className="hubs-toolbar">
      <div className="hubs-toolbar-left">
        <details className="filter-menu" ref={sortDetailsRef}>
          <summary className="toolbar-button">
            <Bars3BottomLeftIcon className="toolbar-button-icon" />
            Sort
          </summary>
          <div className="filter-dropdown">
            <div className="filters-container" style={{ gridTemplateColumns: "1fr", padding: "16px" }}>
              <div className="filter-group">
                <label className="filter-label">Sort by</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (sortField === "accessed") {
                        onFiltersChange({ ...filters, sortDirection: sortDirection === "desc" ? "asc" : "desc" });
                      } else {
                        onFiltersChange({ ...filters, sortField: "accessed", sortDirection: "desc" });
                      }
                    }}
                    className={sortField === "accessed" ? "button button--primary" : "button button--secondary"}
                    style={{ fontSize: "0.875rem", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <span>Last accessed</span>
                    <span>{sortField === "accessed" ? (sortDirection === "desc" ? "↓" : "↑") : ""}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (sortField === "members") {
                        onFiltersChange({ ...filters, sortDirection: sortDirection === "desc" ? "asc" : "desc" });
                      } else {
                        onFiltersChange({ ...filters, sortField: "members", sortDirection: "desc" });
                      }
                    }}
                    className={sortField === "members" ? "button button--primary" : "button button--secondary"}
                    style={{ fontSize: "0.875rem", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <span>Members</span>
                    <span>{sortField === "members" ? (sortDirection === "desc" ? "↓" : "↑") : ""}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (sortField === "sources") {
                        onFiltersChange({ ...filters, sortDirection: sortDirection === "desc" ? "asc" : "desc" });
                      } else {
                        onFiltersChange({ ...filters, sortField: "sources", sortDirection: "desc" });
                      }
                    }}
                    className={sortField === "sources" ? "button button--primary" : "button button--secondary"}
                    style={{ fontSize: "0.875rem", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <span>Documents</span>
                    <span>{sortField === "sources" ? (sortDirection === "desc" ? "↓" : "↑") : ""}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </details>
        <details className="filter-menu" ref={filterDetailsRef}>
          <summary className="toolbar-button">
            <FunnelIcon className="toolbar-button-icon" />
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
                    onChange={(e) => handleNumberInput(e.target.value, 'minMembers')}
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
                    onChange={(e) => handleNumberInput(e.target.value, 'maxMembers')}
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
                    onChange={(e) => handleNumberInput(e.target.value, 'minSources')}
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
                    onChange={(e) => handleNumberInput(e.target.value, 'maxSources')}
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
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showOnlyFavourites}
                    onChange={(e) => onFiltersChange({ ...filters, showOnlyFavourites: e.target.checked })}
                  />
                  <span>Favourites only</span>
                </label>
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
        <span className="hubs-count">{hubCount} {hubCount === 1 ? 'hub' : 'hubs'}</span>
      </div>
    </div>
  );
}
