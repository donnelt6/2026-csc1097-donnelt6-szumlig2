'use client';

import { useRef, useEffect } from 'react';
import { FunnelIcon, ClockIcon, UserGroupIcon, DocumentIcon, ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/outline';

export interface HubsFilterState {
  sortField: string;
  sortDirection: 'asc' | 'desc';
  selectedRoles: Set<string>;
  typeTab: 'all' | 'pinned' | 'shared';
  statusTab: 'all' | 'active' | 'archived';
}

interface HubsToolbarProps {
  filters: HubsFilterState;
  onFiltersChange: (filters: HubsFilterState) => void;
  hubCount: number;
}

export function HubsToolbar({ filters, onFiltersChange }: HubsToolbarProps) {
  const filterDetailsRef = useRef<HTMLDetailsElement>(null);

  const { sortField, sortDirection, selectedRoles, typeTab, statusTab } = filters;

  const toggleRole = (role: string) => {
    const newRoles = new Set(selectedRoles);
    if (newRoles.has(role)) {
      newRoles.delete(role);
    } else {
      newRoles.add(role);
    }
    onFiltersChange({ ...filters, selectedRoles: newRoles });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterDetailsRef.current && !filterDetailsRef.current.contains(event.target as Node)) {
        filterDetailsRef.current.open = false;
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="hubs-toolbar">
      <div className="hubs-toolbar-left">
        <div className="hubs-toolbar-tabs">
          {(['all', 'pinned', 'shared'] as const).map((tab) => (
            <button
              key={tab}
              className={`hubs-tab ${typeTab === tab ? 'hubs-tab--active' : ''}`}
              onClick={() => onFiltersChange({ ...filters, typeTab: tab })}
            >
              {tab === 'all' ? 'Recent' : tab === 'pinned' ? 'Starred' : 'Shared'}
            </button>
          ))}
        </div>
        <div className="hubs-toolbar-tabs">
          {(['all', 'active', 'archived'] as const).map((tab) => (
            <button
              key={tab}
              className={`hubs-tab ${statusTab === tab ? 'hubs-tab--active' : ''}`}
              onClick={() => onFiltersChange({ ...filters, statusTab: tab })}
            >
              {tab === 'all' ? 'All Hubs' : tab === 'active' ? 'Active' : 'Archived'}
            </button>
          ))}
        </div>
      </div>
      <div className="hubs-toolbar-right">
        <details className="filter-menu" ref={filterDetailsRef}>
          <summary className="toolbar-button filter-trigger">
            <FunnelIcon className="toolbar-button-icon" />
            Filter
          </summary>
          <div className="filter-dropdown filter-dropdown--combined">
            <div className="filter-section">
              <p className="filter-section-header">Sort by</p>
              <ul className="sort-dropdown-list">
                {[
                  { key: "accessed", label: "Last accessed", icon: ClockIcon },
                  { key: "name", label: "Alphabetical", icon: DocumentIcon },
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
                          onFiltersChange({ ...filters, sortField: key, sortDirection: key === "name" ? "asc" : "desc" });
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
            <div className="filter-section">
              <p className="filter-section-header">Role</p>
              <div className="checkbox-group">
                {["owner", "admin", "editor", "viewer"].map((role) => (
                  <label key={role} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedRoles.has(role)}
                      onChange={() => toggleRole(role)}
                    />
                    <span>{role.charAt(0).toUpperCase() + role.slice(1)}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
