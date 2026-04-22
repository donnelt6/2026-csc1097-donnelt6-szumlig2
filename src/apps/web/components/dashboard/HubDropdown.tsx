'use client';

// HubDropdown.tsx: Hub filter dropdown for scoping dashboard data to a specific hub.

import { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { Hub } from '@shared/index';

interface HubDropdownProps {
  hubs: Hub[];
  value: string;
  onChange: (hubId: string) => void;
  allOption?: string;
  placeholder?: string;
}

export function HubDropdown({ hubs, value, onChange, allOption, placeholder }: HubDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selectedHub = hubs.find((h) => h.id === value);
  const label = selectedHub?.name ?? (allOption && !value ? allOption : placeholder ?? 'Select hub');

  return (
    <div className="dash-hub-dropdown" ref={ref}>
      <button
        type="button"
        className="dash-hub-dropdown-btn"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="dash-hub-dropdown-label">{label}</span>
        <ChevronDownIcon className="dash-hub-dropdown-chevron" />
      </button>
      {open && (
        <div className="dash-hub-dropdown-menu">
          {allOption && (
            <button
              type="button"
              className={`dash-hub-dropdown-item${!value ? ' dash-hub-dropdown-item--active' : ''}`}
              onClick={() => { onChange(''); setOpen(false); }}
            >
              {allOption}
            </button>
          )}
          {hubs.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`dash-hub-dropdown-item${value === h.id ? ' dash-hub-dropdown-item--active' : ''}`}
              onClick={() => { onChange(h.id); setOpen(false); }}
            >
              {h.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
