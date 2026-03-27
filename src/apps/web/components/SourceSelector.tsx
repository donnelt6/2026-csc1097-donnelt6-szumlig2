'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { Source } from '../lib/types';

interface Props {
  sources: Source[];
  sourcesLoading?: boolean;
  selectedSourceIds: string[];
  onToggleSource: (id: string) => void;
  onSelectAllSources: () => void;
  onClearSourceSelection: () => void;
}

export function SourceSelector({
  sources,
  sourcesLoading,
  selectedSourceIds,
  onToggleSource,
  onSelectAllSources,
  onClearSourceSelection,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const completeSources = sources.filter((s) => s.status === 'complete');
  const selectedCount = selectedSourceIds.length;
  const totalCount = completeSources.length;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (sources.length === 0) {
    return (
      <div className="source-selector" ref={ref}>
        <button type="button" className="source-selector__toggle" disabled>
          <span>{sourcesLoading ? 'Sources (loading…)' : 'Sources (0/0)'}</span>
          <ChevronDownIcon className="source-selector__chevron" />
        </button>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="source-selector" ref={ref}>
        <button type="button" className="source-selector__toggle" disabled>
          <span>Sources (processing…)</span>
          <ChevronDownIcon className="source-selector__chevron" />
        </button>
      </div>
    );
  }

  return (
    <div className="source-selector" ref={ref} data-open={open || undefined}>
      <button
        type="button"
        className="source-selector__toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Sources ({selectedCount}/{totalCount})</span>
        <ChevronDownIcon className="source-selector__chevron" />
      </button>
      {open && (
        <div className="source-selector__dropdown">
          <div className="source-selector__actions">
            <button
              type="button"
              className="button--small"
              disabled={selectedCount === totalCount}
              onClick={() => onSelectAllSources()}
            >
              Select all
            </button>
            <button
              type="button"
              className="button--small"
              disabled={selectedCount === 0}
              onClick={() => onClearSourceSelection()}
            >
              Clear
            </button>
          </div>
          <ul className="source-selector__list">
            {completeSources.map((source) => {
              const isSelected = selectedSourceIds.includes(source.id);
              return (
                <li key={source.id} className="source-selector__item">
                  <button
                    type="button"
                    className={`source-selector__label${isSelected ? ' source-selector__label--selected' : ''}`}
                    onClick={() => onToggleSource(source.id)}
                  >
                    <span className="source-selector__name">{source.original_name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
