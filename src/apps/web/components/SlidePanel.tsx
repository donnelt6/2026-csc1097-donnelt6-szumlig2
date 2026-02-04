'use client';

import { useEffect, useCallback, useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function SlidePanel({ open, onClose, title, children }: SlidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  return (
    <div
      className={`slide-panel-backdrop${open ? ' slide-panel-backdrop--open' : ''}`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={`slide-panel${open ? ' slide-panel--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="slide-panel-header">
            <h2 className="slide-panel-title">{title}</h2>
            <button
              className="slide-panel-close"
              onClick={onClose}
              aria-label="Close panel"
              type="button"
            >
              <XMarkIcon className="slide-panel-close-icon" />
            </button>
          </div>
        )}
        <div className="slide-panel-body">{children}</div>
      </div>
    </div>
  );
}
