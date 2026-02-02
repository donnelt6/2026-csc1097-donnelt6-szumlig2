'use client';

import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

interface PageHeroProps {
  title: string;
  subtitle?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  action?: React.ReactNode;
  toolbar?: React.ReactNode;
}

export function PageHero({
  title,
  subtitle,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search hubs...',
  action,
  toolbar,
}: PageHeroProps) {
  return (
    <div className="page-hero">
      <div className="page-hero-header">
        <div className="page-hero-text">
          <h1 className="page-hero-title">{title}</h1>
          {subtitle && <p className="page-hero-subtitle">{subtitle}</p>}
        </div>
        {action && <div className="page-hero-action">{action}</div>}
      </div>
      <div className="page-hero-search-row">
        <div className="page-hero-search">
          <MagnifyingGlassIcon className="page-hero-search-icon" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="page-hero-search-input"
          />
        </div>
        {toolbar}
      </div>
    </div>
  );
}
