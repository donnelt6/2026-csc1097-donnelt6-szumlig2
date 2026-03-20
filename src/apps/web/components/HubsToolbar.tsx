'use client';

import { useRef, useEffect } from 'react';
import { Bars3BottomLeftIcon, FunnelIcon, MagnifyingGlassIcon, ClockIcon, UserGroupIcon, DocumentIcon, ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/outline';

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
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

export function HubsToolbar({ filters, onFiltersChange, searchQuery, onSearchChange }: HubsToolbarProps) {
  const sortDetailsRef = useRef<HTMLDetailsElement>(null);
  const filterDetailsRef = useRef<HTMLDetailsElement>(null);

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
      if (sortDetailsRef.current && !sortDetailsRef.current.contains(event.target as Node)) {
        sortDetailsRef.current.open = false;
      }
      if (filterDetailsRef.current && !filterDetailsRef.current.contains(event.target as Node)) {
        filterDetailsRef.current.open = false;
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
        <div className="hubs-toolbar-tabs">
          <button
            className={`hubs-tab ${!showOnlyFavourites ? 'hubs-tab--active' : ''}`}
            onClick={() => onFiltersChange({ ...filters, showOnlyFavourites: false })}
          >
            All Hubs
          </button>
          <button
            className={`hubs-tab ${showOnlyFavourites ? 'hubs-tab--active' : ''}`}
            onClick={() => onFiltersChange({ ...filters, showOnlyFavourites: true })}
          >
            Pinned
          </button>
        </div>
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
        <details className="filter-menu" ref={sortDetailsRef}>
          <summary className="toolbar-button">
            <Bars3BottomLeftIcon className="toolbar-button-icon" />
            Sort
            {sortField === "accessed" ? <ClockIcon className="toolbar-button-icon" /> : sortField === "members" ? <UserGroupIcon className="toolbar-button-icon" /> : <DocumentIcon className="toolbar-button-icon" />}
            {sortDirection === "desc" ? <ArrowDownIcon className="sort-dropdown-arrow-icon" /> : <ArrowUpIcon className="sort-dropdown-arrow-icon" />}
          </summary>
          <div className="filter-dropdown sort-dropdown">
            <p className="sort-dropdown-header">Sorting options</p>
            <ul className="sort-dropdown-list">
              {[
                { key: "accessed", label: "Last accessed", icon: ClockIcon },
                { key: "members", label: "Members", icon: UserGroupIcon },
                { key: "sources", label: "Documents count", icon: DocumentIcon },
              ].map(({ key, label, icon: Icon }) => (
                <li key={key}>
                  <button
                    type="button"
                    className={`sort-dropdown-item ${sortField === key ? 'sort-dropdown-item--active' : ''}`}
                    onClick={() => {
                      if (sortField === key) {
                        onFiltersChange({ ...filters, sortDirection: sortDirection === "desc" ? "asc" : "desc" });
                      } else {
                        onFiltersChange({ ...filters, sortField: key, sortDirection: "desc" });
                      }
                    }}
                  >
                    <span className="sort-dropdown-item-label">
                      <Icon className="sort-dropdown-item-icon" />
                      {label}
                    </span>
                    {sortField === key && (sortDirection === "desc" ? <ArrowDownIcon className="sort-dropdown-arrow-icon" /> : <ArrowUpIcon className="sort-dropdown-arrow-icon" />)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
        <div className="hubs-toolbar-search">
          <MagnifyingGlassIcon className="hubs-toolbar-search-icon" />
          <input
            type="text"
            placeholder="Search hubs..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="hubs-toolbar-search-input"
          />
        </div>
      </div>
    </div>
  );
}
