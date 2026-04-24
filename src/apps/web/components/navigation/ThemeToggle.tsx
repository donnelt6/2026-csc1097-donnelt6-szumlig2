'use client';

// ThemeToggle.tsx: Dark and light theme toggle button with system preference detection.

import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';
import { useTheme } from '../../lib/useTheme';

export function ThemeToggle({ compact }: { compact?: boolean } = {}) {
  const { theme, toggle, mounted } = useTheme();

  if (!mounted) {
    return (
      <button
        className={`theme-toggle${compact ? ' theme-toggle--compact' : ''}`}
        aria-label="Toggle theme"
        disabled
      >
        <MoonIcon className="theme-toggle-icon" />
        {!compact && <span className="sidebar-item-text">Theme</span>}
      </button>
    );
  }

  return (
    <button
      className={`theme-toggle${compact ? ' theme-toggle--compact' : ''}`}
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <SunIcon className="theme-toggle-icon" />
      ) : (
        <MoonIcon className="theme-toggle-icon" />
      )}
      {!compact && <span className="sidebar-item-text">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}
